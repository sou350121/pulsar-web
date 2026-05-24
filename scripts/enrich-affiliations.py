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
  2. For each unique arxiv ID, query OpenAlex /works/arXiv:{id} for the
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
            raise
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


def extract_papers_from_data(verbose: bool = False) -> list[tuple[str, str]]:
    """Scan src/data/ rating files; return list of (first_author_byline, arxiv_id)."""
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
            out.append((byline, arxiv_id))
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
            out.append(("", arxiv_id))
    if verbose:
        print(f"  harvested {len(out)} unique arxiv IDs across rating files")
    return out


def fetch_paper_authorships(arxiv_id: str, cache: dict, verbose: bool = False) -> list[dict]:
    """Return list of {author_id, name, position, raw_affiliations[]} for an arxiv paper."""
    if arxiv_id in cache:
        return cache[arxiv_id]
    url = f"{OPENALEX_BASE}/works/https://doi.org/10.48550/arXiv.{arxiv_id}?select=authorships"
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
    print("\nPhase 1: paper → OpenAlex authorships")
    new_paper_lookups = 0
    name_to_first_author_id: dict[str, str] = {}  # normalized pulsar name → openalex author ID
    raw_aff_by_name: dict[str, Counter] = defaultdict(Counter)  # for raw fallback
    for i, (byline, arxiv_id) in enumerate(papers):
        was_cached = arxiv_id in paper_cache
        rows = fetch_paper_authorships(arxiv_id, paper_cache, verbose=verbose)
        if not was_cached:
            new_paper_lookups += 1
            time.sleep(SLEEP_S)
            if new_paper_lookups % 50 == 0:
                save_cache(PAPER_CACHE, paper_cache)
                print(f"  …{i+1}/{len(papers)} processed ({new_paper_lookups} new fetches)")
        if not rows:
            continue
        # Match pulsar's extracted byline to OpenAlex's first-position author
        first = next((r for r in rows if r["position"] == "first"), rows[0] if rows else None)
        if not first:
            continue
        if byline:
            byline_norm = normalize_name(byline)
            oa_norm = normalize_name(first["name"])
            if byline_norm and oa_norm:
                # Accept if surname matches AND given-name initial matches
                bp, op = byline_norm.split(" "), oa_norm.split(" ")
                if bp[-1] == op[-1] and (bp[0][:1] == op[0][:1] or bp[0] == op[0]):
                    name_to_first_author_id.setdefault(byline_norm, first["author_id"])
                    # Also collect raw affiliations as a fallback
                    for raw in first["raw_affs"]:
                        if raw:
                            raw_aff_by_name[byline_norm][raw] += 1
        # For middle/last authors too — store raw affs against their normalized name
        for r in rows:
            n = normalize_name(r["name"])
            if not n:
                continue
            for raw in r["raw_affs"]:
                if raw:
                    raw_aff_by_name[n][raw] += 1
    save_cache(PAPER_CACHE, paper_cache)
    print(f"  total paper fetches new: {new_paper_lookups}; matched names: {len(name_to_first_author_id)}")

    # Phase 2: author ID → last_known_institution
    print("\nPhase 2: author → OpenAlex last_known_institution")
    unique_author_ids = set(name_to_first_author_id.values())
    new_author_lookups = 0
    for i, aid in enumerate(sorted(unique_author_ids)):
        was_cached = aid in author_cache
        fetch_author_affiliation(aid, author_cache, verbose=verbose)
        if not was_cached:
            new_author_lookups += 1
            time.sleep(SLEEP_S)
            if new_author_lookups % 50 == 0:
                save_cache(AUTHOR_CACHE, author_cache)
                print(f"  …{i+1}/{len(unique_author_ids)} ({new_author_lookups} new fetches)")
    save_cache(AUTHOR_CACHE, author_cache)
    print(f"  author fetches new: {new_author_lookups}")

    # Phase 3: build the merged registry
    print("\nPhase 3: build institution-registry.json")
    existing = json.loads(REGISTRY_OUT.read_text()) if REGISTRY_OUT.exists() else {"all_institutions": {}, "researcher_affiliation": {}}
    researcher_aff = dict(existing.get("researcher_affiliation", {}))  # preserve hand-curated
    all_institutions = dict(existing.get("all_institutions", {}))

    # Per author, take last_known_institution (canonical current employer).
    # If empty (rare), fall back to most-frequent recent raw affiliation from papers.
    enriched = 0
    skipped_manual = 0
    for name_norm, aid in name_to_first_author_id.items():
        if name_norm in researcher_aff:
            # Don't overwrite manual curation
            skipped_manual += 1
            continue
        info = author_cache.get(aid)
        chosen = None
        if info and info.get("last_known"):
            chosen = info["last_known"][0]
        elif raw_aff_by_name.get(name_norm):
            # Pick most-frequent raw affiliation string
            chosen = raw_aff_by_name[name_norm].most_common(1)[0][0]
        if not chosen:
            continue
        canonical = canonicalize_institution(chosen)
        researcher_aff[name_norm] = canonical
        all_institutions.setdefault(canonical, [])
        if chosen not in all_institutions[canonical]:
            all_institutions[canonical].append(chosen)
        enriched += 1

    out = {
        "all_institutions":       all_institutions,
        "researcher_affiliation": researcher_aff,
    }

    print(f"\n=== Summary ===")
    print(f"  before: {len(existing.get('researcher_affiliation', {}))} entries")
    print(f"  manual entries preserved: {skipped_manual}")
    print(f"  enriched from OpenAlex: {enriched}")
    print(f"  after: {len(researcher_aff)} entries (+{len(researcher_aff) - len(existing.get('researcher_affiliation', {}))})")

    if dry_run:
        print(f"\n[dry-run] would write {REGISTRY_OUT}")
        return

    tmp = REGISTRY_OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(REGISTRY_OUT)
    print(f"\n✅ wrote {REGISTRY_OUT}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()
    main(dry_run=args.dry_run, verbose=args.verbose)
