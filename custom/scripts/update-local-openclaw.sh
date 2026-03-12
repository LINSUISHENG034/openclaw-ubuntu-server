#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/mnt/sda1/github/openclaw"
EXPECTED_UPSTREAM_URL="https://github.com/openclaw/openclaw"
SERVICE_NAME="openclaw-gateway.service"
GATEWAY_PORT="18789"

cd "$REPO_ROOT"

echo "== OpenClaw local update =="
echo "Repo: $REPO_ROOT"
echo

upstream_url=""
if git remote get-url upstream >/dev/null 2>&1; then
  upstream_url="$(git remote get-url upstream)"
fi

echo "Upstream status:"
if [[ -z "$upstream_url" ]]; then
  echo "  upstream remote is not configured."
  echo "  Suggested command:"
  echo "    git remote add upstream $EXPECTED_UPSTREAM_URL"
elif [[ "$upstream_url" != "$EXPECTED_UPSTREAM_URL" ]]; then
  echo "  upstream remote differs from expected."
  echo "  Current:  $upstream_url"
  echo "  Expected: $EXPECTED_UPSTREAM_URL"
  echo "  Suggested command:"
  echo "    git remote set-url upstream $EXPECTED_UPSTREAM_URL"
else
  echo "  upstream remote is configured correctly: $upstream_url"
fi
echo "  Note: this script does not fetch, pull, merge, or rebase upstream changes."
echo

echo "== Install dependencies =="
pnpm install
echo

echo "== Build =="
pnpm build
echo

echo "== Restart service =="
systemctl --user daemon-reload
systemctl --user restart "$SERVICE_NAME"
echo

echo "== Service status =="
systemctl --user status "$SERVICE_NAME" --no-pager | sed -n '1,40p'
echo

echo "== Listening ports =="
ss -ltnp | rg "$GATEWAY_PORT" || true
echo

echo "== Recent logs =="
journalctl --user -u "$SERVICE_NAME" -n 50 --no-pager
