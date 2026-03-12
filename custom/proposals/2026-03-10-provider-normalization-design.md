# OpenClaw Provider Normalization Design

> Note (2026-03-11): This document is now background context rather than the active implementation target.
>
> Active follow-up:
> `custom/proposals/2026-03-11-foxcode-output-normalization-and-bootstrap-containment_v2.md`
>
> That newer proposal inherits the useful parts of this design, but deliberately narrows scope to the Foxcode-specific failures reproduced in the `lab` Telegram session. In particular, it keeps the emphasis on bounded text-tool-call recovery, argument canonicalization, and bootstrap containment, while dropping the broader claim that OpenClaw should immediately build a provider-general normalization subsystem.

## Summary

OpenClaw already contains multiple compatibility and transcript-repair mechanisms for handling provider-specific quirks, but recent Foxcode debugging showed that the current approach is still too fragmented. Different providers, transports, and model families can produce semantically identical intentions through materially different output shapes:

- native structured tool calls
- provider-specific structured variants
- text-form pseudo tool calls
- malformed or partially structured tool calls
- natural-language intent statements that imply a tool should have been called

The current system can absorb some of these differences, but it does so across several disconnected layers. That makes behavior difficult to reason about, encourages issue-driven patching, and increases the chance that a fix lands at the wrong boundary, as happened when the first Foxcode compatibility change was added to the WebSocket normalization path even though Foxcode was actually running through the HTTP `streamSimple` path.

This proposal defines a general provider-normalization design for OpenClaw. The goal is not to predict every future model response exactly. The goal is to provide a single, layered normalization pipeline that converts provider-specific response behavior into OpenClaw’s canonical internal execution model with bounded, explicit, testable rules.

## Goals

- Provide a stable, general normalization architecture for provider outputs.
- Reduce issue-driven one-off compatibility patches.
- Preserve OpenClaw’s existing canonical execution model:
  - assistant messages with canonical `toolCall` blocks
  - canonical tool argument shapes
  - canonical tool-result pairing
  - channel-safe user-visible text
- Make provider-specific behavior explicit in config and code.
- Keep compatibility bounded. OpenClaw should support a defined set of known pseudo-protocols and argument aliases, not arbitrary free-form model behavior.

## Non-Goals

- Guarantee 100% conversion of all possible model outputs into valid tool calls.
- Build a heuristic system that infers tool intent from arbitrary natural-language reasoning.
- Replace native provider adapters when they already emit canonical tool calls.
- Hide all model misbehavior. Some failures should remain visible as unsupported provider behavior rather than being silently guessed around.

## Problem Statement

Recent Foxcode behavior exposed four classes of incompatibility that are likely to recur with other non-standard providers:

1. Transport-bound normalization

The first compatibility implementation was attached to the OpenAI Responses WebSocket normalization path. Foxcode was configured as `openai-responses`, but it did not use the WebSocket path because that path is reserved for provider `openai`. The result was correct logic at the wrong boundary.

2. Protocol drift

Foxcode emitted multiple pseudo tool-call formats over time:

- `to=exec ...`
- `to=exec {"..."}`
- `{"tool":"read","args":{...}}`
- `[Tool call: read \`...\`]`

This is the clearest sign that text-form tool-call compatibility is a provider-normalization concern, not a single regex concern.

3. Argument alias drift

Even after pseudo calls were translated into internal `toolCall` blocks, execution still failed because the translated arguments did not match OpenClaw’s canonical tool schemas:

- `exec` received `cmd` instead of `command`
- `read` received `path` instead of `filePath`

This means protocol translation alone is insufficient. A normalization layer must also canonicalize arguments.

4. User-visible leakage

In some QQ runs, internal pseudo-call text still leaked to the user even while internal tool-call translation partially succeeded. This proves that “internal tool-call recovery” and “user-visible text suppression” must be treated as separate, explicit concerns.

5. Bootstrap interference

