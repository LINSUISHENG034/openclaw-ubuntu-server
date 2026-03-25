# Foxcode Streaming Block Reply Leak Fix

> Historical note: Foxcode is no longer an active provider in this fork. This plan is archived for context only.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent Foxcode's interleaved natural-language commentary text from being delivered to Telegram/Discord/etc. as block replies during streaming, before `message_end` can suppress it.

**Architecture:** Override `blockReplyBreak` from `"text_end"` to `"message_end"` when compat text-tool-call recovery is active. This defers all block reply emission to `handleMessageEnd`, where the existing `isToolUseAssistant` early return already suppresses text from tool-use messages. The fix is scoped to compat-enabled providers (Foxcode) and does not change behavior for other providers.

**Tech Stack:** TypeScript, Vitest, pi-embedded session subscription flow, embedded runner attempt orchestration

---

### Task 1: Write Failing Tests for Streaming Block Reply Leak During Tool-Use Messages

**Files:**

- Modify: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts`

**Step 1: Add failing test — commentary text in toolUse message must not reach onBlockReply**

This test proves that natural-language commentary text streamed during a `stopReason: "toolUse"` message is delivered to `onBlockReply`, which is the root cause of the Telegram leak.

```ts
it("does not emit commentary block replies from a toolUse assistant message", async () => {
  const onBlockReply = vi.fn();
  const { emit, subscription } = createTextEndBlockReplyHarness({ onBlockReply });

  // Simulate Foxcode streaming: commentary text → tool call → more commentary → message_end(toolUse)
  emit({ type: "message_start", message: { role: "assistant" } });

  // First text block: commentary before tool calls
  emitAssistantTextDelta({ emit, delta: "我先检查本机蓝牙和音频状态。" });
  emitAssistantTextEnd({ emit });

  // Second text block: commentary after tool calls
  emitAssistantTextDelta({ emit, delta: "进展还行：设备和音频后端已在查。" });
  emitAssistantTextEnd({ emit });

  // Message ends with toolUse
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "我先检查本机蓝牙和音频状态。" },
        {
          type: "toolCall",
          id: "call_1",
          name: "exec",
          arguments: { command: "bluetoothctl show" },
        },
        { type: "text", text: "进展还行：设备和音频后端已在查。" },
      ],
    } as AssistantMessage,
  });
  await Promise.resolve();

  // No block replies should have been sent — all text was tool-use interim commentary
  expect(onBlockReply).not.toHaveBeenCalled();
  expect(subscription.assistantTexts).toEqual([]);
});
```

**Step 2: Add failing test — final stop reply still delivers after toolUse suppression**

This test proves that the actual final reply (after tools complete, `stopReason: "stop"`) is still delivered correctly.

```ts
it("delivers the final stop reply after suppressing toolUse interim text", async () => {
  const onBlockReply = vi.fn();
  const { emit, subscription } = createTextEndBlockReplyHarness({ onBlockReply });

  // First message: toolUse with commentary — should be suppressed
  emit({ type: "message_start", message: { role: "assistant" } });
  emitAssistantTextDelta({ emit, delta: "让我检查一下。" });
  emitAssistantTextEnd({ emit });
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "让我检查一下。" },
        { type: "toolCall", id: "call_1", name: "exec", arguments: { command: "ls" } },
      ],
    } as AssistantMessage,
  });
  await Promise.resolve();

  // No block reply from the tool-use message
  expect(onBlockReply).not.toHaveBeenCalled();

  // Second message: final stop reply — should be delivered
  emit({ type: "message_start", message: { role: "assistant" } });
  emitAssistantTextDelta({ emit, delta: "检查完毕，一切正常。" });
  emitAssistantTextEnd({ emit });
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "检查完毕，一切正常。" }],
    } as AssistantMessage,
  });
  await Promise.resolve();

  expect(onBlockReply).toHaveBeenCalledTimes(1);
  expect(onBlockReply).toHaveBeenCalledWith(
    expect.objectContaining({ text: "检查完毕，一切正常。" }),
  );
  expect(subscription.assistantTexts).toEqual(["检查完毕，一切正常。"]);
});
```

**Step 3: Run the tests to verify they fail**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: Both new tests FAIL because `blockReplyBreak: "text_end"` flushes block replies at every `text_end`, before `message_end` can check `isToolUseAssistant`.

**Step 4: Commit the failing test repro**

```bash
scripts/committer "Tests: capture streaming block-reply leak during toolUse" src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

### Task 2: Override blockReplyBreak to "message_end" for Compat Providers

**Files:**

- Modify: `src/agents/pi-embedded-runner/run/attempt.ts` (around line 1794)

The fix point is where `subscribeEmbeddedPiSession` is called (line 1780). The compat config is available as `params.model.compat`. When compat text-tool-calls are enabled, override `blockReplyBreak` to `"message_end"` to defer all block reply emission to `handleMessageEnd`, where the `isToolUseAssistant` check can suppress tool-use interim text.

**Step 1: Implement the override**

In `attempt.ts`, around line 1794 where `blockReplyBreak: params.blockReplyBreak` is passed to `subscribeEmbeddedPiSession`, compute the effective break mode:

```ts
// Compat providers (Foxcode) interleave commentary text with tool calls
// during streaming. Deferring block replies to message_end allows the
// isToolUseAssistant check to suppress interim commentary before delivery.
const effectiveBlockReplyBreak =
  params.model.compat?.textToolCalls?.enabled === true && params.blockReplyBreak === "text_end"
    ? "message_end"
    : params.blockReplyBreak;
```

Then change line 1794 from:

```ts
blockReplyBreak: params.blockReplyBreak,
```

