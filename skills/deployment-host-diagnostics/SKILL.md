---
name: deployment-host-diagnostics
description: Diagnose the machine running an OpenClaw deployment using live command-backed evidence from the host itself. Use when a user asks about the deployment host's current runtime state, OpenClaw service health, channel connectivity, ports, processes, systemd status, logs, Bluetooth/audio state, disk usage, network reachability, or asks you to run a host command and report the real result instead of giving general knowledge.
---

# Deployment Host Diagnostics

Diagnose the real state of the OpenClaw deployment host. Treat current host status as unknown until it is verified from the machine.

## Core Rules

- Prefer read-only command checks first for deployment-host questions.
- For simple one-command requests, run the exact command first, then answer from the result.
- Do not send a placeholder final reply like "I'll check" when the command can be run immediately.
- Default to non-mutating diagnostics. Do not restart services, reconnect devices, edit config, or change host state unless the user explicitly asks for that.
- If command execution is blocked by policy, permission, or missing binaries, say that directly. Do not guess.
- Separate `Observed:` facts from `Likely cause:` inference when diagnosing an issue.
- If the user asks for the raw result, include a fenced `txt` block with the relevant output.
- If the first command fully answers the question, stop there. Do not broaden the investigation unnecessarily.

## Default Workflow

### 1. Classify the request

Choose the narrowest path that can answer the question:

- Single-command fact lookup
  - Example: `bluetoothctl info 24:C4:06:FA:00:37`
  - Action: run that exact command and answer from the output
- OpenClaw runtime check
  - Example: gateway status, channels, service health, logs
  - Action: use OpenClaw-native checks first, then host evidence if needed
- Problem diagnosis
  - Example: Bluetooth connected but silent, gateway appears up but channel is dead
  - Action: gather evidence across the smallest relevant layers before concluding

### 2. Gather evidence from the host

Use the smallest command set needed for the current question:

- Base host inspection: `references/host-linux.md`
- OpenClaw runtime and service checks: `references/openclaw-runtime.md`
- Bluetooth and Linux audio checks: `references/bluetooth-audio.md`

When the user gives an explicit command to run, prefer that command over a broader diagnostic sweep.

### 3. Answer from evidence

Use this format by default:

- `Result:` one sentence with the direct answer
- `Observed:` 1-4 bullets or a short paragraph with the key verified facts
- `Next step:` only if the user asked for diagnosis or the evidence suggests a clear follow-up

For single-command fact lookups, keep it tighter:

- run the command
- extract the important fields
- include a short raw excerpt if useful

Example:

```text
Result: The device is paired and currently connected.

Observed:
- Name: Aura Studio 5
- Paired: yes
- Trusted: yes
- Connected: yes
```

### 4. Handle blocked or insufficient evidence

If you cannot complete the check:

- name the command you needed or attempted
- state the blocker: tool policy, permission, timeout, missing binary, missing device, or unreachable service
- ask for the smallest next approval or clarification needed
- do not present host state as known

## High-Value Patterns

### Direct command requests

For requests like:

- "你可以在本机上运行命令 `bluetoothctl info ...` 并将结果告知给我吗？"
- "check whether port 18789 is listening"
- "show me what `systemctl --user status openclaw-gateway.service` says"

Run the exact command first and answer from the result. Avoid extra narration.

### OpenClaw runtime questions

When the user is asking whether OpenClaw itself is healthy, start with the runtime checks in `references/openclaw-runtime.md`:

- `openclaw gateway status`
- `openclaw channels status --probe`
- `openclaw security audit --deep`
- service logs and port listeners when needed

Distinguish:

- configured state
- running state
- observed error state

### Bluetooth and audio questions

Do not assume the failure layer. Separate:

- BlueZ device state
- audio stack device or sink state
- actual playback or routing state

For a direct `bluetoothctl info` question, do not jump into generic Bluetooth troubleshooting unless the user asks for diagnosis.

## References

- Read `references/host-linux.md` for base host inspection commands.
- Read `references/openclaw-runtime.md` for OpenClaw runtime checks.
- Read `references/bluetooth-audio.md` for Bluetooth and Linux audio diagnostics.
