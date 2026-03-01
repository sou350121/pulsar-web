#!/usr/bin/env python3.11
"""
scripts/fetch-vla-github.py
---------------------------
Fetches ALL theory articles from the sou350121/VLA-Handbook GitHub repo
and writes them to /home/admin/clawd/memory/vla-github-theory.json.

Uses only stdlib urllib.request — no external dependencies.

Usage:
    sudo python3.11 /home/claudeuser/pulsar-web/scripts/fetch-vla-github.py
"""

import json
import os
import re
import time
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ENV_FILE    = Path("/home/admin/.clawdbot/.env")
OUTPUT_FILE = Path("/home/admin/clawd/memory/vla-github-theory.json")
REPO        = "sou350121/VLA-Handbook"
MAX_FILES   = 80
RATE_SLEEP  = 0.1   # seconds between API calls


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load_env(env_path: Path) -> dict[str, str]:
    """Parse KEY=value pairs from env file."""
    env: dict[str, str] = {}
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    except Exception as e:
        print(f"WARN: could not read env file: {e}")
    return env


def github_api(path: str, token: str) -> dict | list:
    """Make a GitHub API request and return parsed JSON."""
    url = f"https://api.github.com/{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "pulsar-sync/1.0"
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def extract_title(content_b64: str, filename: str) -> str:
    """
    Extract article title from base64-encoded file content.
    Uses first '# Heading' line; falls back to filename.
    """
    try:
        raw = base64.b64decode(content_b64).decode("utf-8", errors="replace")
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                # Strip leading hashes and whitespace
                title = re.sub(r"^#+\s*", "", stripped).strip()
                if title:
                    return title
    except Exception:
        pass
    # Fallback: derive from filename
    stem = Path(filename).stem
    # Replace underscores/hyphens with spaces, title-case
    return stem.replace("_", " ").replace("-", " ").title()


def extract_date_from_filename(filename: str) -> str | None:
    """Try to extract YYYY-MM-DD from a filename."""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    return m.group(1) if m else None


def derive_topic(path_str: str) -> str:
    """
    Derive a topic label from the theory/ path.
    e.g. 'theory/act.md'          → 'act'
         'theory/diffusion/dp.md' → 'diffusion'
    """
    parts = path_str.split("/")
    # parts[0] == 'theory'
    if len(parts) >= 3:
        # subdirectory present
        return parts[1]
    # direct file: theory/filename.md
    if len(parts) == 2:
        return Path(parts[1]).stem
    return "general"


def should_include(path_str: str) -> bool:
    """Filter function for theory file paths."""
    if not path_str.startswith("theory/"):
        return False
    if not path_str.endswith(".md"):
        return False
    if "/README" in path_str:
        return False
    if "ascii_cheatsheet" in path_str:
        return False
    if "benchmark_tracker" in path_str:
        return False
    if "/code-notes/" in path_str:
        return False
    if "/classics/" in path_str:
        return False
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"fetch-vla-github.py — fetching theory articles from {REPO}")

    # Load token
    env = load_env(ENV_FILE)
    token = env.get("GITHUB_TOKEN", "")
    if not token:
        print("ERROR: GITHUB_TOKEN not found in env file")
        raise SystemExit(1)
    print(f"  Token: {token[:8]}...")

    # Step 1: fetch full tree
    print(f"\nStep 1: fetching repo tree (recursive)...")
    try:
        tree_data = github_api(
            f"repos/{REPO}/git/trees/main?recursive=1",
            token
        )
    except urllib.error.HTTPError as e:
        print(f"ERROR: tree fetch failed: {e.code} {e.reason}")
        raise SystemExit(1)

    blobs = tree_data.get("tree", [])
    theory_files = [
        item for item in blobs
        if item.get("type") == "blob" and should_include(item.get("path", ""))
    ]
    print(f"  Found {len(theory_files)} theory .md files (before cap)")

    # Cap to MAX_FILES (sorted alphabetically for determinism)
    theory_files = sorted(theory_files, key=lambda x: x["path"])[:MAX_FILES]
    print(f"  Processing {len(theory_files)} files (cap={MAX_FILES})")

    # Step 2: fetch each file's metadata
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    articles = []

    for i, item in enumerate(theory_files, 1):
        path_str = item["path"]
        filename = path_str.split("/")[-1]
        print(f"  [{i:2d}/{len(theory_files)}] {path_str}", end="", flush=True)

        # Rate limiting
        if i > 1:
            time.sleep(RATE_SLEEP)

        try:
            file_data = github_api(
                f"repos/{REPO}/contents/{path_str}",
                token
            )
        except urllib.error.HTTPError as e:
            print(f"  WARN: {e.code} — skip")
            continue
        except Exception as e:
            print(f"  WARN: {e} — skip")
            continue

        html_url = file_data.get("html_url", "")
        content_b64 = file_data.get("content", "")

        # Extract title from content
        title = extract_title(content_b64, filename)

        # Extract date
        date = extract_date_from_filename(filename) or today

        # Derive topic
        topic = derive_topic(path_str)

        articles.append({
            "path":     path_str,
            "title":    title,
            "url":      html_url,
            "html_url": html_url,
            "date":     date,
            "topic":    topic,
        })
        print(f" → {title[:48]}")

    # Step 3: write output
    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "articles":   articles,
    }
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    print(f"\nDone: {len(articles)} articles written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