In some Telegram runs, Foxcode triggered real internal tool calls but still delivered an irrelevant final answer because the new-session bootstrap flow (`SOUL.md`, `USER.md`, `BOOTSTRAP.md`) dominated the interaction. That is not a parser problem; it is a higher-level normalization and prompt-routing problem.

## Current OpenClaw Normalization Layers

OpenClaw already has the beginnings of the right architecture.

### 1. Model compatibility metadata

Files:

- `src/config/types.models.ts`
- `src/config/zod-schema.core.ts`

OpenClaw already models provider quirks with `compat` fields such as:

- `supportsStore`
- `supportsTools`
- `requiresToolResultName`
- `requiresAssistantAfterToolResult`
- `requiresThinkingAsText`
- `requiresOpenAiAnthropicToolPayload`

This is the correct place to declare provider-level normalization requirements.

### 2. Provider and transport wrappers

Files:

- `src/agents/pi-embedded-runner/openai-stream-wrappers.ts`
- `src/agents/pi-embedded-runner/anthropic-stream-wrappers.ts`
- `src/agents/pi-embedded-runner/extra-params.ts`

These wrappers already normalize request payloads and provider quirks before inference.

### 3. Stream/output normalization

Files:

- `src/agents/openai-ws-stream.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`

These files normalize provider outputs into OpenClaw assistant messages and already host stream-level canonicalization such as tool-call name cleanup and argument cleanup for specific providers.

### 4. Transcript repair and guardrails

Files:

- `src/agents/session-transcript-repair.ts`
- `src/agents/session-tool-result-guard.ts`
- `src/agents/session-tool-result-guard-wrapper.ts`

These layers repair or constrain inconsistent assistant/tool transcripts after generation.

### 5. User-visible sanitization

Files:

- `src/agents/pi-embedded-utils.ts`
- `src/shared/chat-content.ts`

These suppress internal protocol text from leaking into user-visible channel output.

The core architectural insight is that OpenClaw already has the correct categories. The problem is that text-form tool-call compatibility is not yet treated as a first-class concern across all of them.

## Design Principles

### Bounded compatibility

OpenClaw should support a small, named set of pseudo tool-call protocols, each with explicit parsing rules. It should not attempt to infer tool intent from arbitrary prose like “I will now inspect the host” or “let me check that for you.”

### Canonical internal form

Everything downstream of normalization should operate only on canonical OpenClaw forms:

- `toolCall` blocks
- canonical tool names
- canonical argument names and shapes
- valid tool-result pairing

### Shared normalization boundaries

A compatibility fix should be attached to the narrowest shared boundary that all relevant code paths actually use. If a provider can use both WebSocket and HTTP transports, the normalization design should make that explicit and reusable rather than duplicating logic.

### Separate “internal recovery” from “user-visible suppression”

A provider output can fail internal canonicalization and still need to be hidden from user-facing text. These concerns must remain independent.

### Prefer explicit provider constraints over parser growth

When a provider repeatedly drifts across output protocols, the system should not only extend the parser. It should also constrain the model prompt so the provider is asked to emit one of a small number of supported formats.

## Proposed Architecture

### Layer A: Provider Compat Profile

Extend model compatibility metadata so each provider/model can declare:

- whether text-form tool-call compatibility is enabled
- which named pseudo-protocol formats are accepted
- whether argument alias canonicalization is enabled
- whether stricter provider-specific tool protocol instructions should be injected
- whether bootstrap-first behavior should be suppressed when the first user turn is a concrete task request

This should continue to live under `model.compat`.

Example conceptual structure:

```ts
type ModelCompatConfig = {
  ...
  textToolCalls?: {
    enabled?: boolean;
    formats?: TextToolCallFormat[];
    requireKnownToolName?: boolean;
    allowMixedText?: boolean;
    maxCallsPerMessage?: number;
  };
  toolArgumentAliases?: {
    enabled?: boolean;
  };
  providerPromptConstraints?: {
    enforceToolProtocol?: boolean;
    suppressBootstrapForConcreteTask?: boolean;
  };
};
```

The exact schema can remain minimal at first; the key is to keep provider behavior declarative.

### Layer B: Provider Output Normalization

