#!/usr/bin/env python3.11
"""
scripts/fetch-vla-github.py
---------------------------
Fetches ALL theory articles from the sou350121/VLA-Handbook GitHub repo
and writes them to /home/admin/clawd/memory/vla-github-theory.json.

Dates come from explicit article metadata, filenames or an existing record.
An unknown date stays empty; discovering an old article does not make it new.

Uses only stdlib urllib.request — no external dependencies.
"""

import json
import os
import re
import time
import base64
import hashlib
import tempfile
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
MAX_FILES   = 5000  # safety bound: fail rather than silently truncate the library
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


def github_api(path: str, token: str, max_attempts: int = 3) -> dict | list:
    """Make a GitHub API request with retry+backoff for 429/5xx errors."""
    url = f"https://api.github.com/{path}"
    for attempt in range(max_attempts):
        req = urllib.request.Request(url, headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "pulsar-sync/1.0"
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and attempt < max_attempts - 1:
                # Check Retry-After header for 429
                retry_after = e.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait = min(int(retry_after), 60)
                else:
                    wait = 5 * (attempt + 1)
                print(f" [retry {attempt+1}: HTTP {e.code}, wait {wait}s]", end="", flush=True)
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError as e:
            if attempt < max_attempts - 1:
                wait = 5 * (attempt + 1)
                print(f" [retry {attempt+1}: {e.reason}, wait {wait}s]", end="", flush=True)
                time.sleep(wait)
                continue
            raise


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
                title = re.sub(r"^#+\s*", "", stripped).strip()
                if title:
                    return title
    except Exception:
        pass
    stem = Path(filename).stem
    return stem.replace("_", " ").replace("-", " ").title()


def extract_date_from_filename(filename: str) -> str | None:
    """Try to extract YYYY-MM-DD from a filename."""
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    return valid_date(m.group(1)) if m else None


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        return None
    return value


def extract_document_date(content_b64):
    text = base64.b64decode(content_b64).decode('utf-8')
    dates = set()
    for line in text.splitlines()[:30]:
        banner = ('Moltbot' in line and ('自动生成' in line or '自動生成' in line))
        field = re.match(r'^\s*>?\s*(?:\*\*)?(?:date|日期|发布日期|發布日期)(?:\*\*)?\s*[:：]', line, re.I)
        if banner or field:
            match = re.search(r'\b\d{4}-\d{2}-\d{2}\b', line)
            value = valid_date(match[0]) if match else None
            if value:
                dates.add(value)
    return dates.pop() if len(dates) == 1 else None


def select_theory_files(tree_data):
    if not isinstance(tree_data, dict) or tree_data.get('truncated') is True or not isinstance(tree_data.get('tree'), list):
        raise ValueError('incomplete_github_tree')
    files = [x for x in tree_data['tree'] if x.get('type') == 'blob' and should_include(x.get('path', ''))]
    if not 1 <= len(files) <= MAX_FILES or len({x['path'] for x in files}) != len(files):
        raise ValueError('invalid_theory_inventory')
    if any(not re.fullmatch(r'[0-9a-f]{40}', x.get('sha', '')) or '..' in x['path'].split('/') for x in files):
        raise ValueError('invalid_theory_blob')
    return sorted(files, key=lambda x: x['path'])


def save_output(output):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.vla-github-theory-', suffix='.tmp', dir=OUTPUT_FILE.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(output, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, OUTPUT_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def derive_topic(path_str: str) -> str:
    """
    Derive a topic label from the theory/ path.
    e.g. 'theory/act.md'          → 'act'
         'theory/diffusion/dp.md' → 'diffusion'
    """
    parts = path_str.split("/")
    if len(parts) >= 3:
        return parts[1]
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


def load_previous_output() -> dict[str, dict]:
    """
    Load previous output file to build path -> {date, sha, title} map.
    Used for date preservation on unchanged files.
    """
    prev: dict[str, dict] = {}
    try:
        if OUTPUT_FILE.exists():
            data = json.loads(OUTPUT_FILE.read_text())
            for a in data.get("articles", []):
                path = a.get("path", "")
                if path:
                    prev[path] = {
                        "date":  a.get("date", ""),
                        "sha":   a.get("sha", ""),
                        "title": a.get("title", ""),
                    }
    except Exception as e:
        print(f"WARN: could not load previous output: {e}")
    return prev


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
    print("  GitHub credential configured")

    # Load previous output for date preservation
    prev = load_previous_output()
    if prev:
        print(f"  Previous output: {len(prev)} articles (for date preservation)")
    else:
        print("  No previous output — dates require article evidence")

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

    theory_files = select_theory_files(tree_data)
    print(f"  Processing all {len(theory_files)} eligible theory files")

    # Step 2: fetch each file's metadata
    articles = []
    reused_dates = 0
    new_dates = 0

    for i, item in enumerate(theory_files, 1):
        path_str = item["path"]
        blob_sha = item.get("sha", "")
        filename = path_str.split("/")[-1]
        print(f"  [{i:3d}/{len(theory_files)}] {path_str}", end="", flush=True)

        # Date logic: preserve from previous run if SHA unchanged
        prev_entry = prev.get(path_str, {})
        prev_sha = prev_entry.get("sha", "")
        prev_date = prev_entry.get("date", "")
        prev_title = prev_entry.get("title", "")

        # If SHA matches previous and we have a valid date → skip content fetch, reuse
        if blob_sha and prev_sha == blob_sha and prev_title and (prev_date in (None, '') or valid_date(prev_date)):
            date = valid_date(prev_date) or ''
            title = prev_title
            reused_dates += 1
            topic = derive_topic(path_str)
            html_url = f"https://github.com/{REPO}/blob/main/{path_str}"
            articles.append({
                "path":     path_str,
                "title":    title,
                "url":      html_url,
                "html_url": html_url,
                "date":     date,
                "topic":    topic,
                "sha":      blob_sha,
            })
            print(f" → [cached] {title[:48]}")
            continue

        # Fetch file content for title extraction
        time.sleep(RATE_SLEEP)
        try:
            file_data = github_api(
                f"repos/{REPO}/git/blobs/{blob_sha}",
                token
            )
        except urllib.error.HTTPError as e:
            raise RuntimeError('theory_blob_fetch_failed_http_' + str(e.code)) from None

        html_url = f"https://github.com/{REPO}/blob/main/{path_str}"
        content_b64 = file_data.get("content", "")
        raw = base64.b64decode(content_b64)
        actual_sha = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        if file_data.get('sha') != blob_sha or actual_sha != blob_sha:
            raise ValueError('theory_blob_integrity_failed')

        # Extract title from content
        title = extract_title(content_b64, filename)

        date = extract_document_date(content_b64) or extract_date_from_filename(filename) or valid_date(prev_date) or ''
        new_dates += 1

        # Derive topic
        topic = derive_topic(path_str)

        articles.append({
            "path":     path_str,
            "title":    title,
            "url":      html_url,
            "html_url": html_url,
            "date":     date,
            "topic":    topic,
            "sha":      blob_sha,
        })
        print(f" → {title[:48]}")

    # Step 3: write output
    output = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "complete": True,
        "github_tree_response_sha": tree_data.get('sha'),
        "article_count": len(articles),
        "articles":   articles,
    }
    assert len(articles) == len(theory_files)
    save_output(output)

    print(f"\nDone: {len(articles)} articles written to {OUTPUT_FILE}")
    print(f"  Reused dates: {reused_dates}, New/changed: {new_dates}")


if __name__ == "__main__":
    main()

