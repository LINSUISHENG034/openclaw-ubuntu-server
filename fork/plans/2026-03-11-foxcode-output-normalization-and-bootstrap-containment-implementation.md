# Foxcode Output Normalization and Bootstrap Containment Implementation Plan

> Historical note: Foxcode is no longer an active provider in this fork. This implementation plan is archived for context only.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the reproduced Foxcode `openai-responses` failures by correcting recovered tool arguments, guaranteeing unique recovered tool-call ids across an assistant message, and suppressing bootstrap-dominant replies on fresh external-channel sessions.

**Architecture:** Keep the fix Foxcode-scoped and compat-gated. Correct obvious source-level bugs in `text-tool-call-compat.ts`, then add one shared post-recovery normalization helper at the assistant-message boundary for per-message id uniqueness and bounded tool-aware argument canonicalization. Bootstrap containment stays in prompt assembly, not transcript repair.

**Tech Stack:** TypeScript, Vitest, OpenClaw embedded runner, pi-agent content blocks, JSON5 config-driven model compat.

---

### Task 1: Lock the Foxcode Regression Surface

**Files:**

- Modify: `src/agents/text-tool-call-compat.test.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.test.ts`
- Test: `src/agents/text-tool-call-compat.test.ts`
- Test: `src/agents/pi-embedded-runner/run/attempt.test.ts`

**Step 1: Write the failing parser-level tests**

Add test cases that prove the current source-level bugs:

```ts
it("maps bracket read pseudo-calls to path", () => {
  const result = parseTextToolCalls({
    text: "[Tool call: read `/tmp/test.txt`]",
    compat: { enabled: true, formats: ["codex_commentary_v1"] },
    allowedToolNames: new Set(["read"]),
  });

  expect(result.toolCalls).toEqual([
    {
      id: "compat_text_call_1",
      name: "read",
      arguments: { path: "/tmp/test.txt" },
    },
  ]);
});

it("maps bracket exec pseudo-calls to command", () => {
  const result = parseTextToolCalls({
    text: "[Tool call: exec `pwd`]",
    compat: { enabled: true, formats: ["codex_commentary_v1"] },
    allowedToolNames: new Set(["exec"]),
  });

  expect(result.toolCalls[0]?.arguments).toEqual({ command: "pwd" });
});
```

**Step 2: Write the failing assistant-message test for duplicate recovered ids**

Add a test in `attempt.test.ts` that constructs one assistant message with multiple text blocks, each containing one recovered pseudo-tool call, and assert the final normalized message contains unique ids:

```ts
expect(result.content).toEqual([
  { type: "toolCall", id: "compat_text_call_1", name: "read", arguments: { path: "/tmp/a" } },
  { type: "toolCall", id: "compat_text_call_2", name: "read", arguments: { path: "/tmp/b" } },
]);
```

**Step 3: Run tests to verify they fail**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected:

- bracket pseudo-call tests fail because current code emits `filePath` / `cmd`
- duplicate-id test fails because recovered ids reset across text blocks

**Step 4: Commit the failing test snapshot**

```bash
scripts/committer "Tests: lock Foxcode compat regressions" src/agents/text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected:

- if hooks reject because tests are intentionally failing, skip commit and continue implementation immediately

### Task 2: Fix Source-Level Recovery Bugs in `text-tool-call-compat.ts`

**Files:**

- Modify: `src/agents/text-tool-call-compat.ts`
- Test: `src/agents/text-tool-call-compat.test.ts`

**Step 1: Fix bracket pseudo-call argument shapes**

Update `buildBracketPseudoToolArgs` so it emits OpenClaw tool-contract field names directly:

```ts
if (trimmedName === "read") {
  return { path: payload };
}
if (trimmedName === "exec") {
  return { command: payload };
}
```

**Step 2: Keep parser behavior otherwise unchanged**

Do not add generic heuristics here. Keep all existing format matching rules and compat gating intact.

**Step 3: Run parser tests**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts
```

Expected:

- all parser tests pass, including the new bracket alias tests

**Step 4: Commit**

```bash
scripts/committer "Agents: fix Foxcode bracket pseudo-call args" src/agents/text-tool-call-compat.ts src/agents/text-tool-call-compat.test.ts
```

### Task 3: Add Shared Recovered Tool-Call Normalization

**Files:**

- Add: `src/agents/recovered-tool-call-normalization.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.ts`
- Modify: `src/agents/openai-ws-stream.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.test.ts`
- Add: `src/agents/recovered-tool-call-normalization.test.ts`

**Step 1: Write the failing helper tests**

Create focused unit tests for a new helper that:

- renumbers duplicate recovered ids across one assistant message
- canonicalizes `read.filePath -> read.path`
- canonicalizes `read.file_path -> read.path`
- canonicalizes `exec.cmd -> exec.command`
- fails closed when alias and canonical fields both exist
- leaves non-Foxcode / compat-disabled content untouched

Example:

```ts
it("renumbers duplicate recovered ids across one assistant message", () => {
  const message = {
    role: "assistant",
    stopReason: "toolUse",
    content: [
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { filePath: "/tmp/a" },
      },
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { filePath: "/tmp/b" },
      },
    ],
  };

  normalizeRecoveredToolCallsInAssistantMessage({
    message,
    provider: "foxcode-codex",
    modelApi: "openai-responses",
    compat: { textToolCalls: { enabled: true } },
  });

  expect(message.content).toMatchObject([
    { id: "compat_text_call_1", arguments: { path: "/tmp/a" } },
    { id: "compat_text_call_2", arguments: { path: "/tmp/b" } },
  ]);
});
```