Create a formal normalization stage that runs after provider output is received, regardless of transport, and before the result is handed to execution or user-visible projection.

Inputs:

- raw assistant message content
- model/provider identity
- compat metadata
- allowed tool names

Outputs:

- canonical assistant message content
- normalization diagnostics

This stage should own:

- text-form pseudo tool-call translation
- tool argument alias canonicalization
- tool-call stop reason correction

This normalization stage should be shared across:

- WebSocket `openai-responses` path
- HTTP `openai-responses` path
- any future adapters with similar pseudo tool behavior

### Layer C: Text Tool-Call Protocol Translation

Promote `src/agents/text-tool-call-compat.ts` from a narrow parser into a small protocol registry.

Each format should be a named protocol with explicit rules. For example:

- `codex_commentary_v1`
  - `to=<tool>\n{json}`
  - `to=<tool> {json}`
  - `{"tool":"<tool>","args":{...}}`
  - `[Tool call: read \`...\`]` for known limited tool shapes

Important constraint:

- each supported form must be explicitly documented and tested
- unsupported forms must fail closed
- natural-language intent remains unsupported

### Layer D: Argument Canonicalization

After a pseudo tool call is translated into a canonical `toolCall`, run a canonicalization pass on the arguments before execution.

This should be tool-aware, not provider-aware.

Examples:

- `exec`
  - `cmd -> command`
- `read`
  - `path -> filePath`

This layer should be explicit and bounded:

- only apply alias maps for known tools
- do not guess between ambiguous fields
- preserve validation errors when canonicalization still cannot produce a valid schema

This is the main reason the latest QQ flow partially worked but still emitted execution-time validation failures.

### Layer E: Transcript Repair and Execution Guard

Existing transcript repair/guard logic should remain the place that enforces canonical transcript invariants, including:

- valid tool names
- valid tool ids
- missing tool-result synthesis where policy allows it
- repair after truncation or history rewriting

This layer should not be responsible for parsing arbitrary provider pseudo-protocols. It should only deal with already-translated canonical structures.

### Layer F: User-Visible Sanitization

User-visible sanitization must suppress every supported pseudo tool-call protocol, even when internal translation fails or is bypassed.

The same protocol registry used for translation should be reusable by the sanitization layer so OpenClaw does not maintain two unrelated definitions of “internal protocol text.”

That means user-visible suppression should be protocol-driven, not a separate pile of ad hoc regexes.

### Layer G: Provider Prompt Constraints

When a provider repeatedly drifts across tool-call formats, the correct response is not endless parser growth.

OpenClaw should inject provider-specific tool protocol constraints when compat is enabled for that provider/model:

- If a tool is required, emit one of the supported pseudo tool-call formats only.
- Do not narrate intent before the tool request.
- Do not emit bracket summaries unless the bracket format is explicitly supported.
- Do not emit `NO_REPLY` when a tool call is required.

This should be an additive provider-specific prompt section, not a global system prompt rewrite.

Foxcode is the immediate case, but the mechanism should be reusable.

### Layer H: Bootstrap Suppression for Concrete First-Turn Tasks

When a conversation begins with a concrete operational request, bootstrap/persona initialization should not dominate the response.

OpenClaw should recognize “concrete first-turn task” conditions such as:

- imperative or explicit operational requests
- requests containing concrete command or device ids
- requests clearly asking for a real-world action on the current host

In such cases:

- bootstrap files may remain available as context
- but bootstrap-first conversational behavior should be suppressed

This should not be solved in the parser. It belongs in prompt orchestration / first-turn policy.

## Concrete Extension Points in the Current Codebase

### Keep and extend

- `src/agents/text-tool-call-compat.ts`
  - becomes the protocol registry and translation layer
- `src/agents/openai-ws-stream.ts`
  - continues to call the shared normalization helper
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - continues to wrap HTTP `streamSimple` output using the shared helper

### Add or formalize

- canonical tool argument alias table
  - likely a new helper near tool schema / tool policy code
- shared protocol-aware sanitization helper
  - reused by `pi-embedded-utils.ts` and `chat-content.ts`
