#!/usr/bin/env bash
# Server-side release.py is installed separately after review, never replaced by CI.
set -euo pipefail
umask 077
action="${1:?publish or rollback required}"
[[ "$action" == publish || "$action" == rollback ]] || exit 2
: "${EVEM_SSH_KEY:?production SSH key missing}"
: "${EVEM_KNOWN_HOSTS:?verified host record missing}"
task_ssh_dir=$(mktemp -d)
cleanup() {
  rm -f -- "$task_ssh_dir/key" "$task_ssh_dir/known_hosts" "$task_ssh_dir/plan.json" "$task_ssh_dir/upload.tar.gz"
  rmdir -- "$task_ssh_dir"
}
trap cleanup EXIT
printf '%s\n' "$EVEM_SSH_KEY" > "$task_ssh_dir/key"
printf '%s\n' "$EVEM_KNOWN_HOSTS" > "$task_ssh_dir/known_hosts"
unset EVEM_SSH_KEY EVEM_KNOWN_HOSTS
ssh_options=(-i "$task_ssh_dir/key" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$task_ssh_dir/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
target=evem-deploy@8.134.144.49
if [[ "$action" == rollback ]]; then
  ssh "${ssh_options[@]}" "$target" '/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py rollback'
else
  release_sha="${EVEM_RELEASE_SHA:-${GITHUB_SHA:-}}"
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
  [[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 2
  [[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || exit 2
  source_action=$(python scripts/deploy/transfer.py inspect-source --expected-sha "$release_sha")
  if [[ "$source_action" == noop ]]; then
    ssh "${ssh_options[@]}" "$target" '/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py noop' < release-plan.json > "$task_ssh_dir/plan.json"
    remote_action=$(python scripts/deploy/transfer.py inspect-remote --expected-sha "$release_sha" --plan "$task_ssh_dir/plan.json")
    [[ "$remote_action" == noop ]] || exit 2
    printf '%s\n' 'Verified unchanged production components; no product upload or switch.'
    exit 0
  fi
  # Authenticate and validate the active state BEFORE transferring product bytes.
  # The trusted publisher is installed by an operator, never uploaded by this job.
  ssh "${ssh_options[@]}" "$target" '/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py plan' < release-manifest.json > "$task_ssh_dir/plan.json"
  remote_action=$(python scripts/deploy/transfer.py prepare --expected-sha "$release_sha" --plan "$task_ssh_dir/plan.json" --output "$task_ssh_dir/upload.tar.gz")
  if [[ "$remote_action" == noop ]]; then
    printf '%s\n' 'Verified identical product bytes; no product upload or switch.'
    exit 0
  fi
  [[ "$remote_action" == upload ]] || exit 2
  remote="/EVEMTK/deploy/incoming/${release_sha}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.tar.gz"
  printf 'Planned component package bytes: %s\n' "$(wc -c < "$task_ssh_dir/upload.tar.gz")"
  # Ubuntu scp uses SFTP by default; no shell expansion is needed on the server.
  scp "${ssh_options[@]}" "$task_ssh_dir/upload.tar.gz" "$target:$remote"
  ssh "${ssh_options[@]}" "$target" "/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py publish $remote"
fi
