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
  rm -f -- "$task_ssh_dir/key" "$task_ssh_dir/known_hosts"
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
  [[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || exit 2
  [[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 2
  [[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || exit 2
  remote="/EVEMTK/deploy/incoming/${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.tar.gz"
  # Ubuntu scp uses SFTP by default; no shell expansion is needed on the server.
  scp "${ssh_options[@]}" release.tar.gz "$target:$remote"
  ssh "${ssh_options[@]}" "$target" "/usr/local/lib/evem-deploy/runtime/bin/python /usr/local/lib/evem-deploy/release.py publish $remote"
fi
