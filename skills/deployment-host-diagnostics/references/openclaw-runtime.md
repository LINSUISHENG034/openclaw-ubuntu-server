# OpenClaw Runtime Checks

Use these commands when the user is asking about the deployment runtime, gateway health, channels, service state, or whether OpenClaw itself is up.

## Primary checks

```bash
openclaw gateway status
openclaw channels status --probe
openclaw security audit --deep
openclaw doctor
openclaw logs --follow
```

## Service details

```bash
systemctl --user status openclaw-gateway.service --no-pager
systemctl --user show -p MainPID,ActiveState,SubState openclaw-gateway.service
cat ~/.config/systemd/user/openclaw-gateway.service
```

## Local gateway reachability

```bash
ss -ltnp | rg 18789
curl -sS http://127.0.0.1:18789/ | head
```

## Session and state files

```bash
ls -lt ~/.openclaw/agents/main/sessions | head
tail -n 80 ~/.openclaw/agents/main/sessions/sessions.json
```

## Guidance

- Start with `openclaw gateway status` when the question is about overall health.
- Use `openclaw channels status --probe` when the question is about connected channels.
- If the user asks which model is active, verify from runtime or session evidence instead of assuming config equals reality.
- When there is a mismatch, explicitly separate:
  - configured model
  - active model
  - fallback behavior seen in logs
