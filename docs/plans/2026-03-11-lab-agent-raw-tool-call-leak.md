# Lab Agent Raw Tool-Call Leak Containment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent raw tool-call-like assistant text from reaching outbound user surfaces when a model emits pseudo tool calls during a tool-use turn.

**Architecture:** Start by locking the bug down with failing tests at the exact seams named in the issue note: subscribe-time `assistantTexts` accumulation and embedded-run payload assembly. Reuse the existing downgrade-stripping logic instead of adding another one-off filter, but centralize it into one shared assistant-text normalizer that is applied consistently before text is stored in `assistantTexts` and again before outbound payloads are built. Keep `src/commands/agent/delivery.ts` unchanged unless the new failing tests prove payloads are already clean before delivery.

**Tech Stack:** TypeScript, Vitest, pi embedded session subscription flow, embedded runner payload assembly

---

### Task 1: Lock The Leak Down With Failing Regressions

**Files:**

- Modify: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts`
- Modify: `src/agents/pi-embedded-runner/run/payloads.errors.test.ts`
- Check: `src/agents/pi-embedded-subscribe.e2e-harness.ts`
- Check: `src/agents/pi-embedded-utils.text-tool-call-compat.test.ts`

**Step 1: Add the failing subscribe regression tests**

Add two tests to `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts`.

First test: commentary-only pseudo tool-call text must not populate `assistantTexts`.

```ts
it("does not store raw pseudo tool-call text from message_end", () => {
  const { session, emit } = createStubSessionHarness();
  const subscription = subscribeEmbeddedPiSession({ session, runId: "run" });

  emit({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: '{"tool":"read","args":{"path":"/tmp/secret"}}',
        },
      ],
    } as AssistantMessage,
  });

  expect(subscription.assistantTexts).toEqual([]);
});
```

Second test: visible prose around leaked pseudo-call text must survive while the pseudo-call block is removed.

```ts
it("keeps visible text while stripping leaked pseudo tool-call text", () => {
  const { emit, subscription } = createTextEndBlockReplyHarness();

  emitAssistantTextDelta({
    emit,
    delta: [
      "Running diagnostics.",
      "",
      '{"tool":"read","args":{"path":"/tmp/secret"}}',
      "",
      "Done.",
    ].join("\n"),
  });
  emitAssistantTextEnd({ emit });

  expect(subscription.assistantTexts).toEqual(["Running diagnostics.\n\nDone."]);
});
```

**Step 2: Run the subscribe tests to prove the gap**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: at least one new test fails because a raw pseudo-call string still survives in `assistantTexts` or streamed assistant text state.

**Step 3: Add the failing payload regression tests**

Add two tests to `src/agents/pi-embedded-runner/run/payloads.errors.test.ts`.

First test: raw pseudo-call-only `assistantTexts` should produce no user-facing payload.

```ts
it("drops assistantTexts that are only leaked pseudo tool-call text", () => {
  const payloads = buildPayloads({
    assistantTexts: ['{"tool":"read","args":{"path":"/tmp/secret"}}'],
    lastAssistant: makeStoppedAssistant(),
  });

  expect(payloads).toHaveLength(0);
});
```

Second test: mixed user-facing text plus leaked pseudo-call text should preserve only the visible answer.

```ts
it("strips leaked pseudo tool-call text from outbound answer payloads", () => {
  const payloads = buildPayloads({
    assistantTexts: [
      [
        "Running diagnostics.",
        "",
        '{"tool":"read","args":{"path":"/tmp/secret"}}',
        "",
        "Done.",
      ].join("\n"),
    ],
    lastAssistant: makeStoppedAssistant(),
  });

  expectSinglePayloadText(payloads, "Running diagnostics.\n\nDone.");
});
```

**Step 4: Run the payload tests to prove the outbound gap**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

Expected: the new tests fail because `buildEmbeddedRunPayloads()` currently trusts `assistantTexts` too much.

**Step 5: Commit the test-only repro**

```bash
scripts/committer "Tests: capture raw tool-call leak regressions" src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

### Task 2: Extract One Shared Assistant Text Normalizer

**Files:**

- Modify: `src/agents/pi-embedded-utils.ts`
- Modify: `src/agents/pi-embedded-utils.text-tool-call-compat.test.ts`

**Step 1: Add the failing helper tests**