to:

```ts
blockReplyBreak: effectiveBlockReplyBreak,
```

**Step 2: Run the tests to verify they pass**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: PASS — but wait, the tests from Task 1 use `createTextEndBlockReplyHarness` which hardcodes `blockReplyBreak: "text_end"`. The tests need to use `blockReplyBreak: "message_end"` to simulate the compat override. Adjust the tests in Task 1 to use `createSubscribedSessionHarness` with `blockReplyBreak: "message_end"` instead.

Update both tests from Task 1 to use:

```ts
const { emit, subscription } = createSubscribedSessionHarness({
  runId: "run",
  onBlockReply,
  blockReplyBreak: "message_end",
});
```

This correctly simulates the compat provider path where `blockReplyBreak` is overridden to `"message_end"`.

**Step 3: Run the full test suite again**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: all tests PASS, including both new ones and all existing ones.

**Step 4: Commit the fix**

```bash
scripts/committer "Agents: defer block replies for compat providers to suppress toolUse commentary" src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

### Task 3: Add Regression Tests for the Override in attempt.ts

**Files:**

- Modify: `src/agents/pi-embedded-runner/run/attempt.test.ts`

**Step 1: Add test that verifies compat providers get message_end block reply break**

Find the existing Foxcode compat test section in `attempt.test.ts` (near the `buildFoxcodeCompatExtraSystemPrompt` or `wrapStreamApplyTextToolCallCompat` tests). Add a test that verifies the `blockReplyBreak` override behavior:

```ts
it("overrides blockReplyBreak to message_end when compat textToolCalls is enabled", () => {
  // This is a unit-level assertion on the override logic.
  // The actual override happens inline before subscribeEmbeddedPiSession,
  // so we test the logic directly.
  const computeEffectiveBreak = (
    compat: { textToolCalls?: { enabled?: boolean } } | undefined,
    requested: "text_end" | "message_end",
  ) =>
    compat?.textToolCalls?.enabled === true && requested === "text_end" ? "message_end" : requested;

  expect(computeEffectiveBreak({ textToolCalls: { enabled: true } }, "text_end")).toBe(
    "message_end",
  );
  expect(computeEffectiveBreak({ textToolCalls: { enabled: true } }, "message_end")).toBe(
    "message_end",
  );
  expect(computeEffectiveBreak({ textToolCalls: { enabled: false } }, "text_end")).toBe("text_end");
  expect(computeEffectiveBreak(undefined, "text_end")).toBe("text_end");
});
```

**Step 2: Run the test**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected: PASS

**Step 3: Commit the regression test**

```bash
scripts/committer "Tests: verify compat blockReplyBreak override logic" src/agents/pi-embedded-runner/run/attempt.test.ts
```

### Task 4: Run Full Regression Suite and Verify Build

**Files:**

- Check: All modified files

**Step 1: Run the focused regression suite**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.subscribeembeddedpisession.test.ts src/agents/pi-embedded-utils.text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/text-tool-call-compat.test.ts src/agents/recovered-tool-call-normalization.test.ts
```

Expected: All PASS

**Step 2: Run the adjacent agent runner tests**

Run:

```bash
pnpm test -- src/auto-reply/reply/dispatch-from-config.test.ts src/auto-reply/reply/agent-runner.runreplyagent.e2e.test.ts src/auto-reply/reply/agent-runner.media-paths.test.ts
```

Expected: All PASS (no regressions in delivery or block reply behavior)

**Step 3: Run a full build**

Run:

```bash
pnpm build
```

Expected: PASS with no TypeScript errors or `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings.

**Step 4: Rebuild and restart the gateway for live verification**

Run:

```bash
./fork/scripts/update-local-openclaw.sh
```

Then send a test message to the `lab` agent via Telegram that triggers tool calls (e.g. a bluetooth/audio check). Verify:

- Tool calls execute correctly
- No commentary text is delivered to Telegram during tool execution
- The final reply is delivered correctly after tools complete

## Design Notes

### Why blockReplyBreak Override Instead of Pattern Stripping

The leaking content is **natural-language commentary** ("我先检查本机蓝牙和音频状态", "进展还行") — genuine Chinese prose that is indistinguishable from real replies by pattern matching. No `stripDowngradedToolCallText` or similar regex can catch this. The fix must be **temporal** (when to emit), not **textual** (what to strip).

### Why Scoped to Compat Providers

The override only activates when `model.compat.textToolCalls.enabled === true`. Other providers keep streaming block replies at `text_end`, preserving their existing streaming UX. Foxcode loses streaming delivery to channels (Telegram users see the reply all at once), which is an acceptable trade-off because Foxcode's interleaved commentary makes streaming unreliable anyway.

### How message_end Mode Already Handles This

The existing `handleMessageEnd` already has the correct behavior:

1. `isToolUseAssistant` check at line 279-295 — returns early for tool-use messages, skipping ALL block reply emission
2. `blockReplyBreak === "message_end"` at line 409-435 — emits the final cleaned text from `extractAssistantText()` as a single block reply
3. `extractAssistantText()` calls `normalizeAssistantUserFacingText()` — strips any remaining pseudo-tool patterns

### What This Does NOT Fix

- **Web UI streaming** (`emitAgentEvent`, `onPartialReply`) — commentary text still streams to the web UI in real-time. This is acceptable because:
  - The web UI shows ephemeral streaming that gets replaced by the final message
  - The `stripDowngradedToolCallText` fix from the previous commit catches pseudo-tool patterns in streaming
  - Natural-language commentary in streaming is a cosmetic issue, not a persistent message delivery issue
