#!/usr/bin/env python3.11
"""
scripts/sync-data.py
--------------------
Copies (or symlinks) relevant pipeline data files from
/home/admin/clawd/memory/ into src/data/ so Astro can read them at build time.

Usage:
    python3.11 scripts/sync-data.py [--symlink] [--dry-run] [--verbose]

Options:
    --symlink   Create symlinks instead of copying (faster; requires permissions).
    --dry-run   Print what would be done without touching any files.
    --verbose   Print every file operation.

The script handles:
  - JSON files: copied/linked directly.
  - Markdown files with date patterns: the N most recent are selected.
  - Permission errors: runs via sudo if plain copy fails.

Cron / CI usage:
    sudo python3.11 /home/claudeuser/pulsar-web/scripts/sync-data.py
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MEMORY_DIR     = Path("/home/admin/clawd/memory")
MEMORY_TMP_DIR = Path("/home/admin/clawd/memory/tmp")
DATA_DIR       = Path(__file__).resolve().parent.parent / "src" / "data"

# JSON files to copy verbatim
JSON_FILES = [
    "ai-daily-pick.json",
    "drift-metrics.json",
    "drift-state.json",
    "entity-index.json",
    "upstream-signals.json",
    "vla-social-intel.json",
    # Cross-domain insight (optional, may not exist)
    "cross-domain-insight.json",
    # Deep dive content
    "ai-app-deep-dive-articles.json",
    "vla-sota-tracker.json",
    "vla-theory-articles.json",
    # VLA GitHub full library (all theory/ files from VLA-Handbook)
    "vla-github-theory.json",
]

# Markdown file patterns — (prefix, how_many_recent_to_copy)
MARKDOWN_PATTERNS = [
    ("_ai_social_",            30),   # daily AI social intel
    ("_vla_social_",           30),   # daily VLA social intel
    ("_biweekly_",             12),   # biweekly reports (covers _biweekly_reflection_ too)
    ("_ai_biweekly_",          12),   # AI app biweekly reports
    ("_ai_daily_pick_",        30),   # dated ai daily pick markdown (if exists)
    ("calibration-check-",     14),   # calibration check JSONs
]

# How many days back to look for markdown files (avoid loading ancient files)
MD_MAX_AGE_DAYS = 90


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str, verbose: bool = False, is_verbose: bool = False):
    if is_verbose and not verbose:
        return
    print(msg, flush=True)


def copy_file(src: Path, dst: Path, dry_run: bool, symlink: bool, verbose: bool):
    """Copy or symlink src → dst. Falls back to sudo cp on permission error."""
    if dry_run:
        action = "SYMLINK" if symlink else "COPY"
        log(f"  [dry-run] {action}: {src.name} → {dst}", verbose)
        return True

    dst.parent.mkdir(parents=True, exist_ok=True)

    if dst.exists() or dst.is_symlink():
        dst.unlink()

    if symlink:
        try:
            dst.symlink_to(src)
            log(f"  LINK: {src.name}", is_verbose=True, verbose=verbose)
            return True
        except OSError as e:
            log(f"  WARN: symlink failed ({e}), falling back to copy")

    # Try plain copy first
    try:
        shutil.copy2(src, dst)
        log(f"  COPY: {src.name}", is_verbose=True, verbose=verbose)
        return True
    except PermissionError:
        # Try sudo cp
        result = subprocess.run(
            ["sudo", "cp", "-p", str(src), str(dst)],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            # Fix ownership so Astro build (non-root) can read it
            subprocess.run(["sudo", "chown", f"{os.getuid()}:{os.getgid()}", str(dst)],
                           capture_output=True)
            log(f"  SUDO COPY: {src.name}", is_verbose=True, verbose=verbose)
            return True
        else:
            log(f"  ERROR: could not copy {src.name}: {result.stderr.strip()}")
            return False


def select_recent_md(memory_dir: Path, prefix: str, n: int, max_age_days: int) -> list[Path]:
    """
    Find the N most recent files matching {memory_dir}/{prefix}*.md (or .json).
    Filters by date in filename (YYYY-MM-DD) if present.
    """
    cutoff = (datetime.now() - timedelta(days=max_age_days)).date()
    pattern = str(memory_dir / f"{prefix}*")
    candidates = sorted(glob.glob(pattern), reverse=True)  # newest first (lexicographic)

    selected = []
    for path_str in candidates:
        p = Path(path_str)
        if not p.is_file():
            continue
        # Extract date from filename
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", p.name)
        if date_match:
            try:
                file_date = datetime.strptime(date_match.group(1), "%Y-%m-%d").date()
                if file_date < cutoff:
                    continue  # too old
            except ValueError:
                pass
        selected.append(p)
        if len(selected) >= n:
            break

    return selected


def write_manifest(data_dir: Path, copied: list[str], dry_run: bool):
    """Write a manifest JSON so the build can verify what was synced."""
    manifest = {
        "synced_at": datetime.now().isoformat(),
        "files": sorted(copied),
    }
    manifest_path = data_dir / "_manifest.json"
    if not dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    log(f"Manifest written: {len(copied)} files")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Sync pipeline data to src/data/")
    parser.add_argument("--symlink",  action="store_true", help="Use symlinks instead of copy")
    parser.add_argument("--dry-run",  action="store_true", help="Print actions without executing")
    parser.add_argument("--verbose",  action="store_true", help="Verbose output")
    args = parser.parse_args()

    if not MEMORY_DIR.exists():
        log(f"ERROR: MEMORY_DIR does not exist: {MEMORY_DIR}")
        log("Run with sudo, or check the path.")
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log(f"Syncing {MEMORY_DIR} → {DATA_DIR}")
    if args.dry_run:
        log("[DRY RUN MODE — no files will be written]")

    copied: list[str] = []
    errors: list[str] = []

    # ── 1. JSON files ──────────────────────────────────────────────────────
    log("\nJSON files:")
    for filename in JSON_FILES:
        src = MEMORY_DIR / filename
        dst = DATA_DIR   / filename
        if not src.exists():
            log(f"  SKIP (not found): {filename}", is_verbose=True, verbose=args.verbose)
            continue
        ok = copy_file(src, dst, args.dry_run, args.symlink, args.verbose)
        if ok:
            copied.append(filename)
        else:
            errors.append(filename)

    # ── 2. Markdown / dated files ──────────────────────────────────────────
    log("\nMarkdown / dated files:")
    for prefix, n in MARKDOWN_PATTERNS:
        files = select_recent_md(MEMORY_DIR, prefix, n, MD_MAX_AGE_DAYS)
        if not files:
            log(f"  SKIP (none found): {prefix}*", is_verbose=True, verbose=args.verbose)
            continue
        log(f"  {prefix}* — {len(files)} file(s)")
        for src in files:
            dst = DATA_DIR / src.name
            ok = copy_file(src, dst, args.dry_run, args.symlink, args.verbose)
            if ok:
                copied.append(src.name)
            else:
                errors.append(src.name)

    # ── 3. VLA daily rating files from tmp/ ───────────────────────────────
    log("\nVLA daily rating files (from memory/tmp/):")
    if MEMORY_TMP_DIR.exists():
        vla_rating_files = select_recent_md(MEMORY_TMP_DIR, "vla-daily-rating-out-", 30, MD_MAX_AGE_DAYS)
        if not vla_rating_files:
            log("  SKIP (none found): vla-daily-rating-out-*", is_verbose=True, verbose=args.verbose)
        else:
            log(f"  vla-daily-rating-out-* — {len(vla_rating_files)} file(s)")
            for src in vla_rating_files:
                dst = DATA_DIR / src.name
                ok = copy_file(src, dst, args.dry_run, args.symlink, args.verbose)
                if ok:
                    copied.append(src.name)
                else:
                    errors.append(src.name)
    else:
        log(f"  SKIP (tmp dir not found): {MEMORY_TMP_DIR}", is_verbose=True, verbose=args.verbose)

    # ── 4. Manifest ────────────────────────────────────────────────────────
    write_manifest(DATA_DIR, copied, args.dry_run)

    # ── 4. Summary ─────────────────────────────────────────────────────────
    log(f"\nDone: {len(copied)} copied, {len(errors)} errors")
    if errors:
        log(f"Errors: {', '.join(errors)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