Extend `src/agents/pi-embedded-utils.text-tool-call-compat.test.ts` with direct unit coverage for a new shared helper.

```ts
it("normalizes raw pseudo tool-call text to empty output", () => {
  expect(normalizeAssistantUserFacingText('{"tool":"read","args":{"path":"/tmp/secret"}}')).toBe(
    "",
  );
});

it("preserves prose around leaked pseudo tool-call text", () => {
  expect(
    normalizeAssistantUserFacingText(
      [
        "Running diagnostics.",
        "",
        '{"tool":"read","args":{"path":"/tmp/secret"}}',
        "",
        "Done.",
      ].join("\n"),
    ),
  ).toBe("Running diagnostics.\n\nDone.");
});
```

**Step 2: Run the helper tests to verify the helper does not exist yet**

Run:

```bash
pnpm test -- src/agents/pi-embedded-utils.text-tool-call-compat.test.ts
```

Expected: FAIL because `normalizeAssistantUserFacingText` is missing.

**Step 3: Implement the minimal shared helper**

In `src/agents/pi-embedded-utils.ts`, add a shared export that centralizes the existing cleanup steps already split across `extractAssistantText()` and `stripDowngradedToolCallText()`.

Recommended shape:

```ts
export function normalizeAssistantUserFacingText(
  text: string,
  opts?: { errorContext?: boolean },
): string {
  const stripped = stripThinkingTagsFromText(
    stripDowngradedToolCallText(stripModelSpecialTokens(stripMinimaxToolCallXml(text))),
  ).trim();
  return sanitizeUserFacingText(stripped, { errorContext: opts?.errorContext });
}
```

Then simplify `extractAssistantText()` to call the helper instead of inlining the cleanup stack.

**Step 4: Run the helper tests to verify the helper works**

Run:

```bash
pnpm test -- src/agents/pi-embedded-utils.text-tool-call-compat.test.ts
```

Expected: PASS

**Step 5: Commit the helper extraction**

```bash
scripts/committer "Agents: centralize assistant text normalization" src/agents/pi-embedded-utils.ts src/agents/pi-embedded-utils.text-tool-call-compat.test.ts
```

### Task 3: Apply Normalization Before `assistantTexts` Is Finalized

**Files:**

- Modify: `src/agents/pi-embedded-subscribe.ts`
- Modify: `src/agents/pi-embedded-subscribe.handlers.messages.ts`
- Modify: `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts`

**Step 1: Add one more failing streaming-path test**

Add a regression that exercises the streamed partial path, not just the final `message_end` snapshot.

```ts
it("does not emit raw pseudo tool-call text through streamed assistant updates", () => {
  const onBlockReply = vi.fn();
  const { emit, subscription } = createTextEndBlockReplyHarness({ onBlockReply });

  emitAssistantTextDelta({
    emit,
    delta: 'to=exec commentary code\n{"command":"pwd","yieldMs":1000}\n\nDone.',
  });
  emitAssistantTextEnd({ emit });

  expect(subscription.assistantTexts).toEqual(["Done."]);
  expect(onBlockReply).toHaveBeenCalledWith(expect.objectContaining({ text: "Done." }));
});
```

**Step 2: Run the subscribe regression file again**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: FAIL because the streaming path still uses text that has only had block tags stripped.

**Step 3: Implement the narrow subscribe-layer fix**

Wire the new helper into both subscribe seams:

- In `src/agents/pi-embedded-subscribe.ts`, normalize text inside `emitBlockChunk()` before duplicate detection, `assistantTexts.push(...)`, and outbound block-reply emission.
- In `src/agents/pi-embedded-subscribe.ts`, normalize the `text` argument inside `finalizeAssistantTexts()` before `pushAssistantText(...)` or splice replacement.
- In `src/agents/pi-embedded-subscribe.handlers.messages.ts`, normalize `cleanedText` and the `text` passed to `finalizeAssistantTexts(...)` after `resolveSilentReplyFallbackText(...)`.

Keep the change narrow:

```ts
const normalized = normalizeAssistantUserFacingText(rawText);
if (!normalized) {
  return;
}
```

Do not change reasoning extraction or tool metadata logic in this task.

**Step 4: Re-run the subscribe regression file**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

Expected: PASS

**Step 5: Commit the subscribe-layer fix**

