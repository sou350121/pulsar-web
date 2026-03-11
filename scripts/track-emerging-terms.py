#!/usr/bin/env python3.11
"""
scripts/track-emerging-terms.py — Emerging Method Family Detection for VLA pipeline.

~40-57% of VLA papers are NOT matched by any known method family. This script finds
recurring n-grams in unmatched papers that may represent emerging methodologies.

Architecture: counter-first + optional LLM verification.
  Phase 1: Mechanical tokenisation & counting (zero LLM)
  Phase 2: Candidate detection (frequency + velocity thresholds)
  Phase 3: LLM verification via qwen3.5-plus (gated by --llm flag)

Re-run safe: merges with existing emerging-terms.json (preserves promoted/archive).
Output: memory/emerging-terms.json (atomic write)
"""
from __future__ import annotations

__author__ = "Pulsar pipeline"

import argparse, glob, json, logging, os, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("track-emerging-terms")
log.addHandler(logging.StreamHandler(sys.stderr))
log.setLevel(logging.WARNING)

MEMORY_DIR  = Path("/home/admin/clawd/memory")
SCRIPTS_DIR = Path("/home/admin/clawd/scripts")
TZ_CST = timezone(timedelta(hours=8))

# Known method family terms to exclude (fallback if _vla_method_families.py unavailable)
_HARDCODED_FAMILY_TERMS: set[str] = {
    "diffusion policy", "flow matching", "rl finetuning", "reinforcement learning",
    "instruction tuning", "world model", "tactile", "dexterous hand",
    "cross embodiment", "sim to real", "sim2real", "visual pretraining",
    "imitation learning", "chain of thought", "language grounding",
    "hierarchical policy", "efficient inference", "behavior cloning",
}

def _load_family_terms() -> set[str]:
    """Build exclusion set, dynamically from _vla_method_families.py if available."""
    terms = set(_HARDCODED_FAMILY_TERMS)
    try:
        sys.path.insert(0, str(SCRIPTS_DIR))
        from _vla_method_families import METHOD_FAMILIES
        for fam_id, fam_def in METHOD_FAMILIES.items():
            terms.add(fam_id.replace("_", " "))
            if isinstance(fam_def, dict):
                for key in ("regex", "keywords", "pattern"):
                    val = fam_def.get(key)
                    if isinstance(val, str):
                        for part in re.split(r"[|()]", val):
                            clean = re.sub(r"[\\.*+?\[\]{}^$]", "",
                                           part.strip().replace(r"\s+", " ").replace(r"\b", "")).strip()
                            if len(clean) > 2:
                                terms.add(clean.lower())
                    elif isinstance(val, (list, tuple)):
                        terms.update(kw.lower() for kw in val if isinstance(kw, str) and len(kw) > 2)
    except Exception as exc:
        log.debug("Could not import METHOD_FAMILIES: %s", exc)
    return terms

# Academic n-gram stopwords
ACADEMIC_STOPWORDS: set[str] = {
    "neural network", "neural networks", "deep learning", "machine learning",
    "state of the art", "state art", "large language model", "large language models",
    "proposed method", "proposed approach", "experimental results", "experimental evaluation",
    "real world", "end to end", "language model", "language models", "training data",
    "test time", "pre trained", "pre training", "fine tuning", "fine tuned",
    "natural language", "natural language processing", "computer vision", "open source",
    "benchmark results", "zero shot", "few shot", "transformer based", "attention mechanism",
    "reward model", "reward models", "policy learning", "this paper", "we propose",
    "we present", "we introduce", "our method", "our approach", "ablation study",
    "foundation model", "foundation models", "robot learning", "robotic manipulation",
    "autonomous driving", "action prediction", "action predictions", "multi modal",
    "multimodal", "vision language", "vision language action", "vision language model",
    "vision language models",
}

