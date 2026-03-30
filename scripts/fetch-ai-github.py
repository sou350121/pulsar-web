#!/usr/bin/env python3
"""
scripts/fetch-ai-github.py
---------------------------
Fetches ALL theory articles from the sou350121/Agent-Playbook GitHub repo
and writes them to src/data/ai-github-theory.json (local pulsar-web checkout)
and /home/admin/clawd/memory/ai-github-theory.json (server, if writable).

Date logic: preserves dates from previous runs for unchanged files (by SHA).
New or modified files get today's date.

Module-to-topic mapping mirrors the Agent-Playbook theory/ structure:
  01-principles  -> 底層原理
  02-agent-design -> Agent設計
  03-engineering -> 工程實戰
  04-paradigm    -> 範式轉變
  05-strategy    -> 戰略生存
  06-frontier    -> 前沿研究

Uses only stdlib urllib.request — no external dependencies.
Compatible with Python 3.6+.
"""

import json
import os
import re
import sys
import time
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR  = Path(__file__).resolve().parent
DATA_DIR    = SCRIPT_DIR.parent / "src" / "data"
OUTPUT_FILE = DATA_DIR / "ai-github-theory.json"
SERVER_FILE = Path("/home/admin/clawd/memory/ai-github-theory.json")
REPO        = "sou350121/Agent-Playbook"
MAX_FILES   = 300
RATE_SLEEP  = 0.1   # seconds between API calls

