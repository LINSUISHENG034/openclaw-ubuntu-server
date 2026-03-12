# Lab Agent External Leak of Raw Tool-Call Content

Date: 2026-03-11

## Summary

The `lab` Telegram agent still leaked raw tool-call-like content to the external user surface during a real tool-use session.

The leaked content included JSON-shaped pseudo tool calls such as:

```json
{"tool":"read","args":{"path":"/mnt/sda1/github/openclaw/skills/deployment-host-diagnostics/SKILL.md"}}
{"tool":"read","args":{"path":"/home/lin/.openclaw/workspace-lab/SOUL.md"}}
{"tool":"exec","args":{"cmd":"set -o pipefail\nprintf 'show\ninfo 24:C4:06:FA:00:37\npaired-devices\n' | bluetoothctl","yieldMs":120000}}
```

This note records the confirmed evidence and the current root-cause conclusion so the next repair can start from code-level facts instead of redoing the investigation.

## Real Session Confirmed

The relevant live session is the `lab` Telegram main session:

- session key: `agent:lab:telegram:direct:2102558549`
- transcript: `~/.openclaw/agents/lab/sessions/879bdddf-41cd-42f6-91b7-eddb7801df6a.jsonl`

The latest user request in that transcript is:

- timestamp: `2026-03-11T10:42:38.099Z`
- message id: `78f472c3`
- text: `请叫我林先森，请连接本机蓝牙设备24:C4:06:FA:00:37并播放测试音.`

## What The Transcript Proves

### 1. The final stored assistant reply was normal

The final assistant message in the latest turn is:

- timestamp: `2026-03-11T10:44:33.798Z`
- message id: `6d1b8b4b`

Its final user-facing text is a normal Chinese summary:

- Bluetooth device was not connected
- default sink was still `auto_null`
- no real test sound was played
- the agent remembered to call the user `林先森`

So the session transcript does **not** end with the raw leaked JSON blobs as the final persisted assistant text.

### 2. The latest persisted assistant/tool blocks are already structured

The intermediate assistant/tool-use message for the same turn is:

- timestamp: `2026-03-11T10:43:51.699Z`
- message id: `61469abb`

Its content includes structured internal `toolCall` blocks such as:

- `read` with canonical `path`
- `exec` with canonical `command`

This means the persisted assistant message shape by that point is already in internal structured form, not the raw `{"tool":"...","args":...}` text that the user reported seeing.

### 3. Telegram preview streaming is not the source

Current local config in `~/.openclaw/openclaw.json` shows:

```json
"channels": {
  "telegram": {
    "streaming": "off"
  }
}
```

So the leak is **not** explained by Telegram draft/partial preview streaming.

## Confirmed Root Cause

The leak is caused by **non-final assistant content from the tool-use loop being considered deliverable outbound reply text before the final answer boundary**, not by final transcript persistence and not by Telegram partial preview.

## Code-Level Evidence

### A. `message_end` assistant text is accumulated into `assistantTexts`

In `src/agents/pi-embedded-subscribe.handlers.messages.ts`:

- line 272 reads the assistant text with `extractAssistantText(assistantMessage)`
- lines 330-332 pass it into `finalizeAssistantTexts(...)`

This means every assistant `message_end` can contribute text into `assistantTexts`, including tool-use-turn assistant messages.

### B. `assistantTexts` is later treated as final answer text

In `src/agents/pi-embedded-runner/run/attempt.ts`:

- line 2329 returns `assistantTexts` from the embedded run attempt

In `src/agents/pi-embedded-runner/run/payloads.ts`:

- lines 251-258 prefer `assistantTexts` as `answerTexts`

This means anything accumulated into `assistantTexts` can become user-visible outbound payload text.

### C. Those payloads are what external delivery sends

In `src/commands/agent/delivery.ts`:

- lines 200-235 normalize and deliver those payloads externally

So once a tool-use intermediary assistant text enters `assistantTexts`, it is on the delivery path to Telegram.

### D. Compat normalization currently targets final stream boundaries, not this accumulation point

In `src/agents/pi-embedded-runner/run/attempt.ts`:

- `wrapStreamApplyTextToolCallCompat(...)` applies compat repair to:
  - `stream.result()`
  - async iterator `done`
  - async iterator `error`

It does **not** directly repair the `message_end` text that `subscribeEmbeddedPiSession` uses to populate `assistantTexts`.

## Refined Conclusion

The earlier theory that this was Telegram partial preview leakage was incorrect.

The accurate conclusion after reviewing the latest real session is:

1. the final transcript reply is normal
2. Telegram preview streaming is off
3. raw/non-final assistant content from the tool-use loop is still able to enter `assistantTexts`
4. `assistantTexts` is used as outbound answer text
5. therefore the leak happens in the **tool-use message accumulation -> payload assembly -> delivery** path

## Confirmed Data Route

The currently confirmed routing chain is:

1. provider/tool-use assistant message reaches `message_end`
   - file: `src/agents/pi-embedded-subscribe.handlers.messages.ts`
2. `message_end` text is extracted and folded into `assistantTexts`
   - file: `src/agents/pi-embedded-subscribe.handlers.messages.ts`
3. embedded attempt returns `assistantTexts` as part of the run result
   - file: `src/agents/pi-embedded-runner/run/attempt.ts`
4. payload builder prefers `assistantTexts` as outward-facing `answerTexts`
   - file: `src/agents/pi-embedded-runner/run/payloads.ts`
5. normalized outbound payloads are delivered to Telegram
   - file: `src/commands/agent/delivery.ts`

This is the key route future debugging should start from.

## Why This Matters

This is a higher-severity issue than cosmetic transcript noise because it can leak:

- tool intent
- local file paths
- host commands
- device identifiers
- transient execution strategy

to external messaging surfaces.

## Recommended Next Fix Direction

The next repair should start from this boundary:

- either prevent tool-use intermediary assistant messages from contributing raw text to `assistantTexts`
- or apply the same text-tool-call compat stripping/repair before `assistantTexts` is finalized from `message_end`

The fix must be validated against a real `lab` Telegram session again, because this issue was only observable on the external delivery path.
