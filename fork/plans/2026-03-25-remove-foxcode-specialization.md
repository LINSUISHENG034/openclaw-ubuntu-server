# Remove Foxcode Specialization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Foxcode-specific runtime, test, and local-workflow special cases while preserving the generic compat mechanisms that help upstream alignment.

**Architecture:** Keep `compat.textToolCalls` and the generic text-to-tool-call recovery pipeline as the reusable abstraction. Delete or generalize any behavior that keys on `provider === "foxcode-codex"` or treats Foxcode as a first-class local workflow concern. Archive fork-only Foxcode notes instead of letting them keep steering future upstream merges.

**Tech Stack:** TypeScript, Vitest, OpenClaw embedded-agent runtime, Telegram channel runtime, local fork maintenance scripts/docs.

---

### Task 1: Freeze the generic compat surface

**Files:**

- Modify: `src/config/types.models.ts`
- Modify: `src/agents/text-tool-call-compat.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.ts`
- Test: `src/agents/text-tool-call-compat.test.ts`
- Test: `src/agents/pi-embedded-runner/run/attempt.test.ts`

**Step 1: Write or tighten failing tests around generic compat behavior**

Add/keep tests that prove these behaviors without any Foxcode provider name:

- `compat.textToolCalls.enabled === true` allows pseudo tool-call parsing
- `resolveEffectiveBlockReplyBreak(...)` upgrades `text_end` to `message_end`
- `compat.textToolCalls.enabled === false` keeps normal behavior

Use provider-agnostic fixtures where possible.

**Step 2: Run tests to verify the generic compat surface is covered**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts -t "compat"
```

Expected: passing generic compat assertions with no Foxcode-only naming dependency.

**Step 3: Minimize the retained compat contract**

Keep these abstractions:

- `TextToolCallCompatConfig`
- `parseTextToolCalls(...)`
- `applyTextToolCallCompatToTextBlock(...)`
- `resolveEffectiveBlockReplyBreak(...)`

Do not keep any provider-branded helper in this layer.

**Step 4: Re-run the same tests**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts -t "compat"
```

Expected: PASS.

**Step 5: Commit**

```bash
scripts/committer "Agents: keep generic compat surface only" src/config/types.models.ts src/agents/text-tool-call-compat.ts src/agents/pi-embedded-runner/run/attempt.ts src/agents/text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

### Task 2: Remove provider-bound Foxcode runtime hooks

**Files:**

- Modify: `src/agents/recovered-tool-call-normalization.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.ts`
- Modify: `src/agents/openai-ws-stream.ts`
- Test: `src/agents/recovered-tool-call-normalization.test.ts`
- Test: `src/agents/openai-ws-stream.test.ts`
- Test: `src/agents/pi-embedded-runner/run/attempt.test.ts`

**Step 1: Write failing tests for the target post-cleanup behavior**

Add or adjust tests so they assert one of these outcomes explicitly:

- either recovered-call normalization is triggered by a generic compat profile
- or the entire Foxcode-specific normalization helper is removed and callers no longer depend on it

Also add a negative assertion that `provider: "foxcode-codex"` is no longer a privileged runtime key.

**Step 2: Run the focused tests to see the current Foxcode coupling**

Run:

```bash
pnpm test -- src/agents/recovered-tool-call-normalization.test.ts src/agents/openai-ws-stream.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected: at least one failing assertion before the cleanup if tests were tightened correctly.

**Step 3: Implement the minimal cleanup**

Choose one of these, with a bias toward deletion:

- delete `normalizeRecoveredToolCallsInAssistantMessage(...)` entirely if no current provider needs it
- or generalize its activation to a compat-format trigger instead of `provider === "foxcode-codex"`

Also remove:

- `buildFoxcodeCompatExtraSystemPrompt(...)`
- `buildFoxcodeCompatBootstrapContainmentPrompt(...)`
- their callsites in `src/agents/pi-embedded-runner/run/attempt.ts`

If a replacement prompt helper is still needed, rename it to a provider-neutral compat helper and key it on compat config, not provider name.

**Step 4: Re-run the focused tests**

Run:

```bash
pnpm test -- src/agents/recovered-tool-call-normalization.test.ts src/agents/openai-ws-stream.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected: PASS with no Foxcode-specific runtime dependency.

**Step 5: Commit**

```bash
scripts/committer "Agents: remove Foxcode-specific compat hooks" src/agents/recovered-tool-call-normalization.ts src/agents/pi-embedded-runner/run/attempt.ts src/agents/openai-ws-stream.ts src/agents/recovered-tool-call-normalization.test.ts src/agents/openai-ws-stream.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

### Task 3: Convert channel regressions from Foxcode-branded to compat-branded

**Files:**

- Modify: `extensions/telegram/src/bot-message-dispatch.test.ts`
- Move/Modify: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts`
- Test: `extensions/telegram/src/bot-message-dispatch.test.ts`
- Test: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts`

**Step 1: Rename the intent of the tests**

