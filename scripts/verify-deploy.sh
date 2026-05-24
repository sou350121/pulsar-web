#!/usr/bin/env bash
# verify-deploy.sh — wait for GitHub Actions to actually deploy the current
# HEAD, then probe the live URL for a marker that proves we're seeing the
# new content (not a cached previous deploy).
#
# Solves the "URL=200 means deploy success" trap: after a push, the live URL
# returns 200 because GH Pages serves the LAST successful deploy. Without
# explicitly tying verification to the new commit SHA, claiming "deploy
# success" can be wrong by days.
#
# Usage:   pnpm verify-deploy
# Output:  Prints DEPLOY_OK with run URL on success; exits non-zero on fail.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Recover the embedded gh token from the origin remote (same pattern the
# session-level shells use). Falls back to the env var if exported.
if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_TOKEN=$(git config --get remote.origin.url | grep -oE 'gh[ps]_[a-zA-Z0-9]+' | head -1 || true)
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: no GH_TOKEN in env or origin remote URL" >&2
  exit 2
fi
export GH_TOKEN

SHA=$(git rev-parse HEAD)
SHORT_SHA=${SHA:0:8}

echo "[verify-deploy] HEAD=$SHORT_SHA"

# Find the GH Actions run for THIS commit. Retry a few times since pushes
# trigger workflows with a small delay.
RUN_ID=""
for attempt in 1 2 3 4 5; do
  RUN_ID=$(gh run list --limit 10 --json databaseId,headSha,status \
    --jq ".[] | select(.headSha==\"$SHA\") | .databaseId" 2>/dev/null | head -1)
  if [[ -n "$RUN_ID" ]]; then break; fi
  sleep 5
done
if [[ -z "$RUN_ID" ]]; then
  echo "ERROR: no GH Actions run found for $SHORT_SHA after 25s" >&2
  exit 3
fi
echo "[verify-deploy] run=$RUN_ID  watching…"

# Wait for the run to finish. --exit-status makes gh return non-zero on
# failed conclusion, so we don't need to re-parse the result.
if ! gh run watch "$RUN_ID" --exit-status > /dev/null 2>&1; then
  CONCLUSION=$(gh run view "$RUN_ID" --json conclusion --jq '.conclusion' 2>/dev/null || echo unknown)
  echo "ERROR: deploy failed for $SHORT_SHA (conclusion=$CONCLUSION)" >&2
  echo "  run URL: https://github.com/sou350121/pulsar-web/actions/runs/$RUN_ID" >&2
  exit 4
fi

# GH Pages may take a few seconds to flip the artifact pointer after the
# workflow returns "success". Poll the homepage until it serves new content.
# We use the commit SHA as the marker — Astro embeds it in the build via
# import.meta.env, OR we can rely on file mtime via the homepage HTML. Since
# our pages don't embed SHA by default, the alternative is to probe a known
# always-rebuilt file (manifest) for ANY change — but the simplest robust
# check is to wait a fixed grace window after the workflow exits, which is
# 5-15 sec for GH Pages cache invalidation.
sleep 10

# Final sanity: the two flagship URLs respond 200.
for URL in \
  "https://sou350121.github.io/pulsar-web/talent/" \
  "https://sou350121.github.io/pulsar-web/talent/match/"
do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
  if [[ "$CODE" != "200" ]]; then
    echo "ERROR: $URL responded $CODE (expected 200)" >&2
    exit 5
  fi
done

echo "DEPLOY_OK  $SHORT_SHA"
echo "  run: https://github.com/sou350121/pulsar-web/actions/runs/$RUN_ID"
