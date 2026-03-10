# Text Tool-Call Compatibility Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an explicitly enabled, reusable compatibility layer that converts supported text-form tool-call emissions into OpenClaw's internal structured `toolCall` blocks.

**Architecture:** Extend model `compat` config with a `textToolCalls` section, implement a strict parser module for named text protocols, and invoke that parser at the provider response normalization boundary before assistant text reaches sanitization/rendering. Phase 1 wires the generic parser into the `openai-responses` adapter because that is the failing production path, but the parser API is designed for reuse by future adapters.

**Tech Stack:** TypeScript, Zod config schemas, pi-ai assistant message blocks, Vitest

---

### Task 1: Add Compat Config Surface

**Files:**

- Modify: `src/config/types.models.ts`
- Modify: `src/config/zod-schema.core.ts`
- Test: `src/config/config-misc.test.ts`

**Step 1: Write the failing schema test**

Add a new test case to `src/config/config-misc.test.ts` that validates:

- `compat.textToolCalls.enabled`
- `compat.textToolCalls.formats`
- `compat.textToolCalls.requireKnownToolName`
- `compat.textToolCalls.allowMixedText`
- `compat.textToolCalls.maxCallsPerMessage`

Use a config payload shaped like:

```ts
const res = validateConfigObject({
  models: {
    providers: {
      local: {
        baseUrl: "http://127.0.0.1:1234/v1",
        api: "openai-responses",
        models: [
          {
            id: "gpt-5.4",
            name: "GPT 5.4",
            compat: {
              textToolCalls: {
                enabled: true,
                formats: ["codex_commentary_v1"],
                requireKnownToolName: true,
                allowMixedText: true,
                maxCallsPerMessage: 4,
              },
            },
          },
        ],
      },
    },
  },
});
expect(res.ok).toBe(true);
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/config/config-misc.test.ts
```

Expected: FAIL because `textToolCalls` is not in the compat schema.

**Step 3: Write minimal config types and schema**

In `src/config/types.models.ts`, add:

```ts
export type TextToolCallFormat = "codex_commentary_v1";

export type TextToolCallCompatConfig = {
  enabled?: boolean;
  formats?: TextToolCallFormat[];
  requireKnownToolName?: boolean;
  allowMixedText?: boolean;
  maxCallsPerMessage?: number;
};
```

Then extend `ModelCompatConfig`:

```ts
textToolCalls?: TextToolCallCompatConfig;
```

