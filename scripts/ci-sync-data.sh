#!/usr/bin/env bash
# Export already-produced data without updating or running the live pipeline.
set -euo pipefail

: "${SSH_KEY:?DEPLOY_SSH_KEY is required}"
: "${SSH_HOST:?DEPLOY_SSH_HOST is required}"
: "${SSH_USER:?DEPLOY_SSH_USER is required}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pulsar-sync.XXXXXXXX")"
remote_dir="/tmp/pulsar-export.${local_dir##*/}"
[[ "$remote_dir" =~ ^/tmp/pulsar-export\.[A-Za-z0-9._-]+$ ]]
remote_attempted=0
port=22222

cleanup() {
  local status=$?
  trap - EXIT
  if (( remote_attempted )); then
    ssh "${ssh_opts[@]}" "$destination" "sudo -n rm -rf -- '$remote_dir'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$local_dir"
  exit "$status"
}
trap cleanup EXIT

printf '%s\n' "$SSH_KEY" > "$local_dir/key"
chmod 600 "$local_dir/key"
common_opts=(-i "$local_dir/key" -o "UserKnownHostsFile=$local_dir/known_hosts"
  -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=30
  -o ServerAliveInterval=15 -o ServerAliveCountMax=10)
ssh_opts=("${common_opts[@]}" -p "$port")
scp_opts=("${common_opts[@]}" -P "$port")
destination="$SSH_USER@$SSH_HOST"

retry() {
  local label="$1" attempt
  shift
  for attempt in 1 2 3; do
    printf '%s attempt %s/3\n' "$label" "$attempt" >&2
    if "$@"; then
      return 0
    fi
    if (( attempt < 3 )); then
      sleep 15
    fi
  done
  printf 'ERROR: %s failed after 3 attempts\n' "$label" >&2
  return 1
}

retry 'Host key scan' ssh-keyscan -T 10 -p "$port" -H "$SSH_HOST" > "$local_dir/known_hosts"
test -s "$local_dir/known_hosts"
remote_attempted=1
retry 'Create isolated export directory' ssh "${ssh_opts[@]}" "$destination" \
  "set -eu; umask 077; mkdir -p '$remote_dir'"
retry 'Upload checkout sync script' scp "${scp_opts[@]}" \
  "$repo_root/scripts/sync-data.py" "$destination:$remote_dir/sync-data.py"

# Required commands fail the SSH attempt. The archive belongs only to this run;
# no producer, git operation, notification, or live checkout write happens here.
retry 'Export pipeline data' ssh "${ssh_opts[@]}" "$destination" \
  "set -eu; sudo -n timeout 180 python3.11 '$remote_dir/sync-data.py' --data-dir '$remote_dir/export/src/data' --verbose; sudo -n tar -C '$remote_dir/export' -czf '$remote_dir/data.tar.gz' src/data; sudo -n chmod 644 '$remote_dir/data.tar.gz'"
retry 'Download current export' scp "${scp_opts[@]}" \
  "$destination:$remote_dir/data.tar.gz" "$local_dir/data.tar.gz"

# Finish transfer and archive validation before changing the runner's data.
tar -tzf "$local_dir/data.tar.gz" > /dev/null
tar -xzf "$local_dir/data.tar.gz" -C "$repo_root"
printf 'Data sync complete from isolated export.\n'