# Single-word stops filtered before n-gram assembly
_WORD_STOPS: set[str] = {
    "the", "a", "an", "and", "or", "but", "in", "on", "of", "to", "for", "with", "by",
    "from", "at", "is", "are", "was", "were", "be", "been", "that", "this", "it", "its",
    "as", "we", "our", "can", "has", "have", "not", "no", "do", "does", "did", "will",
    "would", "should", "could", "may", "might", "than", "also", "more", "most", "such",
    "each", "other", "some", "any", "all", "both", "new", "via", "using", "based", "show",
    "shows", "shown", "use", "used", "model", "models", "method", "methods", "approach",
    "task", "tasks", "data", "results", "paper", "propose", "proposed", "demonstrate",
    "performance", "achieve", "achieved", "significant", "significantly", "effectively",
    "novel", "learning", "training", "evaluation", "experiments", "experiment", "existing",
    "previous", "different", "including", "between", "across", "through", "over", "into",
    "about", "these", "those", "two", "three", "first", "second", "one", "well", "however",
    "while", "where", "when", "how", "what", "which", "who", "their", "them",
}

_TOKEN_RE = re.compile(r"[a-z][a-z0-9]{1,25}")

def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _WORD_STOPS and len(t) > 1]

def extract_ngrams(tokens: list[str], ns: tuple[int, ...] = (2, 3)) -> list[str]:
    grams: list[str] = []
    for n in ns:
        for i in range(len(tokens) - n + 1):
            grams.append(" ".join(tokens[i:i + n]))
    return grams

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_rating_files(memory_tmp: Path, window_days: int) -> tuple[list[dict], int, int]:
    """Load VLA daily rating-out files within the window.
    Returns (all_papers, total_count, unmatched_count)."""
    cutoff = (datetime.now() - timedelta(days=window_days)).strftime("%Y-%m-%d")
    files = sorted(glob.glob(str(memory_tmp / "vla-daily-rating-out-*.json")), reverse=True)
    all_papers: list[dict] = []
    total = unmatched = 0
    for filepath in files:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", filepath)
        if not m or m.group(1) < cutoff:
            continue
        date_str = m.group(1)
        try:
            with open(filepath) as f:
                data = json.load(f)
        except Exception:
            log.warning("Failed to read %s", filepath)
            continue
        for paper in data.get("papers", []):
            total += 1
            kw = paper.get("keywords_matched", [])
            if not kw:
                unmatched += 1
            all_papers.append({
                "date": date_str, "title": paper.get("title", ""),
                "abstract_snippet": paper.get("abstract_snippet", ""),
                "rating": paper.get("rating", ""), "keywords_matched": kw,
            })
    return all_papers, total, unmatched

