# Foxcode Live Verification and Prompt Ordering

> Historical note: Foxcode is no longer an active provider in this fork. This document is retained only as a record of past debugging and should not be treated as current merge policy.

Date: 2026-03-11

## Goal

Record what actually mattered while fixing the Foxcode `openai-responses` regressions on the `lab` Telegram agent.

This change looked finished after unit tests passed, but live verification exposed two separate realities:

1. the running gateway may still be serving stale `dist`
2. prompt wording alone is not enough if the instruction is placed before stronger contradictory context

## What Happened

The source-side fix covered three areas:

- recovered tool-call argument normalization
- duplicate recovered tool-call ids
- bootstrap containment for fresh external sessions

Targeted tests passed, but the first live run on `lab` still showed:

- `/start` replying with bootstrap-heavy identity setup
- recovered `read` calls still using `filePath`
- casual first-turn chat still falling into bootstrap mode

That looked like the patch had failed. It had not.

## Root Cause 1: Live Verification Was Hitting Old `dist`

The gateway process on this machine runs:

```bash
/mnt/sda1/github/openclaw/dist/index.js
```

not `src/` directly.

The first live verification was run before rebuilding `dist`, so the runtime still used the old behavior.

### Lesson

When a fix changes agent runtime logic, do not trust live results until all three are true:

1. `pnpm build` succeeded
2. the gateway was restarted
3. the new process is listening on the expected port

If not, you are testing stale code and the live failure is not actionable yet.

## Root Cause 2: Prompt Placement Beat Prompt Wording

After rebuilding and restarting the gateway, tool-call normalization started working live:

- no more `filePath -> path` schema failure on the first recovered `read`

But bootstrap containment still failed live.

The reason was prompt structure.

The Foxcode containment instruction originally lived in the regular extra system prompt area, which appears before `# Project Context`.

Later in the prompt, `BOOTSTRAP.md` was injected with explicit lines such as:

- `Hey. I just came online.`
- `Who am I, and who are you?`

In real model behavior, the later workspace file content overrode the earlier containment warning.

### Lesson

For behavior conflicts like this, instruction order matters as much as instruction text.

If a context file contains a strong behavioral script, an override that should supersede it must appear after that file in the final prompt, not before it.

## Working Fix

The effective fix was:

1. keep Foxcode tool-call protocol guidance in the normal extra-system area
2. move bootstrap containment into a dedicated post-project-context override
3. inject that override after workspace files so it can demote `BOOTSTRAP.md` without removing it

This preserved:

- bootstrap context availability
- fresh-session external-channel containment
- local/web behavior boundaries

## Verified Outcome

After rebuilding `dist`, restarting the gateway, and rerunning fresh Telegram-context live tests on `lab`:

- `/start` stopped returning bootstrap greeting/setup text
- a concrete `read USER.md` task completed without alias/schema failure
- casual `Hi there.` produced a normal greeting instead of an identity/bootstrap questionnaire

## Practical Rule Going Forward

For OpenClaw runtime bug fixes:

1. pass targeted tests
2. build `dist`
3. restart the gateway
4. rerun live verification against the real agent/channel path
5. if prompt behavior is still wrong, inspect final prompt ordering before changing wording again

## Why This Matters

Without these checks, it is easy to misdiagnose:

- stale runtime as broken source code
- prompt ordering bugs as prompt wording bugs

That leads to unnecessary rewrites and the wrong fix.