- provider-specific prompt constraint helper
  - likely assembled inside `run/attempt.ts` before `buildEmbeddedSystemPrompt`
- bootstrap suppression policy
  - likely in prompt-building or first-turn routing, not in provider adapters

## Why This Is Better Than Regex-Driven Patching

### Narrow protocol registry only

This would improve parser quality, but it still leaves argument alias drift, output leakage, and bootstrap interference as separate recurring issues.

### Provider rewrite per model family

This would overfit the current problem and duplicate the work already being done by compat metadata, stream wrappers, and transcript repair.

### Layered normalization architecture

This keeps the system aligned with how OpenClaw already works:

- compat metadata declares differences
- transport/output normalization canonicalizes them
- transcript guard enforces invariants
- user-visible sanitization protects channels
- prompt constraints reduce drift

This is the smallest general solution that matches the real failure modes.

## Migration Plan

### Phase 1: Formalize protocol translation

- keep `textToolCalls` under `model.compat`
- convert the parser into an explicit protocol registry
- move all current Foxcode-compatible text forms under a named protocol family

### Phase 2: Add argument canonicalization

- add tool-specific alias normalization for the most common mismatches
- run canonicalization before tool execution
- add tests around schema-valid canonical forms

### Phase 3: Unify user-visible suppression

- have sanitization reuse the same protocol definitions
- suppress all supported pseudo protocols from user-visible output

### Phase 4: Add provider prompt constraints

- add opt-in provider-specific tool protocol guidance
- start with Foxcode
- verify reduction in output drift before extending elsewhere

### Phase 5: Suppress bootstrap on concrete first-turn tasks

- add a small first-turn task classifier
- use it to bypass bootstrap-first conversational behavior for operational requests

## Testing Strategy

### Unit tests

- parser tests for every supported pseudo protocol form
- argument alias canonicalization tests
- user-visible suppression tests per protocol form
- provider prompt constraint tests

### Adapter tests

- WebSocket `openai-responses` path
- HTTP `openai-responses` path
- transcript repair remains stable after normalized tool calls

### Transcript-based regression tests

Use captured session transcript snippets from real failures as regression fixtures:

- Foxcode `to=<tool>` form
- Foxcode JSON pseudo-call form
- Foxcode bracket pseudo-call form
- mixed commentary/final-answer cases
- malformed pseudo-call cases

### Live verification

For verified provider/model pairs only:

- confirm internal `toolCall` exists
- confirm `toolResult` exists
- confirm no pseudo-call text leaks to user-visible channels
- confirm final answer remains task-relevant

## Rollout and Risk Control

### Risk: over-parsing user-facing text

Mitigation:

- compat is opt-in per model
- only named formats are parsed
- only known tool names are accepted by default
- mixed-text behavior remains configurable

### Risk: alias canonicalization changes tool semantics

Mitigation:

- canonicalize only known aliases for known tools
- keep mappings explicit and narrowly scoped
- preserve validation errors for ambiguous payloads

### Risk: provider-specific prompts degrade good providers

Mitigation:

- inject provider constraints only when compat explicitly enables them
- avoid global prompt pollution

### Risk: bootstrap suppression harms intentional onboarding

Mitigation:

- suppress bootstrap only when the first user turn is a concrete task request
- leave normal fresh-session onboarding unchanged

## Recommendation

OpenClaw should continue building on its existing compatibility model, but it should treat provider normalization as a formal subsystem rather than a growing pile of special cases.

The right strategy is not:

- “keep adding regexes until every output shape works”

The right strategy is:

- declare provider quirks in compat metadata
- normalize provider output at shared transport boundaries
- translate only named pseudo protocols
- canonicalize tool arguments before execution
- repair transcript invariants after normalization
- suppress protocol leakage from user-visible output
- constrain known-drifting providers with provider-specific prompt instructions

Foxcode is the current motivating example, but the architecture should be general, explicit, bounded, and reusable for any future non-standard provider that approximates tool calling without natively implementing OpenClaw’s canonical internal structure.
