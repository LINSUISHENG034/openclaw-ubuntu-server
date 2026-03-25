#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/mnt/sda1/github/openclaw"
EXPECTED_UPSTREAM_URL="https://github.com/openclaw/openclaw"
SERVICE_NAME="openclaw-gateway.service"
GATEWAY_PORT="18789"
COMPAT_REGRESSION_TESTS=(
  "extensions/telegram/src/bot-message-dispatch.test.ts"
  "src/agents/pi-embedded-runner/run/attempt.test.ts"
  "src/agents/pi-embedded-subscribe.compat-tooluse-boundary.test.ts"
)

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

# These targeted tests protect the generic compat text-tool-call behavior from upstream drift.
#
# Why this lives in the local update script:
# - compat text-tool-call handling can leak process text on two outward paths:
#   1. embedded block-reply flushing before message_end classification
#   2. Telegram partial-preview lanes showing compat commentary before the final answer refreshes
# - both bugs are easy to reintroduce during upstream refactors because the final
#   persisted session can still look clean while the user briefly sees leaked text
# - the running gateway serves dist/, so we want to fail before rebuild/restart if
#   upstream changes break the compat guardrails we rely on locally
#
# What each test file covers:
# - attempt.test.ts:
#   compat textToolCalls must still force blockReplyBreak to message_end
# - compat-tooluse-boundary.test.ts:
#   tool_execution_start must not flush compat commentary before toolUse message_end
# - bot-message-dispatch.test.ts:
#   Telegram must not create answer partial previews for compat text-tool-call sessions
echo "== Compat regression checks =="
pnpm test -- "${COMPAT_REGRESSION_TESTS[@]}"
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
