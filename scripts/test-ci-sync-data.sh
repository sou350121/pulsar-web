#!/usr/bin/env bash
# Isolated transport mocks: no SSH, sudo, API, or live checkout operations.
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/pulsar-ci-test.XXXXXXXX")"
trap 'rm -rf -- "$test_dir"' EXIT
mkdir -p "$test_dir/repo/scripts" "$test_dir/repo/src/data" "$test_dir/runner"
cp "$script_dir/ci-sync-data.sh" "$test_dir/repo/scripts/"
printf '# fixture sync script\n' > "$test_dir/repo/scripts/sync-data.py"

event() { printf '%s\n' "$*" >> "$MOCK_STATE/events"; }
count() {
  local value=0
  [[ ! -f "$MOCK_STATE/$1" ]] || read -r value < "$MOCK_STATE/$1"
  value=$((value + 1))
  printf '%s\n' "$value" > "$MOCK_STATE/$1"
  printf '%s\n' "$value"
}
ssh-keyscan() {
  event "keyscan $*"
  [[ "$MOCK_MODE" != scan_failure ]] || return 1
  printf '[mock-host]:22222 ssh-ed25519 test-only\n'
}
ssh() {
  local command="${*: -1}" attempt
  event "ssh $*"
  [[ "$command" != *'rm -rf'* ]] || return 0
  [[ "$MOCK_MODE" != connection_failure ]] || return 1
  if [[ "$command" == *'timeout 180 python3.11'* ]]; then
    attempt="$(count exports)"
    [[ "$MOCK_MODE" != export_failure ]] || return 42
    if [[ "$MOCK_MODE" == transient_export && "$attempt" == 1 ]]; then
      return 42
    fi
  fi
  return 0
}
scp() {
  local source="${*: -2:1}" destination="${*: -1}"
  event "scp $*"
  if [[ "$source" == mock-user@mock-host:* ]]; then
    count downloads > /dev/null
    [[ "$MOCK_MODE" != download_failure ]] || return 1
    mkdir -p "$MOCK_STATE/archive/src/data"
    printf '{"fixture":true}\n' > "$MOCK_STATE/archive/src/data/export-fixture.json"
    tar -czf "$destination" -C "$MOCK_STATE/archive" src/data
  fi
}
sleep() { event "sleep $*"; }
export -f event count ssh-keyscan ssh scp sleep
export SSH_KEY=test-only SSH_HOST=mock-host SSH_USER=mock-user
export RUNNER_TEMP="$test_dir/runner"

run_case() {
  local mode="$1" expected="$2" status=0
  export MOCK_MODE="$mode" MOCK_STATE="$test_dir/$mode"
  mkdir -p "$MOCK_STATE"
  rm -f "$test_dir/repo/src/data/export-fixture.json"
  bash "$test_dir/repo/scripts/ci-sync-data.sh" > "$MOCK_STATE/output" 2>&1 || status=$?
  if [[ "$expected" == pass ]]; then
    [[ "$status" == 0 && -s "$test_dir/repo/src/data/export-fixture.json" ]]
  else
    [[ "$status" != 0 && ! -e "$test_dir/repo/src/data/export-fixture.json" ]]
  fi
  ! grep -q '/tmp/pulsar-data.tar.gz' "$MOCK_STATE/events"
  grep -q 'keyscan -T 10 -p 22222 -H mock-host' "$MOCK_STATE/events"
  if [[ "$mode" != scan_failure ]]; then
    grep -q 'StrictHostKeyChecking=yes' "$MOCK_STATE/events"
    grep -q "sudo -n rm -rf -- '/tmp/pulsar-export\." "$MOCK_STATE/events"
  fi
  [[ -z "$(find "$RUNNER_TEMP" -mindepth 1 -print -quit)" ]]
  printf 'PASS %s\n' "$mode"
}

run_case success pass
grep -q 'scp .* -P 22222 ' "$MOCK_STATE/events"
grep -q 'ssh .* -p 22222 ' "$MOCK_STATE/events"
grep -q -- "--data-dir '/tmp/pulsar-export\..*/export/src/data" "$MOCK_STATE/events"
! grep -Eq 'git pull|fetch-ai-github|build-graph-data|build-atlas-data|diagnose-funnel|push-data-to-web|fix-theory' "$MOCK_STATE/events"
run_case transient_export pass
[[ "$(cat "$MOCK_STATE/exports")" == 2 ]]
run_case export_failure fail
[[ "$(cat "$MOCK_STATE/exports")" == 3 && ! -e "$MOCK_STATE/downloads" ]]
run_case connection_failure fail
! grep -q '^scp ' "$MOCK_STATE/events"
run_case download_failure fail
[[ "$(cat "$MOCK_STATE/downloads")" == 3 ]]
run_case scan_failure fail
! grep -Eq '^(ssh|scp) ' "$MOCK_STATE/events"
printf '6 isolated CI sync tests passed.\n'