Adjust test names and fixtures so they describe generic compat behavior:

- “compat text-tool-call sessions do not create Telegram partial previews”
- “compat replay defers block replies until message_end”

Avoid:

- `foxcode-codex`
- `Foxcode compat`
- Foxcode-branded run ids unless the test is explicitly historical

**Step 2: Run the targeted tests before code cleanup**

Run:

```bash
pnpm test -- extensions/telegram/src/bot-message-dispatch.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts
```

Expected: existing tests still demonstrate the current branded dependency.

**Step 3: Apply the minimal refactor**

- replace provider-specific fixtures with generic compat-enabled model fixtures
- rename the replay test file if useful
- keep the behavior being protected identical

**Step 4: Re-run the targeted tests**

Run:

```bash
pnpm test -- extensions/telegram/src/bot-message-dispatch.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts
```

Expected: PASS with compat-focused naming and fixtures.

**Step 5: Commit**

```bash
scripts/committer "Tests: rename Foxcode regressions to generic compat coverage" extensions/telegram/src/bot-message-dispatch.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts
```

### Task 4: Remove Foxcode from the local update workflow

**Files:**

- Modify: `fork/scripts/update-local-openclaw.sh`
- Test: `extensions/telegram/src/bot-message-dispatch.test.ts`
- Test: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts`

**Step 1: Replace the script’s Foxcode framing**

Update:

- variable names
- comments
- echoed headings

So the script talks about “compat regression checks” instead of “Foxcode leak regression checks”.

**Step 2: Decide whether the gate still belongs in the script**

Prefer one of:

- keep the gate but rename it to generic compat coverage
- or remove the gate entirely if those tests are no longer fork-critical

Bias toward removal if the fork is trying to shrink divergence.

**Step 3: Run the exact script after the wording/scope change**

Run:

```bash
fork/scripts/update-local-openclaw.sh
```

Expected: install, targeted tests, build, restart all complete successfully.

**Step 4: Verify the gateway explicitly**

Run:

```bash
openclaw gateway status --deep --require-rpc
```

Expected: `RPC probe: ok`.

**Step 5: Commit**

```bash
scripts/committer "Fork: remove Foxcode-specific update gates" fork/scripts/update-local-openclaw.sh
```

### Task 5: Archive Foxcode-specific fork history so it stops steering future merges

**Files:**

- Modify: `fork/README.md`
- Modify: `fork/experience/upstream-merges/README.md`
- Move/Modify: `fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment.md`
- Move/Modify: `fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment_v2.md`
- Move/Modify: `fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment-implementation.md`
- Move/Modify: `fork/plans/2026-03-11-foxcode-streaming-block-reply-leak.md`
- Move/Modify: `fork/experience/2026-03-11-foxcode-live-verification-and-prompt-ordering.md`
- Move/Modify: `fork/experience/2026-03-12-foxcode-telegram-leak-repair.md`

**Step 1: Create an archive convention**

Pick one simple rule, for example:

- move Foxcode historical notes under `fork/archive/foxcode/`
- or keep them in place but mark them clearly as historical/inactive

Prefer in-place archive headers if you want low churn.

**Step 2: Update index docs so future syncs stop treating Foxcode as active policy**

Add a short note saying:

- Foxcode provider is no longer active
- these notes are historical only
- future upstream merges should preserve generic compat, not Foxcode-specific behavior

**Step 3: Verify references still make sense**

Run:

```bash
rg -n "foxcode-codex|Foxcode compat|Foxcode tool-call compatibility" fork
```

Expected: only historical/archive docs and explicitly labeled old notes remain.

**Step 4: Commit**

```bash
scripts/committer "Docs: archive Foxcode-specific fork history" fork/README.md fork/experience/upstream-merges/README.md fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment.md fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment_v2.md fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment-implementation.md fork/plans/2026-03-11-foxcode-streaming-block-reply-leak.md fork/experience/2026-03-11-foxcode-live-verification-and-prompt-ordering.md fork/experience/2026-03-12-foxcode-telegram-leak-repair.md
```

### Task 6: Run final whole-flow verification

**Files:**

- Modify: none
- Test: `fork/scripts/update-local-openclaw.sh`

**Step 1: Run the focused test bundle**

Run:

```bash
pnpm test -- extensions/telegram/src/bot-message-dispatch.test.ts src/agents/text-tool-call-compat.test.ts src/agents/recovered-tool-call-normalization.test.ts src/agents/openai-ws-stream.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts
```

Expected: PASS, with generic compat framing and no Foxcode-specific runtime dependency.

**Step 2: Run the local update workflow**

Run:

```bash
fork/scripts/update-local-openclaw.sh
```

Expected: PASS.

**Step 3: Verify the gateway after restart**

Run:

```bash
openclaw gateway status --deep --require-rpc
ss -ltnp | rg 18789
```

Expected:

- `RPC probe: ok`
- `127.0.0.1:18789` listening

**Step 4: Commit**

```bash
git status --short
```

Expected: clean worktree before any push.
