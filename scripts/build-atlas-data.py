#!/usr/bin/env python3.11
"""
scripts/build-atlas-data.py
----------------------------
Builds atlas-papers.json from:
  1. atlas-curated.json  — human-curated base (committed in repo)
  2. field-state-*.json  — method family acceleration → momentum scores
  3. vla-daily-rating-out-*.json (last 7 days) — auto-inject ⚡ + code 🔧 papers

Output: /home/admin/clawd/memory/atlas-papers.json
  (sync-data.py copies it to src/data/ at build time)

Zero LLM calls. Runs in <5s. Called by push-pulsar-web.sh before sync-data.
"""

import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR  = Path(__file__).resolve().parent
MEMORY_DIR  = Path("/home/admin/clawd/memory")
MEMORY_TMP  = MEMORY_DIR / "tmp"
SCRIPTS_DIR = Path("/home/admin/clawd/scripts")

# atlas-curated.json lives in the pulsar-web repo src/data/
CURATED_PATH = SCRIPT_DIR.parent / "src" / "data" / "atlas-curated.json"
OUTPUT_PATH  = MEMORY_DIR / "atlas-papers.json"

RECENT_DAYS = 7  # rolling window for auto-injected papers


# ---------------------------------------------------------------------------
# Method family → Atlas category mapping
# ---------------------------------------------------------------------------
def load_atlas_category_map() -> dict[str, str]:
    """
    Try to import METHOD_FAMILIES from _vla_method_families.py and extract
    atlas_category mappings. Falls back to a hardcoded default if import fails.
    """
    default_map = {
        "diffusion_policy":    "action",
        "flow_matching":       "action",
        "world_model":         "wm",
        "rl_finetuning":       "learn",
        "instruction_tuning":  "e2e",
        "tactile":             "tactile",
        "dexterous_hand":      "tactile",
        "cross_embodiment":    "scale",
        "visual_pretraining":  "foundations",
        "sim2real":            "sim",
        "imitation_learning":  "learn",
        "chain_of_thought":    "reason",
        "language_grounding":  "e2e",
        "hierarchical_policy": "modular",
        "efficient_inference": "compact",
    }

    try:
        sys.path.insert(0, str(SCRIPTS_DIR))
        from _vla_method_families import METHOD_FAMILIES
        result = {}
        for family_id, family_def in METHOD_FAMILIES.items():
            if isinstance(family_def, dict) and "atlas_category" in family_def:
                result[family_id] = family_def["atlas_category"]
            elif family_id in default_map:
                result[family_id] = default_map[family_id]
        # Merge any defaults not covered by METHOD_FAMILIES
        for k, v in default_map.items():
            if k not in result:
                result[k] = v
        return result
    except Exception:
        return default_map


# ---------------------------------------------------------------------------
# Load field state → momentum
# ---------------------------------------------------------------------------
def load_momentum(cat_map: dict[str, str]) -> dict[str, float]:
    """
    Read the latest field-state-*.json and compute per-atlas-category momentum
    from method family acceleration scores.
    """
    pattern = str(MEMORY_DIR / "field-state-*.json")
    files = sorted(glob.glob(pattern), reverse=True)
    if not files:
        return {}

    try:
        with open(files[0]) as f:
            state = json.load(f)
    except Exception:
        return {}

    # Aggregate acceleration by atlas category
    cat_scores: dict[str, list[float]] = {}
    trends = state.get("method_trends", {})
    for family_id, trend_data in trends.items():
        cat_id = cat_map.get(family_id)
        if not cat_id:
            continue
        # Extract acceleration score (daily_avg or trend_score)
        score = 0.0
        if isinstance(trend_data, dict):
            score = trend_data.get("acceleration", trend_data.get("daily_avg", 0.0))
        elif isinstance(trend_data, (int, float)):
            score = float(trend_data)
        if score:
            cat_scores.setdefault(cat_id, []).append(score)

    # Average per category, scale to 0-6 range
    result = {}
    for cat_id, scores in cat_scores.items():
        avg = sum(scores) / len(scores)
        # Clamp to reasonable range
        result[cat_id] = round(max(0.0, min(6.0, avg)), 1)

    return result