**Step 2: Run the new helper tests to verify failure**

Run:

```bash
pnpm test -- src/agents/recovered-tool-call-normalization.test.ts
```

Expected:

- FAIL because helper/file does not exist yet

**Step 3: Implement the helper**

Create `src/agents/recovered-tool-call-normalization.ts` with a narrowly scoped API, for example:

```ts
export function normalizeRecoveredToolCallsInAssistantMessage(params: {
  message: unknown;
  provider?: string;
  modelApi?: string;
  compat?: ModelCompatConfig;
}): void;
```

Implementation requirements:

- no-op unless provider is `foxcode-codex`, model API is `openai-responses`, and compat enables text-tool-call recovery
- only touch `toolCall` blocks
- renumber duplicate `compat_text_call_*` ids across the full message
- canonicalize known aliases only
- skip transformation when canonical and alias fields both exist

**Step 4: Wire the helper into the shared assistant-message normalization path**

In `attempt.ts`, run the new helper immediately after text-tool-call recovery and before stop-reason/tool-name/id cleanup.

In `openai-ws-stream.ts`, reuse the same helper in the message-finalization path so both transports share the same recovered-call normalization semantics.

**Step 5: Run targeted tests**

Run:

```bash
pnpm test -- src/agents/recovered-tool-call-normalization.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/openai-ws-stream.test.ts
```

Expected:

- new helper tests pass
- attempt/openai-ws-stream tests still pass

**Step 6: Commit**

```bash
scripts/committer "Agents: normalize recovered Foxcode tool calls" src/agents/recovered-tool-call-normalization.ts src/agents/recovered-tool-call-normalization.test.ts src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/openai-ws-stream.ts src/agents/openai-ws-stream.test.ts
```

### Task 4: Add Foxcode Fresh-Session Bootstrap Containment

**Files:**

- Modify: `src/agents/pi-embedded-runner/run/attempt.ts`
- Modify: `src/agents/pi-embedded-runner/run/attempt.test.ts`

**Step 1: Write failing prompt-assembly tests**

Add tests around `buildFoxcodeCompatExtraSystemPrompt` (or a small extracted helper) that cover:

- Foxcode + compat enabled + fresh external-channel session => bootstrap suppression instruction present
- Foxcode + compat enabled + local/web session => bootstrap suppression instruction absent
- non-Foxcode provider => bootstrap suppression instruction absent

Example:

```ts
expect(prompt).toContain("Do not output a bootstrap greeting");
expect(prompt).not.toContain("Do not output a bootstrap greeting");
```

**Step 2: Run the test to verify failure**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected:

- FAIL because current prompt helper has no session/channel-aware bootstrap containment

**Step 3: Implement the triple-gate containment rule**

In `attempt.ts`:

- extend the Foxcode prompt helper to accept:
  - `messageChannel`
  - session freshness signal derived from current message history / prior assistant turns
  - session mode if needed
- only append bootstrap-suppression text when:
  - provider is `foxcode-codex`
  - model API is `openai-responses`
  - compat is enabled
  - session is fresh
  - channel is an external messaging surface

Do not remove `BOOTSTRAP.md` from context. Only demote it via prompt instruction.

**Step 4: Run targeted tests**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected:

- new prompt tests pass
- existing Foxcode compat tests still pass

**Step 5: Commit**

```bash
scripts/committer "Agents: contain Foxcode bootstrap on fresh channel sessions" src/agents/pi-embedded-runner/run/attempt.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

### Task 5: Run Non-Regression and Live Verification

**Files:**

- Modify: `fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment_v2.md`
- Optional: `docs/help/testing.md` if a durable regression workflow note is worth adding

**Step 1: Run targeted regression suite**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts src/agents/recovered-tool-call-normalization.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts src/agents/openai-ws-stream.test.ts src/shared/chat-content.text-tool-call-compat.test.ts src/agents/pi-embedded-utils.text-tool-call-compat.test.ts
```

Expected:

- all targeted Foxcode compat tests pass

**Step 2: Run one stable-provider spot check**

Use an existing non-Foxcode path test that exercises assistant/tool-call handling, for example:

```bash
pnpm test -- src/agents/openai-ws-stream.test.ts
```

Expected:

- no regression on native structured tool-call handling

**Step 3: Live-verify with the `lab` bot**

Manual checks:

1. Send Telegram `/start` to `lab`
2. Send one concrete file/tool task
3. Send one casual first-turn message

Expected:

- `/start` no longer returns the generic bootstrap greeting as the dominant final answer
- recovered tool calls execute without alias-related schema failures
- no obvious regression in normal non-tool first-turn chat

**Step 4: Update proposal status/evidence**

Add a short implementation note to the final proposal recording:

- which alias mappings shipped
- which live checks passed
- any remaining Foxcode failure modes not solved in this patch

**Step 5: Commit**

```bash
scripts/committer "Docs: record Foxcode normalization rollout notes" fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment_v2.md
```