```bash
scripts/committer "Agents: strip leaked tool text before assistantTexts finalize" src/agents/pi-embedded-subscribe.ts src/agents/pi-embedded-subscribe.handlers.messages.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts
```

### Task 4: Add A Payload-Layer Safety Net

**Files:**

- Modify: `src/agents/pi-embedded-runner/run/payloads.ts`
- Modify: `src/agents/pi-embedded-runner/run/payloads.errors.test.ts`
- Check: `src/agents/pi-embedded-runner/run/payloads.test-helpers.ts`

**Step 1: Re-run the failing payload tests**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

Expected: still FAIL after Task 3, proving payload assembly needs its own defense-in-depth cleanup.

**Step 2: Implement payload normalization**

In `src/agents/pi-embedded-runner/run/payloads.ts`, normalize both sources of outward-facing answer text before `parseReplyDirectives(...)` runs:

```ts
const fallbackAnswerText = params.lastAssistant
  ? normalizeAssistantUserFacingText(extractAssistantText(params.lastAssistant), {
      errorContext: Boolean(params.lastAssistant.errorMessage?.trim()),
    })
  : "";

const answerTexts = rawAnswerTexts
  .map((text) => normalizeAssistantUserFacingText(text))
  .filter(Boolean)
  .filter((text) => !shouldSuppressRawErrorText(text));
```

Important rules:

- drop empty normalized strings
- preserve existing raw-error suppression behavior
- do not synthesize replacement text for stripped pseudo-calls

**Step 3: Re-run the payload tests**

Run:

```bash
pnpm test -- src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

Expected: PASS

**Step 4: Run the subscribe and payload files together**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts src/agents/pi-embedded-utils.text-tool-call-compat.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

Expected: PASS for all three files.

**Step 5: Commit the payload safety net**

```bash
scripts/committer "Agents: sanitize outbound payload text" src/agents/pi-embedded-runner/run/payloads.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

### Task 5: Verify The Real Fix Path And Avoid Scope Creep

**Files:**

- Check: `src/agents/pi-embedded-subscribe.ts`
- Check: `src/agents/pi-embedded-subscribe.handlers.messages.ts`
- Check: `src/agents/pi-embedded-runner/run/payloads.ts`
- Check: `src/commands/agent/delivery.ts`

**Step 1: Run the focused regression suite**

Run:

```bash
pnpm test -- src/agents/pi-embedded-utils.text-tool-call-compat.test.ts src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.does-not-emit-duplicate-block-replies-text.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts
```

Expected: PASS

**Step 2: Run the adjacent module tests**

Run:

```bash
pnpm test -- src/agents/pi-embedded-subscribe.handlers.messages.test.ts src/agents/pi-embedded-runner/run/payloads.test.ts src/agents/pi-embedded-runner/run/attempt.test.ts
```

Expected: PASS with no regressions in existing compat or payload behavior.

**Step 3: Do one manual external-path validation**

Repeat the same `lab` Telegram request from the issue note against a local build with the patch applied. Verify three things:

- the Telegram user only sees normal reply text
- the resulting `assistantTexts` values do not contain raw pseudo tool-call strings
- the final persisted assistant message still contains the expected structured `toolCall` blocks, not downgraded text

If the external surface still leaks while the tests pass, only then add a new failing regression around `src/commands/agent/delivery.ts`.

**Step 4: Run one full build**

Run:

```bash
pnpm build
```

Expected: PASS with no TypeScript or bundling regressions.

**Step 5: Commit the verification-only follow-up if needed**

If Task 3 manual validation requires no further code, skip this commit.

If a delivery-layer regression is proven and fixed, use:

```bash
scripts/committer "Agent: harden delivery against leaked tool text" src/commands/agent/delivery.ts src/commands/agent.delivery.test.ts
```

## Notes For The Implementer

- Do not widen this into another text-tool-call parser project. The parser already exists. This fix is about making outbound assistant-text normalization use the same safety rules everywhere.
- The issue note points at `message_end -> assistantTexts`, but current code already routes `message_end` through `extractAssistantText()`, which strips downgraded tool-call text. Treat Task 1 as the truth source for the actual remaining leak seam.
- Prefer fixing the shared normalization boundary over ad-hoc regex checks in `payloads.ts` or `delivery.ts`.
