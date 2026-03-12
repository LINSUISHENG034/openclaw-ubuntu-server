# Text Tool-Call Compatibility Layer Design

**Goal:** Add a reusable, explicitly enabled compatibility layer that converts provider-specific text-form tool-call emissions into OpenClaw's internal structured `toolCall` blocks.

**Problem**

OpenClaw's embedded agent pipeline executes tools only when the model adapter returns structured tool-call blocks. In the failing deployment, the primary model understands that a tool should be used, but emits pseudo-tool text such as `to=exec ...` or fenced `tool` blocks instead of protocol-native `function_call` items. Today those strings are treated as leaked commentary and stripped from user-visible text, not executed.

**Constraints**

- Must be explicitly enabled per provider/model.
- Must not change behavior for standard providers/models by default.
- Must preserve the existing tool execution loop, approvals, allowlists, and tool-result handling.
- Must be reusable for future non-standard providers, not hardcoded to a single vendor.

**Recommended Approach**

Build a generic "text tool-call compatibility" layer at the model-adapter boundary. The layer parses known text protocols into internal `toolCall` blocks before the assistant message enters the rest of the agent loop. It is configured under model `compat`, remains off by default, and only activates for matching provider/model definitions.

## Architecture

### Placement

The compatibility layer should live between provider response parsing and internal `AssistantMessage` creation.

Why this boundary fits OpenClaw:

- The rest of the system already expects normalized assistant messages containing `text` and `toolCall` blocks.
- Tool execution, tool result pairing, approvals, transcript repair, and user-facing rendering are already built around structured tool calls.
- User-visible text sanitization currently strips these pseudo-tool strings, so parsing must happen before that layer.

### New Capability Surface

Add a new optional compat config under `models.providers.*.models[].compat`:

```ts
compat: {
  textToolCalls: {
    enabled: true,
    formats: ["codex_commentary_v1"],
    requireKnownToolName: true,
    allowMixedText: true,
    maxCallsPerMessage: 4,
  },
}
```

This keeps the feature scoped to individual model definitions and aligned with existing compat settings such as `supportsStore` and `supportsTools`.

### Parsing Contract

The compatibility layer should accept:

- assistant text content
- allowed tool names
- compat config for the current model

It should return:

- extracted `toolCall[]`
- preserved visible text
- parse diagnostics for debug logging and tests

The parser must be deterministic and strict:

- only known formats
- only exact tool names when `requireKnownToolName` is enabled
- only complete JSON argument payloads
- bounded extraction count via `maxCallsPerMessage`

If parsing fails, the original text remains text and no tool executes.

## Initial Supported Format

### `codex_commentary_v1`

This format covers the observed pseudo-calls:

- `to=exec commentary code\n{...}`
- `to=read ...\n{...}`
- fenced ```tool blocks containing a tool name and JSON payload

The parser should extract only the structured invocation segment and preserve any surrounding user-facing explanation text when `allowMixedText` is true.

## Data Flow

1. Provider adapter parses the upstream response as usual.
2. If the response already contains native tool-call items, keep current behavior.
3. If compat `textToolCalls.enabled` is on, run the text parser against assistant text blocks.
4. Convert matched pseudo-calls into internal `toolCall` blocks.
5. Keep remaining natural-language text as normal `text` blocks.
6. Continue through the existing tool loop unchanged.

## Safety Model

The compatibility layer must not become a second execution engine.

It should:

- normalize tool intent into existing `toolCall` blocks
- never execute directly
- never bypass current policy checks
- never infer missing arguments
- never guess tool names from prose

This preserves OpenClaw's existing security boundaries. Any extracted call still flows through the same permission model as native tool calls.

## Failure Handling

If a block looks similar to a supported format but fails strict parsing:

- do not emit a `toolCall`
- keep the text block intact
- emit a debug-level diagnostic with the format name and failure reason

This ensures non-standard or partially corrupted model output does not silently mutate into executable actions.

## Rollout Strategy

### Phase 1

- Add config schema and parser framework.
- Implement `codex_commentary_v1`.
- Wire the compatibility layer into `openai-responses` response parsing.

This directly addresses the current failing path while keeping the parser reusable.

### Phase 2

- Add shared helpers so other adapters can opt in with the same parser.
- Add more named formats only when real providers require them.

## Testing Strategy

### Unit Tests

- compat config validation accepts the new fields
- parser extracts single pseudo-calls
- parser extracts mixed text + pseudo-call
- parser rejects malformed JSON
- parser rejects unknown tool names when strict mode is on
- parser stops at `maxCallsPerMessage`

### Adapter Tests

- `openai-responses` native `function_call` behavior remains unchanged
- text pseudo-calls convert into internal `toolCall` blocks when compat is enabled
- the same text remains plain text when compat is disabled
- stop reason flips to `toolUse` when compatibility extraction succeeds

### Regression Tests

- user-visible sanitization still strips leaked pseudo-tool text when it survives as text
- no parsing occurs for providers/models without explicit compat enablement

## Trade-offs

### Benefits

- Fixes the current deployment failure without weakening the existing tool loop.
- Reuses current OpenClaw execution and policy architecture.
- Gives future non-standard providers a stable extension point.

### Costs

- Adds one more normalization stage to provider parsing.
- Requires strict format maintenance for each supported text protocol.
- Needs careful tests to avoid accidental parsing of plain prose.

## Non-Goals

- Global auto-detection across all models
- Prompt-only fixes as the primary mechanism
- Parsing arbitrary shell snippets from natural language
- Replacing native provider tool-call support where it already works