# ---------------------------------------------------------------------------
# Auto-inject recent papers
# ---------------------------------------------------------------------------
def load_recent_papers(cat_map: dict[str, str]) -> dict[str, list[dict]]:
    """
    Scan the last RECENT_DAYS of VLA rating files for ⚡ papers and 🔧 papers
    with code. Return them grouped by atlas category.
    """
    cutoff = (datetime.now() - timedelta(days=RECENT_DAYS)).strftime("%Y-%m-%d")
    pattern = str(MEMORY_TMP / "vla-daily-rating-out-*.json")
    files = sorted(glob.glob(pattern), reverse=True)

    injected: dict[str, list[dict]] = {}
    seen_titles: set[str] = set()

    for filepath in files:
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", filepath)
        if not date_match:
            continue
        date_str = date_match.group(1)
        if date_str < cutoff:
            continue

        try:
            with open(filepath) as f:
                data = json.load(f)
        except Exception:
            continue

        for paper in data.get("papers", []):
            rating = paper.get("rating", "")
            repo_url = paper.get("repo_url", "")

            # Only ⚡ papers and 🔧 papers with code
            if rating == "⚡":
                pass  # always inject
            elif rating == "🔧" and repo_url:
                pass  # inject if has code
            else:
                continue

            title = paper.get("title", "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)

            # Determine atlas category from method families
            matched_kw = paper.get("keywords_matched", [])
            target_cat = "e2e"  # fallback
            for kw in matched_kw:
                kw_norm = kw.lower().replace(" ", "_").replace("-", "_")
                if kw_norm in cat_map:
                    target_cat = cat_map[kw_norm]
                    break

            # Build compact paper entry
            entry = {
                "n": _short_name(title),
                "t": title,
                "o": paper.get("reason", paper.get("abstract_snippet", ""))[:80],
                "v": f"arXiv'{date_str[2:4]}",
                "isNew": True,
            }
            # Extract arxiv ID from URL
            url = paper.get("url", "")
            ax_match = re.search(r"arxiv\.org/abs/(\S+)", url)
            if ax_match:
                entry["ax"] = ax_match.group(1)
            if repo_url:
                entry["c"] = repo_url
            if rating == "⚡":
                entry["f"] = 1

            injected.setdefault(target_cat, []).append(entry)

    return injected


def _short_name(title: str) -> str:
    """Extract a short name from a paper title (first significant word/acronym)."""
    # Common pattern: "Name: Subtitle" or "NAME - description"
    for sep in [":", " - ", " — "]:
        if sep in title:
            name = title.split(sep)[0].strip()
            if len(name) <= 30:
                return name
    # Fallback: first 3 words
    words = title.split()[:3]
    return " ".join(words)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    # 1. Load curated base
    if not CURATED_PATH.exists():
        print(f"ERROR: curated file not found: {CURATED_PATH}")
        sys.exit(1)

    with open(CURATED_PATH) as f:
        curated = json.load(f)

    categories = curated.get("categories", [])
    if not categories:
        print("ERROR: no categories in curated file")
        sys.exit(1)

    # 2. Load method family → atlas category mapping
    cat_map = load_atlas_category_map()

    # 3. Compute momentum from field state
    momentum = load_momentum(cat_map)

    # 4. Load recent papers for auto-injection
    recent = load_recent_papers(cat_map)

    # 5. Merge recent papers into categories
    for cat in categories:
        cat_recent = recent.get(cat["id"], [])
        if cat_recent:
            # Find the first subcategory to inject into (or create a "Recent" sub)
            if cat["subs"]:
                # Add recentPapers to the first subcategory
                cat["subs"][0].setdefault("recentPapers", []).extend(cat_recent)

        # Apply momentum overlay
        if cat["id"] in momentum:
            cat["momentum"] = momentum[cat["id"]]

    # 6. Compute stats
    all_papers = []
    for c in categories:
        for s in c["subs"]:
            all_papers.extend(s.get("papers", []))
            all_papers.extend(s.get("recentPapers", []))

    stats = {
        "total":    len(all_papers),
        "featured": sum(1 for p in all_papers if p.get("f")),
        "code":     sum(1 for p in all_papers if p.get("c")),
        "cats":     len(categories),
    }

    # 7. Write output
    output = {
        "categories": categories,
        "stats":      stats,
        "momentum":   momentum,
        "updated":    datetime.now().strftime("%Y-%m-%d"),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    recent_count = sum(len(v) for v in recent.values())
    print(f"atlas-papers.json: {stats['total']} papers ({stats['featured']} featured, "
          f"{stats['code']} code, {recent_count} recent), "
          f"{len(momentum)} momentum scores")


if __name__ == "__main__":
    main()