In `src/config/zod-schema.core.ts`, add a strict schema for the new compat object and attach it under `ModelCompatSchema`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/config/config-misc.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
scripts/committer "Config: add text tool-call compat schema" src/config/types.models.ts src/config/zod-schema.core.ts src/config/config-misc.test.ts
```

### Task 2: Add Parser Module for Text Tool Calls

**Files:**

- Create: `src/agents/text-tool-call-compat.ts`
- Test: `src/agents/text-tool-call-compat.test.ts`

**Step 1: Write the failing parser tests**

Create `src/agents/text-tool-call-compat.test.ts` with cases for:

- extracts `to=exec ...` plus JSON args
- extracts `to=read ...` plus JSON args
- preserves surrounding natural-language text when `allowMixedText=true`
- rejects malformed JSON
- rejects unknown tool names when `requireKnownToolName=true`
- stops after `maxCallsPerMessage`
- does nothing when `enabled=false`

Model the parser return shape like:

```ts
{
  text: "Remaining visible text",
  toolCalls: [{ id: "compat_1", name: "exec", arguments: { command: "pwd" } }],
  diagnostics: [],
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Write minimal parser implementation**

Create `src/agents/text-tool-call-compat.ts` with:

- config and result types
- `parseTextToolCalls(...)`
- a strict format dispatcher
- initial `codex_commentary_v1` parser

Recommended API:

```ts
export function parseTextToolCalls(params: {
  text: string;
  compat?: TextToolCallCompatConfig;
  allowedToolNames?: Set<string>;
}): {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  diagnostics: Array<{ level: "debug"; reason: string; format?: string }>;
};
```

Implementation rules:

- only parse configured formats
- only accept exact `to=<tool>` prefix for `codex_commentary_v1`
- require JSON object arguments
- strip only the matched command block from the remaining text
- synthesize deterministic compatibility call IDs such as `compat_text_call_1`

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
scripts/committer "Agents: add text tool-call compat parser" src/agents/text-tool-call-compat.ts src/agents/text-tool-call-compat.test.ts
```

### Task 3: Wire Compat Parsing into OpenAI Responses Normalization

**Files:**

- Modify: `src/agents/openai-ws-stream.ts`
- Test: `src/agents/openai-ws-stream.test.ts`

**Step 1: Write the failing adapter tests**

Add tests to `src/agents/openai-ws-stream.test.ts` covering:

- compat disabled: pseudo-tool text stays as `text`
- compat enabled: pseudo-tool text becomes `toolCall`
- compat enabled with mixed text: visible text remains and `toolCall` is extracted
- native `function_call` response still behaves exactly as before

Use a fake response item like:

```ts
{
  type: "message",
  id: "msg_1",
  role: "assistant",
  content: [
    {
      type: "output_text",
      text: 'to=exec commentary code\n{"command":"pwd","yieldMs":1000}',
    },
  ],
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/agents/openai-ws-stream.test.ts
```

Expected: FAIL because `buildAssistantMessageFromResponse` has no compat parsing.

**Step 3: Implement minimal integration**

In `src/agents/openai-ws-stream.ts`:

- import the parser
- extend `buildAssistantMessageFromResponse(...)` to accept compat/allowed tool names
- after reading `output_text`, run compat parsing only when configured
- append parsed text blocks and parsed `toolCall` blocks into the existing content array
- keep current native `function_call` handling unchanged

Suggested signature change:

```ts
export function buildAssistantMessageFromResponse(
  response: ResponseObject,
  modelInfo: { api: string; provider: string; id: string; compat?: Record<string, unknown> },
  options?: { allowedToolNames?: Set<string> },
): AssistantMessage;
```

**Step 4: Thread allowed tool names through call sites**

Update the stream code path that calls `buildAssistantMessageFromResponse(...)` so it passes the current model compat config and the tool names already known to the stream request.

Do not introduce a second source of truth for tool names.

**Step 5: Run test to verify it passes**

Run:

```bash
pnpm test -- src/agents/openai-ws-stream.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
scripts/committer "Agents: normalize text tool calls in openai responses" src/agents/openai-ws-stream.ts src/agents/openai-ws-stream.test.ts
```

### Task 4: Make Compat Parsing Reusable for Future Adapters

**Files:**

- Modify: `src/agents/text-tool-call-compat.ts`
- Modify: `src/agents/openai-ws-stream.ts`
- Test: `src/agents/text-tool-call-compat.test.ts`

**Step 1: Write the failing abstraction tests**

Add parser tests for the reusable API shape:

- parser accepts arbitrary source text without knowing `openai-responses`
- parser can be called repeatedly without mutating input
- parser returns diagnostics even when no tool call is produced

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts
```

Expected: FAIL because the initial parser API will likely be too narrow.

**Step 3: Refine the parser surface**

Refactor `src/agents/text-tool-call-compat.ts` so it is provider-agnostic:

- no imports from `openai-ws-stream.ts`
- no OpenAI-specific response item assumptions
- all output shapes map cleanly into internal `toolCall` blocks

Add a small helper for adapter consumption, for example:

```ts
export function applyTextToolCallCompatToTextBlock(...)
```

Use that helper from `src/agents/openai-ws-stream.ts`.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test -- src/agents/text-tool-call-compat.test.ts src/agents/openai-ws-stream.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
scripts/committer "Agents: make text tool-call compat reusable" src/agents/text-tool-call-compat.ts src/agents/text-tool-call-compat.test.ts src/agents/openai-ws-stream.ts src/agents/openai-ws-stream.test.ts
```

### Task 5: Protect User-Facing Text and Existing Sanitizers

**Files:**

- Modify: `src/agents/pi-embedded-utils.test.ts`
- Modify: `src/shared/chat-content.test.ts`

**Step 1: Write the failing regression tests**

Add tests proving:

- leaked `to=exec ...` text is still stripped when it remains a text block
- normal assistant text extracted after compat conversion is preserved
- commentary-only pseudo-call text still does not surface to the user

**Step 2: Run test to verify it fails or exposes gaps**

Run:

```bash
pnpm test -- src/agents/pi-embedded-utils.test.ts src/shared/chat-content.test.ts
```

Expected: either FAIL or reveal missing regression coverage.

**Step 3: Adjust tests and minimal code only if needed**

If existing behavior already passes, do not change runtime code. Only keep the regression tests.

If a code change is needed, keep it minimal and limited to preserving the current sanitizer contract.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- src/agents/pi-embedded-utils.test.ts src/shared/chat-content.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
scripts/committer "Agents: add text tool-call sanitization regressions" src/agents/pi-embedded-utils.test.ts src/shared/chat-content.test.ts
```

### Task 6: Document the New Compat Option

**Files:**

- Modify: `src/config/schema.help.ts`
- Modify: `src/config/schema.labels.ts`
- Optionally Modify: `docs/gateway/configuration-reference.md`
- Test: `src/config/schema.help.quality.test.ts`

**Step 1: Write the failing help/label test if needed**

If the schema help quality tests require coverage for the new config path, add expectations for:

- `models.providers.*.models[].compat.textToolCalls`
- its child fields if the project documents them individually

**Step 2: Run tests to verify current failure mode**

Run:

```bash
pnpm test -- src/config/schema.help.quality.test.ts
```

Expected: FAIL if new schema fields require help/label coverage.

**Step 3: Add help text and labels**

Document that:

- the feature is off by default
- it should be enabled only for specific non-standard providers/models
- it normalizes text-form tool-call output into internal tool calls
- it does not bypass existing tool permissions

If documentation is updated, add one concise example config snippet.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test -- src/config/schema.help.quality.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
scripts/committer "Docs: describe text tool-call compat config" src/config/schema.help.ts src/config/schema.labels.ts src/config/schema.help.quality.test.ts docs/gateway/configuration-reference.md
```

### Task 7: Verify End-to-End Behavior

**Files:**

- No new source files expected

**Step 1: Run the focused test set**

Run:

```bash
pnpm test -- src/config/config-misc.test.ts src/agents/text-tool-call-compat.test.ts src/agents/openai-ws-stream.test.ts src/agents/pi-embedded-utils.test.ts src/shared/chat-content.test.ts
```

Expected: PASS

**Step 2: Run type/build verification**

Run:

```bash
pnpm build
```

Expected: PASS with no new dynamic import warnings.

**Step 3: Run lint/format verification**

Run:

```bash
pnpm check
```

Expected: PASS

**Step 4: Manual config smoke test**

Use a local config snippet with `compat.textToolCalls.enabled=true` for the failing provider/model and verify:

- a pseudo-call like `to=exec ...` becomes a real tool execution
- the same pseudo-call remains inert when compat is off

Record the exact transcript evidence in the PR or task notes.

**Step 5: Commit final verification-only follow-up if needed**

If verification required tiny doc/test-only fixes:

```bash
scripts/committer "Test: verify text tool-call compat rollout" <files>
```