# Module label mapping (Chinese)
MODULE_LABELS = {
    "01-principles":   "底層原理",
    "02-agent-design": "Agent設計",
    "03-engineering":  "工程實戰",
    "04-paradigm":     "範式轉變",
    "05-strategy":     "戰略生存",
    "06-frontier":     "前沿研究",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_token():
    """Get GitHub token from environment or git remote or env file."""
    # 1. Environment variable
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN", "")
    if token:
        return token

    # 2. pulsar-web git remote (has embedded token)
    try:
        remote_url = (SCRIPT_DIR.parent / ".git" / "config").read_text()
        m = re.search(r"https://[^:]+:([^@]+)@github\.com", remote_url)
        if m:
            return m.group(1)
    except Exception:
        pass

    # 3. Server env file
    env_file = Path("/home/admin/.clawdbot/.env")
    try:
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GITHUB_TOKEN="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass

    return ""


def github_api(path, token):
    """Make a GitHub API request and return parsed JSON."""
    url = "https://api.github.com/{}".format(path)
    req = urllib.request.Request(url, headers={
        "Authorization": "token {}".format(token),
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "pulsar-sync/1.0"
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_title(content_b64, filename):
    """
    Extract article title from base64-encoded file content.
    Uses first '# Heading' line; falls back to filename.
    """
    try:
        raw = base64.b64decode(content_b64).decode("utf-8", errors="replace")
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                title = re.sub(r"^#+\s*", "", stripped).strip()
                if title:
                    return title
    except Exception:
        pass
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ").title()


def extract_date_from_filename(filename):
    """Try to extract YYYY-MM-DD from a filename."""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    return m.group(1) if m else None


def derive_module(path_str):
    """
    Extract module directory from theory/ path.
    e.g. 'theory/03-engineering/context-engineering.md' -> '03-engineering'
    """
    parts = path_str.split("/")
    if len(parts) >= 3:
        return parts[1]
    return "general"


def derive_topic(module):
    """Map module to Chinese label."""
    return MODULE_LABELS.get(module, module)


def derive_slug(path_str):
    """Extract slug (filename without .md) from path."""
    return Path(path_str).stem


def should_include(path_str):
    """Filter function for theory file paths."""
    if not path_str.startswith("theory/"):
        return False
    if not path_str.endswith(".md"):
        return False
    if "/README" in path_str:
        return False
    # Skip deep_dive files (generated content)
    if "_deep_dive.md" in path_str:
        return False
    return True


def load_previous_output():
    """
    Load previous output file to build path -> {date, sha, title, module, slug} map.
    Used for date preservation on unchanged files.
    """
    prev = {}
    try:
        if OUTPUT_FILE.exists():
            data = json.loads(OUTPUT_FILE.read_text())
            for a in data.get("articles", []):
                path = a.get("path", "")
                if path:
                    prev[path] = {
                        "date":   a.get("date", ""),
                        "sha":    a.get("sha", ""),
                        "title":  a.get("title", ""),
                        "module": a.get("module", ""),
                        "slug":   a.get("slug", ""),
                    }
    except Exception as e:
        print("WARN: could not load previous output: {}".format(e))
    return prev


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("fetch-ai-github.py -- fetching theory articles from {}".format(REPO))

    # Load token
    token = get_token()
    if not token:
        print("ERROR: GITHUB_TOKEN not found")
        raise SystemExit(1)
    print("  Token: {}...".format(token[:8]))

    # Load previous output for date preservation
    prev = load_previous_output()
    if prev:
        print("  Previous output: {} articles (for date preservation)".format(len(prev)))
    else:
        print("  No previous output -- all files get today's date")

    # Step 1: fetch full tree
    print("\nStep 1: fetching repo tree (recursive)...")
    try:
        tree_data = github_api(
            "repos/{}/git/trees/main?recursive=1".format(REPO),
            token
        )
    except urllib.error.HTTPError as e:
        print("ERROR: tree fetch failed: {} {}".format(e.code, e.reason))
        raise SystemExit(1)

    blobs = tree_data.get("tree", [])
    theory_files = [
        item for item in blobs
        if item.get("type") == "blob" and should_include(item.get("path", ""))
    ]
    print("  Found {} theory .md files (before cap)".format(len(theory_files)))

    # Cap to MAX_FILES
    theory_files = sorted(theory_files, key=lambda x: x["path"])[:MAX_FILES]
    print("  Processing {} files (cap={})".format(len(theory_files), MAX_FILES))

    # Step 2: fetch each file's metadata
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    articles = []
    reused_dates = 0
    new_dates = 0
    by_module = {}

    for i, item in enumerate(theory_files, 1):
        path_str = item["path"]
        blob_sha = item.get("sha", "")
        filename = path_str.split("/")[-1]
        module = derive_module(path_str)
        topic = derive_topic(module)
        slug = derive_slug(path_str)
        html_url = "https://github.com/{}/blob/main/{}".format(REPO, path_str)

        sys.stdout.write("  [{:3d}/{}] {}".format(i, len(theory_files), path_str))
        sys.stdout.flush()

        # Rate limiting
        if i > 1:
            time.sleep(RATE_SLEEP)

        # Date logic: preserve from previous run if SHA unchanged
        prev_entry = prev.get(path_str, {})
        prev_sha = prev_entry.get("sha", "")
        prev_date = prev_entry.get("date", "")
        prev_title = prev_entry.get("title", "")

        # If SHA matches previous and we have a valid date -> skip content fetch, reuse
        if blob_sha and prev_sha == blob_sha and prev_date and prev_title:
            date = prev_date
            title = prev_title
            reused_dates += 1
            articles.append({
                "path":     path_str,
                "title":    title,
                "url":      html_url,
                "html_url": html_url,
                "date":     date,
                "topic":    topic,
                "module":   module,
                "slug":     slug,
                "sha":      blob_sha,
            })
            by_module[module] = by_module.get(module, 0) + 1
            print(" -> [cached] {}".format(title[:48]))
            continue

        # Fetch file content for title extraction
        try:
            file_data = github_api(
                "repos/{}/contents/{}".format(REPO, path_str),
                token
            )
        except urllib.error.HTTPError as e:
            print("  WARN: {} -- skip".format(e.code))
            continue
        except Exception as e:
            print("  WARN: {} -- skip".format(e))
            continue

        content_b64 = file_data.get("content", "")

        # Extract title from content
        title = extract_title(content_b64, filename)

        # Date: filename date > previous date (for changed files) > today
        date = extract_date_from_filename(filename) or prev_date or today
        new_dates += 1

        articles.append({
            "path":     path_str,
            "title":    title,
            "url":      html_url,
            "html_url": html_url,
            "date":     date,
            "topic":    topic,
            "module":   module,
            "slug":     slug,
            "sha":      blob_sha,
        })
        by_module[module] = by_module.get(module, 0) + 1
        print(" -> {}".format(title[:48]))

    # Step 3: write output
    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "repo":       REPO,
        "stats": {
            "total":     len(articles),
            "by_module": by_module,
        },
        "articles":   articles,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print("\nWritten: {}".format(OUTPUT_FILE))

    # Also write to server memory dir if accessible
    try:
        if SERVER_FILE.parent.exists():
            SERVER_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
            print("Written: {}".format(SERVER_FILE))
    except Exception as e:
        print("WARN: could not write server copy: {}".format(e))

    print("\nDone: {} articles".format(len(articles)))
    print("  Reused dates: {}, New/changed: {}".format(reused_dates, new_dates))
    print("  By module: {}".format(json.dumps(by_module, ensure_ascii=False)))


if __name__ == "__main__":
    main()