def load_existing(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

# ---------------------------------------------------------------------------
# Phase 1+2: Count n-grams & detect candidates
# ---------------------------------------------------------------------------
def compute_candidates(
    papers: list[dict], family_terms: set[str], min_days: int = 3, min_total: int = 3,
) -> tuple[list[dict], dict]:
    daily_counts: dict[str, dict[str, int]] = {}
    sample_titles: dict[str, list[str]] = {}
    total_ngrams = 0
    all_stops = ACADEMIC_STOPWORDS | family_terms

    for paper in papers:
        if paper.get("keywords_matched"):
            continue  # skip matched papers
        date = paper["date"]
        tokens = tokenize(f"{paper['title']} {paper.get('abstract_snippet', '')}")
        ngrams = extract_ngrams(tokens)
        total_ngrams += len(ngrams)
        for gram in ngrams:
            if gram in all_stops:
                continue
            daily_counts.setdefault(gram, {})
            daily_counts[gram][date] = daily_counts[gram].get(date, 0) + 1
            titles = sample_titles.setdefault(gram, [])
            t = paper["title"]
            if t and t not in titles and len(titles) < 3:
                titles.append(t)

    after_filter = len(daily_counts)
    candidates: list[dict] = []
    for gram, day_map in daily_counts.items():
        days_active = len(day_map)
        total_count = sum(day_map.values())
        if days_active < min_days or total_count < min_total:
            continue
        sorted_dates = sorted(day_map.keys())
        counts = [day_map[d] for d in sorted_dates]
        # Velocity = avg day-over-day change; acceleration = second derivative
        if len(counts) >= 2:
            deltas = [counts[i] - counts[i - 1] for i in range(1, len(counts))]
            velocity = round(sum(deltas) / len(deltas), 2)
            acceleration = (round(sum(deltas[i] - deltas[i - 1] for i in range(1, len(deltas)))
                                  / (len(deltas) - 1), 2) if len(deltas) >= 2 else 0.0)
        else:
            velocity = acceleration = 0.0
        days_since = (datetime.now() - datetime.strptime(sorted_dates[0], "%Y-%m-%d")).days
        status = "new" if days_since <= 3 else ("rising" if acceleration > 1.0 else "candidate")
        candidates.append({
            "term": gram, "normalized": gram.replace(" ", "_"),
            "first_seen": sorted_dates[0], "last_seen": sorted_dates[-1],
            "daily_counts": dict(sorted(day_map.items())),
            "total_count": total_count, "days_active": days_active,
            "velocity": velocity, "acceleration": acceleration, "status": status,
            "sample_titles": sample_titles.get(gram, []),
            "llm_verified": None, "llm_verdict": None,
        })
    candidates.sort(key=lambda c: (-c["total_count"], -c["days_active"]))
    stats = {
        "total_ngrams_extracted": total_ngrams, "after_stopword_filter": after_filter,
        "candidates_count": len(candidates), "promoted_count": 0,
    }
    return candidates, stats

# ---------------------------------------------------------------------------
# Phase 3: LLM verification (optional, gated by --llm)
# ---------------------------------------------------------------------------
def _load_api_key() -> str | None:
    key = os.environ.get("DASHSCOPE_API_KEY")
    if key:
        return key
    dotenv = Path("/home/admin/.clawdbot/.env")
    if dotenv.exists():
        try:
            for line in dotenv.read_text().splitlines():
                if line.strip().startswith("DASHSCOPE_API_KEY="):
                    return line.strip().split("=", 1)[1].strip().strip("'\"")
        except Exception:
            pass
    return None

def llm_verify_candidates(candidates: list[dict], top_n: int = 5) -> list[dict]:
    """Verify top_n candidates via qwen3.5-plus. Mutates in place."""
    import urllib.request
    api_key = _load_api_key()
    if not api_key:
        log.error("No DASHSCOPE_API_KEY found; skipping LLM verification")
        return candidates
    url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    to_verify = [c for c in candidates if c.get("llm_verified") is None][:top_n]
    for cand in to_verify:
        term, samples = cand["term"], "; ".join(cand.get("sample_titles", [])[:3])
        prompt = (
            f"In VLA (Vision-Language-Action) robotics research, is '{term}' a distinct "
            f"methodology or technique family? Papers: {samples}\n\n"
            f'Answer JSON: {{"is_method": true/false, "confidence": 0.0-1.0, '
            f'"reason": "brief", "suggested_family_name": "snake_case or null"}}'
        )
        body = json.dumps({
            "model": "qwen-plus", "temperature": 0.1, "max_tokens": 300,
            "messages": [
                {"role": "system", "content": "You are a VLA robotics research expert."},
                {"role": "user", "content": prompt},
            ],
        }).encode()
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = json.loads(resp.read().decode())["choices"][0]["message"]["content"]
            m = re.search(r"\{[^}]+\}", content, re.DOTALL)
            if m:
                verdict = json.loads(m.group())
                cand["llm_verified"] = True
                cand["llm_verdict"] = verdict
                if verdict.get("is_method") and verdict.get("confidence", 0) >= 0.7:
                    cand["status"] = "promoted"
                log.info("LLM verified '%s': %s", term, verdict)
            else:
                cand["llm_verified"], cand["llm_verdict"] = True, {"raw": content}
        except Exception as exc:
            log.warning("LLM call failed for '%s': %s", term, exc)
            cand["llm_verified"], cand["llm_verdict"] = False, {"error": str(exc)}
    return candidates

# ---------------------------------------------------------------------------
# Merge with existing data
# ---------------------------------------------------------------------------
def merge_existing(new_cands: list[dict], existing: dict) -> tuple[list[dict], list[dict], list[dict]]:
    promoted = existing.get("promoted", [])
    archive = existing.get("archive", [])
    old_by_term = {c.get("normalized", c.get("term", "")): c for c in existing.get("candidates", [])}
    merged: list[dict] = []
    for cand in new_cands:
        norm = cand["normalized"]
        old = old_by_term.get(norm)
        if old:
            # Preserve prior LLM results and promoted status
            if old.get("llm_verified") is not None and cand.get("llm_verified") is None:
                cand["llm_verified"] = old["llm_verified"]
                cand["llm_verdict"] = old.get("llm_verdict")
            if old.get("status") == "promoted":
                cand["status"] = "promoted"
            if old.get("first_seen", "9999") < cand.get("first_seen", "9999"):
                cand["first_seen"] = old["first_seen"]
        merged.append(cand)
    still, promoted_norms = [], {p.get("normalized") for p in promoted}
    for cand in merged:
        if cand["status"] == "promoted":
            if cand["normalized"] not in promoted_norms:
                promoted.append(cand)
                promoted_norms.add(cand["normalized"])
        else:
            still.append(cand)
    return still, promoted, archive

# ---------------------------------------------------------------------------
# Atomic write
# ---------------------------------------------------------------------------
def atomic_write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.rename(path)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def _empty_output(window_days: int) -> dict:
    return {
        "date": datetime.now().strftime("%Y-%m-%d"), "window_days": window_days,
        "total_papers_scanned": 0, "unmatched_papers": 0,
        "candidates": [], "promoted": [], "archive": [],
        "stats": {"total_ngrams_extracted": 0, "after_stopword_filter": 0,
                  "candidates_count": 0, "promoted_count": 0},
        "updated_at": datetime.now(TZ_CST).strftime("%Y-%m-%dT%H:%M:%S+08:00"),
    }

def main() -> None:
    ap = argparse.ArgumentParser(description="Detect emerging VLA method family terms.")
    ap.add_argument("--memory-dir", type=Path, default=MEMORY_DIR,
                    help="Base memory directory (default: /home/admin/clawd/memory)")
    ap.add_argument("--window-days", type=int, default=7, help="Rolling window in days (default: 7)")
    ap.add_argument("--llm", action="store_true", help="Enable LLM verification (qwen3.5-plus)")
    ap.add_argument("--dry-run", action="store_true", help="Print output to stdout; don't write file")
    ap.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")
    args = ap.parse_args()
    if args.verbose:
        log.setLevel(logging.DEBUG)

    memory_dir = args.memory_dir
    output_path = memory_dir / "emerging-terms.json"

    papers, total_scanned, unmatched_count = load_rating_files(memory_dir / "tmp", args.window_days)
    if not papers:
        log.warning("No rating files found for the last %d days", args.window_days)
        out = _empty_output(args.window_days)
        if args.dry_run:
            print(json.dumps(out, indent=2, ensure_ascii=False))
        else:
            atomic_write(output_path, out)
        return

    log.info("Loaded %d papers (%d unmatched)", total_scanned, unmatched_count)
    candidates, stats = compute_candidates(papers, _load_family_terms())
    log.info("Found %d candidates meeting threshold", len(candidates))

    if args.llm:
        candidates = llm_verify_candidates(candidates, top_n=5)

    existing = load_existing(output_path)
    candidates, promoted, archive = merge_existing(candidates, existing)
    stats["promoted_count"] = len(promoted)

    now_str = datetime.now(TZ_CST).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    output = {
        "date": datetime.now().strftime("%Y-%m-%d"), "window_days": args.window_days,
        "total_papers_scanned": total_scanned, "unmatched_papers": unmatched_count,
        "candidates": candidates, "promoted": promoted, "archive": archive,
        "stats": stats, "updated_at": now_str,
    }
    if args.dry_run:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        atomic_write(output_path, output)
        log.info("Wrote %d candidates (%d promoted) to %s", len(candidates), len(promoted), output_path)

    print(f"[track-emerging-terms] scanned={total_scanned} unmatched={unmatched_count} "
          f"candidates={len(candidates)} promoted={len(promoted)}", file=sys.stderr)

if __name__ == "__main__":
    main()
