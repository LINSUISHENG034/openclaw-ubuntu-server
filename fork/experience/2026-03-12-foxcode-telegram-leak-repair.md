# Foxcode Telegram Leak Repair

> Historical note: Foxcode is no longer an active provider in this fork. This document is retained only as a record of past debugging and should not be treated as current merge policy.

Date: 2026-03-12

## Goal

Record what actually fixed the Foxcode provider leaking process content to Telegram, and what did not.

The leak turned out to have two different outward paths:

1. block-reply leakage before the final answer boundary
2. Telegram preview leakage during partial streaming, even when the final message was later refreshed

Both had to be treated separately.

## What The Session Could And Could Not Prove

The persisted agent session was enough to prove:

- the provider was `foxcode-codex`
- the transport was `openai-responses`
- tool-use messages and final answers were both present

But the persisted session was not enough to prove Telegram preview leakage.

Why:

- agent sessions persist `message` and `toolResult` events
- Telegram preview leakage happens on the `onPartialReply` path before final delivery
- those preview edits do not become durable assistant transcript entries

Practical rule:

- if the user says "I saw leaked text during the reply, but the final message looked clean", do not expect the session transcript alone to show it
- debug that class of bug at the channel dispatch layer, not only the embedded session layer

## Root Cause 1: Compat Tool-Use Commentary Was Flushed Too Early

The first leak path was in the embedded subscribe/tool-start boundary.

Sequence:

1. Foxcode streamed commentary-like text before tools
2. `tool_execution_start` flushed the current block buffer
3. that text was emitted outward before `message_end`
4. only later did `message_end` reveal the assistant message was actually `toolUse`

So the classification arrived too late for the already-flushed text.

Working fix:

- in `message_end` mode, do not flush the current assistant block buffer on `tool_execution_start`
- keep the flush for `text_end` mode only

Why this works:

- Foxcode compat already forces `blockReplyBreak` from `text_end` to `message_end`
- once tool-start flush is skipped in that mode, `message_end` gets a chance to classify the assistant message as intermediate and suppress it

## Root Cause 2: Telegram Preview Streaming Was A Separate Leak Path

After fixing block-reply leakage, there was still a second bug:

- Telegram DM preview lanes were still created for Foxcode compat sessions
- commentary text could appear in the preview during `onPartialReply`
- the final answer later overwrote that preview, so the persisted result looked clean

This is why the user could still observe leaked text in real time even when the final message was acceptable.

Working fix:

- in `src/telegram/bot-message-dispatch.ts`, suppress answer partial previews for compat sessions where `compat.textToolCalls.enabled === true`
- keep final delivery enabled

This is effectively a fail-closed rule for external Telegram previews:

- no live answer preview for Foxcode compat sessions
- final answer still sends normally

## Tests That Actually Helped

Two different test layers were needed.

### 1. Embedded compat boundary replay

Use a subscribe-layer replay test for:

- `message_start`
- commentary `text_delta`
- `tool_execution_start`
- `toolUse message_end`
- later final `stop` message

This catches early block-buffer leaks.

### 2. Telegram preview dispatch test

Use a `bot-message-dispatch` test for:

- compat session metadata in the session store
- `streamMode: "partial"`
- a commentary partial followed by a clean final

This catches "preview leaked, final refreshed cleanly" behavior that the persisted session will miss.

## Live Verification Notes

After rebuilding `dist` and restarting `openclaw-gateway.service`:

- a Foxcode `read USER.md` Telegram DM run produced only the final answer in the observed outbound path
- no commentary or pseudo tool-call text was observed in the final outward result

One more practical note:

- if a later live run times out and falls back to another provider, do not use that run to conclude anything about Foxcode preview behavior
- the verification must be taken from a run that actually stayed on Foxcode long enough to exercise the suspect path

## Key Rules Going Forward

1. For compat providers, do not trust session transcripts to reveal preview-only leaks.
2. When a provider can mix commentary with tool-use, prefer fail-closed external delivery over clever text cleanup.
3. Keep block-reply and preview-streaming tests separate. They protect different boundaries.
4. Always rebuild `dist` and restart the gateway before any Telegram live verification claim.
