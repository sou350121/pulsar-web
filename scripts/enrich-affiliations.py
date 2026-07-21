#!/usr/bin/env python3.11
"""
Enrich researcher affiliations from OpenAlex (https://openalex.org).

Why:
  pulsar-web's loadPeople pool has 751 researchers; only ~20 (2.7%) have a
  resolved affiliation today. Every PR-X UX audit pointed to this as root
  cause — region facet useless, polymath/cross-embodiment chips degenerate,
  師徒 visualization impossible.

How:
  1. Walk every evidence URL in src/data/vla-daily-rating-out-*.json AND
     ai-daily-pick-*.json, extract arxiv IDs.
  2. For each unique arxiv ID, query OpenAlex /works/doi:10.48550/arXiv.{id} for the
     full authorship array (author OpenAlex IDs + position + raw affiliations).
  3. For each unique OpenAlex author ID seen as a first-author byline,
     query /authors/{id} for last_known_institutions (canonical current
     employer) + the affiliations[] timeline.
  4. Match OpenAlex author display_name → pulsar's normalized name via the
     same name normalization used in talent.ts. The arxiv-ID match is
     deterministic so no string disambiguation needed.
  5. Merge with the existing hand-curated institution-registry.json:
     - keep all existing entries (high-trust manual curation)
     - add new entries from OpenAlex with confidence < manual
     - canonical institution name = OpenAlex display_name (short form
       lookup via canonicalize() rule below)

Output: src/data/institution-registry.json (overwrite in place; the
existing 36-entry file is checked in).

Caches:
  /tmp/openalex-papers.json  — keyed by arxiv ID
  /tmp/openalex-authors.json — keyed by OpenAlex author ID
  Both incremental — re-running this script after new papers only fetches
  new IDs.

Politeness:
  OpenAlex "polite pool" needs mailto=. Includes that. Sleeps 0.05s
  between requests to stay well under 100 req/sec. Retries 429/5xx with
  exponential backoff.

Usage:
  python3.11 scripts/enrich-affiliations.py [--dry-run] [--verbose]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
CACHE_DIR = Path("/tmp")
PAPER_CACHE = CACHE_DIR / "openalex-papers.json"
AUTHOR_CACHE = CACHE_DIR / "openalex-authors.json"
REGISTRY_OUT = DATA_DIR / "institution-registry.json"

OPENALEX_BASE = "https://api.openalex.org"
# Polite pool — give them a way to contact us if we cause trouble.
POLITE_MAILTO = "sou350121@gmail.com"
SLEEP_S = 0.05  # 20 req/s — well under their 100 req/s polite ceiling


# ─── Name normalization (mirror of talent.ts normalizeName) ───────────────
def normalize_name(raw: str) -> str:
    if not raw:
        return ""
    s = raw.strip()
    # "Smith, John" → "John Smith"
    if "," in s and " and " not in s:
        parts = [p.strip() for p in s.split(",")]
        if len(parts) >= 2:
            s = " ".join(parts[1:]) + " " + parts[0]
    # Drop trailing "et al" and parenthesized affiliations
    s = re.sub(r"\bet\s*al\.?$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\(.*?\)", "", s)
    s = s.strip().lower()
    s = re.sub(r"\s+", " ", s)
    tokens = s.split(" ")
    non_initials = [t for t in tokens if not re.match(r"^[a-z]\.?$", t)]
    if len(non_initials) >= 2:
        s = " ".join(non_initials)
    return s


# ─── Institution canonicalization ─────────────────────────────────────────
# OpenAlex returns "Stanford University", "University of California, Berkeley".
# The existing registry uses "Stanford", "UC Berkeley". Keep the short form
# where it's industry-standard; OpenAlex name otherwise.
CANONICAL_INSTITUTION = {
    "Stanford University":                         "Stanford",
    "University of California, Berkeley":          "UC Berkeley",
    "University of California, Los Angeles":       "UCLA",
    "University of California, San Diego":         "UCSD",
    "University of California, Santa Barbara":     "UCSB",
    "University of California, Irvine":            "UCI",
    "Carnegie Mellon University":                  "CMU",
    "Massachusetts Institute of Technology":       "MIT",
    "Princeton University":                        "Princeton",
    "Harvard University":                          "Harvard",
    "Cornell University":                          "Cornell",
    "Columbia University":                         "Columbia",
    "New York University":                         "NYU",
    "California Institute of Technology":          "Caltech",
    "Georgia Institute of Technology":             "Georgia Tech",
    "University of Washington":                    "UW",
    "University of Texas at Austin":               "UT Austin",
    "The University of Texas at Austin":           "UT Austin",
    "University of Michigan, Ann Arbor":           "Michigan",
    "University of Illinois Urbana-Champaign":     "UIUC",
    "University of Maryland, College Park":        "Maryland",
    "University of Southern California":           "USC",
    "ETH Zurich":                                  "ETH",
    "EPFL":                                        "EPFL",
    "Imperial College London":                     "Imperial",
    "University of Oxford":                        "Oxford",
    "University of Cambridge":                     "Cambridge",
    "University College London":                   "UCL",
    "Tsinghua University":                         "清华",
    "Peking University":                           "北大",
    "Shanghai Jiao Tong University":               "上交",
    "Fudan University":                            "复旦",
    "Zhejiang University":                         "浙大",
    "Chinese Academy of Sciences":                 "中科院",
    "Renmin University of China":                  "人大",
    "Nanjing University":                          "南大",
    "Beihang University":                          "北航",
    "Chinese University of Hong Kong":             "CUHK",
    "Hong Kong University of Science and Technology": "HKUST",
    "University of Hong Kong":                     "HKU",
    "Korea Advanced Institute of Science and Technology": "KAIST",
    "Seoul National University":                   "SNU",
    "University of Tokyo":                         "U-Tokyo",
    "NVIDIA":                                      "NVIDIA",
    "Google":                                      "Google",
    "Google DeepMind":                             "DeepMind",
    "Meta":                                        "Meta",
    "Microsoft":                                   "Microsoft",
    "Apple":                                       "Apple",
    "OpenAI":                                      "OpenAI",
    "Anthropic":                                   "Anthropic",
}


def canonicalize_institution(openalex_name: str) -> str:
    return CANONICAL_INSTITUTION.get(openalex_name, openalex_name)


# ─── HTTP helpers ─────────────────────────────────────────────────────────
def http_get(url: str, retries: int = 3, verbose: bool = False) -> dict | None:
    if "mailto=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}mailto={POLITE_MAILTO}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pulsar-affiliation-enricher/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 or e.code >= 500:
                wait = 5 * (attempt + 1)
                if verbose:
                    print(f"  {e.code} retry in {wait}s: {url}", file=sys.stderr)
                time.sleep(wait)
                continue
            # Other 4xx (e.g. 400 for a renamed select field): return None instead
            # of raising, so one bad request can't crash the whole run and discard
            # ~100 fetches of cache progress (audit 2026-07-21).
            print(f"  http {e.code}: {url}", file=sys.stderr)
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            wait = 5 * (attempt + 1)
            if verbose:
                print(f"  transient retry in {wait}s ({e}): {url}", file=sys.stderr)
            time.sleep(wait)
    return None


def load_cache(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return {}
    return {}


def save_cache(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)


# ─── Pipeline data harvest ────────────────────────────────────────────────
ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", re.IGNORECASE)


def extract_papers_from_data(verbose: bool = False) -> list[tuple[str, str, str]]:
    """Scan src/data/ rating files; return list of (first_author_byline, arxiv_id, title)."""
    out = []
    seen_urls = set()
    # VLA rating-out files: each has papers[] with title, url, summary
    for fname in sorted(DATA_DIR.glob("vla-daily-rating-out-*.json")):
        try:
            d = json.loads(fname.read_text())
        except Exception:
            continue
        for p in d.get("papers", []):
            url = p.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)
            m = ARXIV_RE.search(url)
            if not m:
                continue
            arxiv_id = m.group(1)
            # `authors` field on rating-out papers is the byline as written —
            # e.g. "Chushan Zhang et al." or sometimes a single name. Strip the
            # trailing "et al" to get the first author.
            authors_raw = (p.get("authors", "") or "").strip()
            byline = re.sub(r"\s+et\s+al\.?\s*$", "", authors_raw, flags=re.IGNORECASE).strip()
            # Sometimes there are commas — take the first comma-separated chunk
            byline = byline.split(",")[0].strip()
            title = (p.get("title", "") or "").strip()
            out.append((byline, arxiv_id, title))
    # AI daily picks: same shape via different paper file
    for fname in sorted(DATA_DIR.glob("_ai_daily_pick_*.md")):
        # Markdown — extract arxiv URLs only (no byline easily)
        text = fname.read_text()
        for m in ARXIV_RE.finditer(text):
            arxiv_id = m.group(1)
            url = f"https://arxiv.org/abs/{arxiv_id}"
            if url in seen_urls:
                continue
            seen_urls.add(url)
            out.append(("", arxiv_id, ""))
    if verbose:
        print(f"  harvested {len(out)} unique arxiv IDs across rating files")
    return out


def fetch_paper_authorships(arxiv_id: str, cache: dict, verbose: bool = False) -> list[dict]:
    """Return list of {author_id, name, position, raw_affiliations[]} for an arxiv paper."""
    if arxiv_id in cache:
        return cache[arxiv_id]
    url = f"{OPENALEX_BASE}/works/doi:10.48550/arXiv.{arxiv_id}?select=authorships"  # doi: prefix (the /works/https://doi.org/... form 404s)
    j = http_get(url, verbose=verbose)
    if j is None or "authorships" not in j:
        cache[arxiv_id] = []
        return []
    rows = []
    for a in j["authorships"]:
        author = a.get("author", {}) or {}
        aid = author.get("id") or ""
        if aid.startswith("https://openalex.org/"):
            aid = aid.split("/")[-1]
        rows.append({
            "author_id": aid,
            "name":      author.get("display_name", ""),
            "position":  a.get("author_position", "middle"),
            "raw_affs":  a.get("raw_affiliation_strings", []) or [],
            "institutions": [
                {"id": inst.get("id", "").split("/")[-1], "name": inst.get("display_name", "")}
                for inst in a.get("institutions", []) or []
            ],
        })
    cache[arxiv_id] = rows
    return rows


def fetch_author_affiliation(author_id: str, cache: dict, verbose: bool = False) -> dict | None:
    """Return {last_known_institutions: [...], affiliations: [...]} for an OpenAlex author."""
    if author_id in cache:
        return cache[author_id]
    url = f"{OPENALEX_BASE}/authors/{author_id}?select=display_name,last_known_institutions,affiliations"
    j = http_get(url, verbose=verbose)
    if j is None:
        cache[author_id] = None
        return None
    cache[author_id] = {
        "display_name": j.get("display_name", ""),
        "last_known":   [inst.get("display_name", "") for inst in j.get("last_known_institutions", []) or []],
        "affiliations": [
            {
                "name": (a.get("institution", {}) or {}).get("display_name", ""),
                "country": (a.get("institution", {}) or {}).get("country_code", ""),
                "years": a.get("years", []),
            }
            for a in j.get("affiliations", []) or []
        ],
    }
    return cache[author_id]


def main(dry_run: bool = False, verbose: bool = False):
    print(f"=== Affiliation enrichment from OpenAlex ===")
    print(f"Reading rating files in {DATA_DIR}")
    papers = extract_papers_from_data(verbose=verbose)
    print(f"  {len(papers)} (byline, arxiv_id) pairs to process")

    paper_cache = load_cache(PAPER_CACHE)
    author_cache = load_cache(AUTHOR_CACHE)
    print(f"  paper cache: {len(paper_cache)} entries; author cache: {len(author_cache)} entries")

    # Phase 1: paper → authorships
    #
    # Indexing strategy (revised — user clarification):
    #   * First author (position 0)  — student / lead, primary talent target.
    #     Match against pulsar byline for high-confidence identification.
    #   * Second author (position 1, ONLY when paper has ≥3 authors)        —
    #     usually a co-mentee / fellow student. Add to talent pool but no
    #     pulsar-byline match available (rating-out only carries first byline).
    #   * Last author (position -1, ONLY when paper has ≥3 authors)         —
    #     usually the PI / corresponding author. Tracked separately for future
    #     师徒 mapping; NOT added to the talent pool's affiliation registry.
    #
    # Why ≥3 authors gate: in 2-author papers the "second" IS the last
    # (= corresponding/PI). Don't conflate worker vs PI.
    print("\nPhase 1: paper → OpenAlex authorships")
    new_paper_lookups = 0
    name_to_author_id: dict[str, str] = {}                   # talent: first + second author
    name_to_last_author_id: dict[str, str] = {}              # PIs (separate registry, future)
    raw_aff_by_name: dict[str, Counter] = defaultdict(Counter)
    # Co-author graph: arxiv_id → { title, authors[] }. Title lets site-side
    # readers (loadLabMentorship) compute primaryFamily for co-author trainees
    # who aren't in loadPeople's first-author pool — without that, ~75% of
    # mentorship-tree dots render as default grey.
    coauthor_graph: dict[str, dict] = {}
    paper_titles: dict[str, str] = {}  # arxiv_id → title (from rating-out files)
    for byline, arxiv_id, title in papers:
        if title:
            paper_titles[arxiv_id] = title
    for i, (byline, arxiv_id, _title) in enumerate(papers):
        was_cached = arxiv_id in paper_cache
        rows = fetch_paper_authorships(arxiv_id, paper_cache, verbose=verbose)
        if not was_cached:
            new_paper_lookups += 1
            time.sleep(SLEEP_S)
            if new_paper_lookups % 100 == 0:
                save_cache(PAPER_CACHE, paper_cache)
                print(f"  …{i+1}/{len(papers)} processed ({new_paper_lookups} new fetches)")
        if not rows:
            continue
        # Capture co-author graph for 师徒 visualization (paper-level).
        coauthor_graph[arxiv_id] = {
            "title":   paper_titles.get(arxiv_id, ""),
            "authors": [
                {"name": r["name"], "position": r["position"], "oa_id": r["author_id"]}
                for r in rows if r.get("author_id")
            ],
        }
        # Position-aware indexing.
        first = rows[0] if rows else None
        second = rows[1] if len(rows) >= 3 else None
        last = rows[-1] if len(rows) >= 3 else None

        # First author — match against pulsar byline for confidence.
        if first and byline:
            byline_norm = normalize_name(byline)
            oa_norm = normalize_name(first["name"])
            if byline_norm and oa_norm:
                bp, op = byline_norm.split(" "), oa_norm.split(" ")
                if bp[-1] == op[-1] and (bp[0][:1] == op[0][:1] or bp[0] == op[0]):
                    name_to_author_id.setdefault(byline_norm, first["author_id"])
                    for raw in first["raw_affs"]:
                        if raw:
                            raw_aff_by_name[byline_norm][raw] += 1

        # Second author — index by OpenAlex's display_name normalization
        # (no pulsar byline available to cross-check). Lower confidence but
        # adds a fresh pool of names that the byline-only path misses.
        if second and second.get("author_id"):
            sn = normalize_name(second["name"])
            if sn and len(sn.split()) >= 2:
                name_to_author_id.setdefault(sn, second["author_id"])
                for raw in second["raw_affs"]:
                    if raw:
                        raw_aff_by_name[sn][raw] += 1

        # Last author — PI tier, separate map. Don't pollute talent registry.
        if last and last.get("author_id"):
            ln = normalize_name(last["name"])
            if ln and len(ln.split()) >= 2:
                name_to_last_author_id.setdefault(ln, last["author_id"])

        # Raw-affiliation harvest for ALL authors (fallback when OpenAlex
        # last_known_institutions is empty).
        for r in rows:
            n = normalize_name(r["name"])
            if not n:
                continue
            for raw in r["raw_affs"]:
                if raw:
                    raw_aff_by_name[n][raw] += 1
    save_cache(PAPER_CACHE, paper_cache)
    print(f"  total paper fetches new: {new_paper_lookups}")
    print(f"  first+second authors matched: {len(name_to_author_id)}")
    print(f"  last authors (PIs) catalogued separately: {len(name_to_last_author_id)}")
    print(f"  co-author graph entries: {len(coauthor_graph)}")

    # Phase 2: author ID → last_known_institution.
    # Fetch for both talent (first+second) AND PI (last) IDs.
    print("\nPhase 2: author → OpenAlex last_known_institution")
    unique_author_ids = set(name_to_author_id.values()) | set(name_to_last_author_id.values())
    new_author_lookups = 0
    for i, aid in enumerate(sorted(unique_author_ids)):
        was_cached = aid in author_cache
        fetch_author_affiliation(aid, author_cache, verbose=verbose)
        if not was_cached:
            new_author_lookups += 1
            time.sleep(SLEEP_S)
            if new_author_lookups % 100 == 0:
                save_cache(AUTHOR_CACHE, author_cache)
                print(f"  …{i+1}/{len(unique_author_ids)} ({new_author_lookups} new fetches)")
    save_cache(AUTHOR_CACHE, author_cache)
    print(f"  author fetches new: {new_author_lookups}")

    # Phase 3: build the merged registry
    print("\nPhase 3: build institution-registry.json")
    existing = json.loads(REGISTRY_OUT.read_text()) if REGISTRY_OUT.exists() else {"all_institutions": {}, "researcher_affiliation": {}}
    researcher_aff = dict(existing.get("researcher_affiliation", {}))  # preserve hand-curated
    all_institutions = dict(existing.get("all_institutions", {}))

    # Resolve a single name → canonical institution. Prefer:
    #   1. OpenAlex last_known_institutions (current employer, deterministic)
    #   2. Most-frequent raw_affiliation_strings from paper authorships
    def resolve_institution(name_norm: str, aid: str) -> str | None:
        info = author_cache.get(aid)
        if info and info.get("last_known"):
            return info["last_known"][0]
        if raw_aff_by_name.get(name_norm):
            return raw_aff_by_name[name_norm].most_common(1)[0][0]
        return None

    enriched_first_second = 0
    enriched_pi = 0
    skipped_existing = 0
    before_count = len(researcher_aff)

    # ── Talent pool (first + second author) ─────────────────────────────
    for name_norm, aid in name_to_author_id.items():
        if name_norm in researcher_aff:
            skipped_existing += 1
            continue
        chosen = resolve_institution(name_norm, aid)
        if not chosen:
            continue
        canonical = canonicalize_institution(chosen)
        researcher_aff[name_norm] = canonical
        all_institutions.setdefault(canonical, [])
        if chosen not in all_institutions[canonical]:
            all_institutions[canonical].append(chosen)
        enriched_first_second += 1

    # ── PI list (last author = corresponding) ───────────────────────────
    # Separate registry so the UI can label these as PI / advisor when we
    # build 师徒 visualization, without polluting the talent pool.
    pi_aff: dict[str, str] = {}
    for name_norm, aid in name_to_last_author_id.items():
        chosen = resolve_institution(name_norm, aid)
        if not chosen:
            continue
        canonical = canonicalize_institution(chosen)
        pi_aff[name_norm] = canonical
        # Also surface PIs in the talent registry if they weren't already
        # captured as a first+second-author (some PIs also lead papers).
        if name_norm not in researcher_aff:
            researcher_aff[name_norm] = canonical
            all_institutions.setdefault(canonical, [])
            if chosen not in all_institutions[canonical]:
                all_institutions[canonical].append(chosen)
            enriched_pi += 1

    # ── Institution → country map ────────────────────────────────────────
    # The site's inferRegion() currently does substring matching on a
    # hard-coded list and misses 74% of post-enrichment affiliations
    # (UIUC, USTC, NUS, Tongji, HIT, Purdue, etc.). Emit a canonical
    # institution → country code map from the OpenAlex data we already
    # cached. talent.ts inferRegion consults this first.
    inst_country_votes: dict[str, Counter] = defaultdict(Counter)
    for info in author_cache.values():
        if not info:
            continue
        for a in info.get("affiliations", []):
            name = a.get("name", "")
            cc = (a.get("country", "") or "").lower()
            if name and cc:
                canonical = canonicalize_institution(name)
                inst_country_votes[canonical][cc] += 1
    institution_country: dict[str, str] = {}
    # Map ISO country code → our region bucket (cn / us / eu / other)
    EU_CCS = {"gb", "fr", "de", "ch", "nl", "be", "se", "no", "fi", "dk",
              "it", "es", "pt", "at", "ie", "pl", "cz", "ee", "lv", "lt",
              "lu", "gr", "hu", "ro", "bg", "hr", "si", "sk", "is"}
    for canonical, votes in inst_country_votes.items():
        if not votes:
            continue
        cc = votes.most_common(1)[0][0]
        if cc == "us":     region = "us"
        elif cc == "cn":   region = "cn"
        elif cc == "hk":   region = "cn"   # treat HK as CN for region facet
        elif cc == "tw":   region = "cn"   # opinionated; matches existing list (HKUST→cn etc.)
        elif cc in EU_CCS: region = "eu"
        else:              region = "other"
        institution_country[canonical] = region

    out = {
        "all_institutions":       all_institutions,
        "researcher_affiliation": researcher_aff,
        # PI registry: separate from researcher_affiliation so the UI can
        # distinguish "rated researcher" from "PI of a paper on the radar".
        "pi_affiliation":         pi_aff,
        # Institution → region map. Canonical institution name (after
        # CANONICAL_INSTITUTION pass) → 'cn' | 'us' | 'eu' | 'other'.
        # Built from OpenAlex country_codes per researcher × institution.
        "institution_region":     institution_country,
    }

    print(f"\n=== Summary ===")
    print(f"  before: {before_count} entries")
    print(f"  skipped (already in registry): {skipped_existing}")
    print(f"  enriched (first+second author): +{enriched_first_second}")
    print(f"  enriched (PI / last author): +{enriched_pi}")
    print(f"  PI registry entries: {len(pi_aff)}")
    print(f"  total researcher_affiliation: {len(researcher_aff)} (+{len(researcher_aff) - before_count})")

    if dry_run:
        print(f"\n[dry-run] would write {REGISTRY_OUT} and coauthor-graph.json")
        return

    tmp = REGISTRY_OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(REGISTRY_OUT)
    print(f"\n✅ wrote {REGISTRY_OUT}")

    # Co-author graph artifact (paper → author list with positions).
    # Used by future 师徒 / mentorship visualization. Stored separately so
    # the registry stays small + diffable; the graph is the data.
    graph_out = DATA_DIR / "coauthor-graph.json"
    graph_data = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "paper_count":  len(coauthor_graph),
        "papers":       coauthor_graph,
    }
    tmp = graph_out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(graph_data, ensure_ascii=False) + "\n")
    tmp.replace(graph_out)
    kb = graph_out.stat().st_size / 1024
    print(f"✅ wrote {graph_out} ({kb:.0f} KB)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()
    main(dry_run=args.dry_run, verbose=args.verbose)
