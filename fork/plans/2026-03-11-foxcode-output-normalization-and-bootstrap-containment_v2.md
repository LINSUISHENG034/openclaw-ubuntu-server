# OpenClaw Foxcode Output Normalization and Bootstrap Containment

> Historical note: Foxcode is no longer an active provider in this fork. This plan is archived for context only.

## Status

Active final proposal.

Implementation update on 2026-03-11:

- shipped source-level bracket pseudo-call fixes:
  - `read.filePath` no longer emitted from bracket recovery; bracket `read` now emits `path`
  - `exec.cmd` no longer emitted from bracket recovery; bracket `exec` now emits `command`
- shipped Foxcode-scoped recovered-call normalization at the assistant-message boundary:
  - `read.filePath -> read.path`
  - `read.file_path -> read.path`
  - `exec.cmd -> exec.command`
  - duplicate `compat_text_call_*` ids are renumbered per assistant message
- shipped fresh-session bootstrap containment in Foxcode compat prompt assembly:
  - activates only for `foxcode-codex` + `openai-responses` + `compat.textToolCalls.enabled === true`
  - additionally requires a fresh session (no prior assistant message in context)
  - additionally requires an external messaging channel (for example Telegram/Discord/Signal), not `webchat`

Verification completed:

- targeted regression suite passed:
  - `src/agents/text-tool-call-compat.test.ts`
  - `src/agents/recovered-tool-call-normalization.test.ts`
  - `src/agents/pi-embedded-runner/run/attempt.test.ts`
  - `src/agents/openai-ws-stream.test.ts`
  - `src/shared/chat-content.text-tool-call-compat.test.ts`
  - `src/agents/pi-embedded-utils.text-tool-call-compat.test.ts`
- stable non-Foxcode spot check passed:
  - `src/agents/openai-ws-stream.test.ts`

Verification not completed:

- manual live `lab` bot verification was not run from this shell, so Telegram `/start` behavior and live Foxcode tool execution still need an operator-side check

Live verification update from this shell on 2026-03-11:

- initial `lab` Telegram-context validation was run via fresh `agent:lab:telegram:direct:*` session keys through Gateway RPC
- observed results on that first pass:
  - `/start` still returned bootstrap-dominant replies (`Hey. I just came online...`)
  - a concrete `read USER.md` task still produced an initial recovered `read` tool call with `filePath`, causing a real tool error (`Missing required parameter: path`) before a later retry used canonical `path`
  - a casual first-turn `Hi there.` message still produced a bootstrap/identity reply
- root-cause note for those first-pass live failures:
  - the running gateway process was executing `/mnt/sda1/github/openclaw/dist/index.js`
  - the source fixes in `src/` had not yet been rebuilt into `dist/`
  - those initial live results therefore reflected stale runtime output, not yet a verified post-build runtime
- next required verification step:
  - rebuild `dist`, restart the gateway, and rerun the same fresh-session `lab` Telegram-context cases before making final live pass/fail claims

Live verification follow-up after rebuilding `dist` and restarting the gateway:

- fresh `/start` case passed:
  - response no longer used the bootstrap greeting/identity questionnaire pattern
  - observed reply shape: direct “I’m here, what do you want to do first?” style response
- fresh concrete file/tool task passed:
  - no `filePath -> path` schema failure was observed after rebuild
  - the live reply correctly answered that `USER.md` does not specify a preferred name yet
- fresh casual first-turn chat passed:
  - no bootstrap onboarding reply
  - observed reply shape: short natural greeting (`Hey — good to see you. What can I help with?`)

Additional root-cause note from the second debugging round:

- even after the rebuilt runtime picked up recovered-call normalization, fresh-session bootstrap containment still initially failed
- the remaining root cause was prompt placement:
  - the Foxcode bootstrap-suppression instruction was injected before `# Project Context`
  - `BOOTSTRAP.md` content appeared later in the prompt and effectively overrode the earlier instruction in real model behavior
- fix shipped:
  - introduced a dedicated post-project-context bootstrap containment prompt
  - placed that override after injected workspace files so it can supersede `BOOTSTRAP.md` for fresh external sessions without removing bootstrap context entirely

Remaining known non-goals / unsolved cases in this patch:

- no broader provider-general normalization layer was added
- no additional alias tables were added beyond `read` and `exec`
- ambiguous recovered argument payloads still fail closed rather than guessing

This proposal inherits and narrows the design direction from:

- `fork/plans/2026-03-10-provider-normalization-design.md`
- `fork/plans/2026-03-11-foxcode-output-normalization-and-bootstrap-containment.md`

It intentionally drops the broader "provider normalization subsystem" framing and focuses only on the Foxcode failure modes that were reproduced in a real Telegram `lab` session on 2026-03-11.

## Summary

Foxcode is still failing in a way that justifies additional work, but the evidence now points to a narrower fix than the original proposal suggested.

The current failures are not "all providers produce arbitrary output shapes." They are:

1. Foxcode emits tool-call payloads that drift across incompatible argument aliases.
2. OpenClaw's current text-tool-call recovery path does not fully canonicalize those arguments before tool execution.
3. On fresh sessions, Foxcode can still let bootstrap content dominate the final reply even after tools have been called successfully.

The right next step is a scoped Foxcode-specific normalization pass plus a bounded fresh-session bootstrap containment policy. The goal is to fix the actual observed Foxcode path without prematurely introducing a large, provider-general subsystem.

## Why This Proposal Exists

The earlier proposal was directionally useful, but it bundled several distinct concerns:

- text pseudo-tool parsing
- tool argument canonicalization
- user-visible suppression
- provider prompt constraints
- generic bootstrap suppression
- a broader provider-normalization architecture

After reviewing the latest `lab` session, that scope is too broad for the available evidence.

What we now know with high confidence is:

- the active failing provider is `foxcode-codex`
- the active transport is `openai-responses`
- the failure reproduced on the HTTP path used by embedded runs
- the highest-value fixes are argument canonicalization, stable synthetic tool-call ids, and bootstrap containment on fresh sessions

That is enough to justify a narrower follow-up proposal.

## Observed Evidence

Source: `lab` Telegram session `879bdddf-41cd-42f6-91b7-eddb7801df6a` on 2026-03-11.

### Observation 1: Foxcode is the active failing provider

The session explicitly records:

- provider: `foxcode-codex`
- model API: `openai-responses`
- model id: `gpt-5.4`

So this is not a generic transport-agnostic problem. It is a Foxcode-specific failure in the current `openai-responses` embedded path.

### Observation 2: Argument alias drift is still breaking tool execution

The first recovered assistant message contains multiple synthetic `read` tool calls using:

```json
{ "filePath": "/home/lin/.openclaw/workspace-lab/SOUL.md" }
```

Those calls all fail with:

`Missing required parameter: path (path or file_path).`

A later assistant message drifts to:

```json
{ "path": "/home/lin/.openclaw/workspace-lab/SOUL.md" }
```

and those reads succeed.

This confirms that protocol translation alone is insufficient. Foxcode output recovery must canonicalize arguments into the shapes OpenClaw tools actually accept.

**Code-level note:** The current `buildBracketPseudoToolArgs` helper in `text-tool-call-compat.ts` itself hardcodes the incorrect aliases (`filePath` for `read`, `cmd` for `exec`). This means the bracket pseudo-tool recovery path is actively producing arguments that do not match OpenClaw tool contracts. This is a pre-existing bug that should be fixed at the source as part of this work, not just papered over by a downstream normalization layer.

### Observation 3: Synthetic tool-call ids are reused across multiple recovered calls

The same recovered assistant message emits multiple `toolCall` blocks with the same synthetic id:

- `compat_text_call_1`

That id is then reused across multiple `toolResult` entries.

Even when the runtime tolerates this, it is not a defensible canonical form. Synthetic ids generated during text-tool-call recovery must be unique across the full normalized assistant message, not just within a single text block transform.

**Code-level note:** The existing `normalizeToolCallIdsInMessage` function in `attempt.ts` already provides a post-hoc fallback that assigns `call_auto_N` ids to empty or duplicate entries. This means duplicate ids are partially tolerated at runtime, but fixing id generation at the source (`text-tool-call-compat.ts`) is still the correct approach — relying on a downstream fallback for a known upstream bug is not a defensible design.

### Observation 4: Bootstrap still dominates the final answer

After some `read` calls succeed, the final assistant reply is still bootstrap-shaped:

`Hey. I just came online.`

That behavior is traceable to `BOOTSTRAP.md`, which was successfully read during the same session.

This means the failure is no longer only "Foxcode failed to call tools." The provider can now call tools, but on a fresh session it still over-indexes on bootstrap/persona initialization instead of producing the most context-appropriate channel reply.

## Scope

### Goals

- Fix the currently reproduced Foxcode failures on the embedded `openai-responses` path.
- Canonicalize recovered Foxcode tool arguments before execution.
- Guarantee unique synthetic tool-call ids after recovery.
- Reduce Foxcode drift with provider-specific prompt constraints.
- Contain bootstrap dominance on fresh external-channel sessions.

### Non-Goals

- Build a provider-general normalization subsystem.
- Infer tool intent from arbitrary natural-language prose.
- Rewrite transcript repair into a broad parsing layer.
- Add a generic classifier for every first-turn message shape across all providers.
- Change behavior for providers that already behave correctly, such as the current MiniMax path.

## Recommended Design

### 1. Keep recovery scoped to compat-enabled Foxcode paths

Continue using `model.compat` as the activation boundary.

For now, the new behavior should only apply when all of the following are true:

- provider is `foxcode-codex`
- model API is `openai-responses`
- compat explicitly enables text-tool-call recovery

This keeps the fix opt-in and prevents a Foxcode workaround from quietly reshaping stable providers.

### 2. Introduce a single Foxcode output normalization helper at the shared assistant-message boundary

Instead of scattering more Foxcode logic across transport-specific wrappers, create one shared helper that runs on the normalized assistant message before execution.

This helper should own:

- text pseudo-tool-call recovery
- synthetic tool-call id assignment
- tool argument canonicalization
- stop-reason correction when tool calls are recovered

The current embedded HTTP path is the priority target. The WebSocket path can reuse the same helper if needed, but the design should be driven by the path that actually failed.

### 3. Add bounded tool-aware argument canonicalization

Canonicalization should be explicit, tool-aware, and small.

The fix has two layers:

**Layer 1: Fix the source.** The current `buildBracketPseudoToolArgs` in `text-tool-call-compat.ts` hardcodes the wrong aliases (`filePath` for `read`, `cmd` for `exec`). Fix this function to emit correct field names (`path`, `command`) directly. This eliminates the most common alias drift at the source rather than manufacturing incorrect arguments and then correcting them downstream.

**Layer 2: Add a downstream canonicalization pass.** Even after fixing `buildBracketPseudoToolArgs`, Foxcode free-form text output may still drift to non-canonical aliases via the `to=` and JSON pseudo-tool formats. Add a small alias table to normalize these before tool dispatch.

Starting alias table (confirmed mismatches only):

- `read`
  - `filePath -> path`
  - `file_path -> path`
- `exec`
  - `cmd -> command`

Rules:

- only transform known aliases for known tools
- do not guess when multiple conflicting fields are present (e.g. if both `filePath` and `path` are present, do not transform — fail to validation)
- preserve validation errors when canonicalization still cannot produce a valid input

This should be implemented as a dedicated helper, not buried inside regex parsing.

### 4. Assign synthetic tool-call ids after the full message is normalized

The current repeated `compat_text_call_1` ids strongly suggest numbering is happening at the wrong granularity.

Synthetic ids should be assigned after the full assistant message has been flattened into canonical content, so a message with multiple recovered calls becomes:

- `compat_text_call_1`
- `compat_text_call_2`
- `compat_text_call_3`

not multiple copies of `compat_text_call_1`.

This is a source-correctness requirement. The existing `normalizeToolCallIdsInMessage` fallback in `attempt.ts` already prevents runtime breakage from duplicate ids by assigning `call_auto_N` fallback ids, but the correct fix is to generate unique ids at the source in `text-tool-call-compat.ts` so the fallback path is never triggered for this case. The fallback should remain as a safety net, not as the primary dedup mechanism.

### 5. Keep provider prompt constraints, but make them explicitly Foxcode-specific

The existing Foxcode-specific prompt addition is the right direction, but it should be treated as part of the scoped Foxcode fix rather than as evidence for a global provider prompt framework.

The prompt constraints should continue to tell Foxcode:

- when a tool is needed, emit a parseable tool request immediately
- use only supported pseudo-tool-call forms
- avoid narrating intent before the tool call
- avoid unsupported bracket summaries

This is not sufficient on its own, but it reduces drift and lowers the amount of recovery the runtime must do.

### 6. Add fresh-session bootstrap containment for Foxcode external-channel turns

The latest session shows that bootstrap dominance is still a live problem even after some reads succeed.

The containment policy should be intentionally narrow:

- apply only to compat-enabled Foxcode runs
- apply only on fresh sessions
- apply only on external messaging surfaces, not generic local/web bootstrap flows

The behavior should be:

- `BOOTSTRAP.md` may remain available as background context
- but it must not dominate the final answer when the inbound message is already a real external user turn

This should be implemented as prompt orchestration, not parser logic.

The first version should not attempt a generic "task classifier." A narrow Foxcode fresh-session containment rule is enough for the reproduced issue.

**Recommended trigger condition (triple gate):**

Bootstrap containment activates only when **all three** of the following are true:

1. **isFoxcodeCompat**: provider is `foxcode-codex` AND `compat.textToolCalls.enabled === true`
2. **isFreshSession**: session history is empty (no prior assistant messages in context)
3. **isExternalChannel**: `messageChannel` resolves to an external messaging surface (telegram, signal, discord, slack, whatsapp, etc.) — not `local`, `web`, or subagent/cron sessions

The existing `resolvePromptModeForSession` (`"minimal"` for subagent/cron, `"full"` otherwise) and `normalizeMessageChannel` helpers can be reused to determine condition 3. The fresh-session check can be derived from the session message count passed into the prompt assembly stage.

When containment is active, `buildFoxcodeCompatExtraSystemPrompt` should append an additional instruction:

> "This is your first turn on an external messaging channel. The user has sent you a real message. Respond to their message directly. Do not output a bootstrap greeting or persona initialization message as your primary reply."

## Alternatives Considered

### A. Keep the original broad provider-normalization proposal

Pros:

- conceptually unified
- future-facing

Cons:

- too broad for the current evidence
- risks overbuilding around a single provider's failure mode
- mixes Foxcode-specific fixes with speculative general architecture

### B. Apply more regex patches only

Pros:

- small immediate change

Cons:

- does not solve argument canonicalization cleanly
- does not solve synthetic id reuse
- does not solve bootstrap dominance

### C. Scoped Foxcode follow-up with reusable seams

Pros:

- directly matches the reproduced failures
- small enough to implement and verify quickly
- still leaves reusable seams if future providers prove similar

Cons:

- less ambitious than the original proposal

Recommendation: choose C.

## Implementation Outline

### Phase 1: Fix source-level alias and id bugs

- fix `buildBracketPseudoToolArgs` in `text-tool-call-compat.ts` to emit correct field names (`path` instead of `filePath`, `command` instead of `cmd`)
- fix synthetic id generation so ids stay unique after compat is applied across all text blocks in one assistant message (the current pipeline applies `applyTextToolCallCompatToTextBlock` per text block, so `compat_text_call_1` can be reintroduced for each block even when individual parser passes are locally consistent)
- update existing test expectations in `text-tool-call-compat.test.ts`
- keep current `textToolCalls` compat gating

### Phase 2: Downstream argument canonicalization

- add a small alias table for remaining Foxcode free-form mismatches (covering `to=` and JSON pseudo-tool formats)
- route recovered Foxcode assistant content through the normalization helper after `applyTextToolCallCompatToAssistantMessage`
- add ambiguity guard: if both canonical and alias fields are present, skip normalization and let validation fail naturally
- add regression tests covering: `filePath -> path`, `cmd -> command`, ambiguous input (both fields present), and non-Foxcode passthrough

### Phase 3: Fresh-session bootstrap containment

- extend `buildFoxcodeCompatExtraSystemPrompt` to accept session context (message count, channel)
- add the triple-gate containment condition: isFoxcodeCompat AND isFreshSession AND isExternalChannel
- when active, append bootstrap-suppression instruction to the Foxcode compat prompt
- do not remove `BOOTSTRAP.md` from context — only demote its conversational priority via prompt instruction
- verify that `/start` on Telegram no longer produces the generic bootstrap greeting
- add negative test: local/web bootstrap flow still works normally with bootstrap emphasis intact

## Testing Strategy

### Regression fixtures

Use the captured `lab` session as the primary regression source.

Required fixture coverage:

- recovered `read` call with `filePath`
- recovered `read` call with `path`
- multiple recovered calls in one assistant message
- bootstrap-shaped final answer after successful reads

### Unit tests

- unique synthetic id generation across a multi-call recovered message
- tool-aware argument canonicalization
- stop-reason correction after recovery

### Integration tests

- embedded HTTP `openai-responses` path with Foxcode compat enabled
- fresh-session Telegram-style turn with bootstrap files present

### Live verification

For Foxcode only:

- confirm recovered `read` calls execute without schema mismatch
- confirm multiple recovered calls get distinct ids
- confirm final answer is no longer dominated by bootstrap text for a fresh Telegram `/start` turn

## Additional Validation Required Before Implementation

The proposal is implementation-worthy now, but a few targeted validations should be completed before code changes begin. These validations are meant to lock scope and prevent the fix from spreading into a broader speculative refactor.

### 1. Validate the full Foxcode alias surface

We currently have direct evidence for:

- `read.filePath -> read.path`
- likely `exec.cmd -> exec.command`

Before implementation, inspect recent Foxcode transcripts and current tool definitions to confirm whether Foxcode also drifts on:

- `write`
- `edit`
- `apply_patch`
- any messaging tools

This matters because the alias table should be intentionally small. The implementation should include only aliases that are confirmed either by transcript evidence or by existing known provider compatibility behavior.

Deliverable:

- a short confirmed alias matrix in the proposal or implementation plan
- explicit statement of which aliases are in scope for the first patch

### 2. Validate downstream sensitivity to synthetic id reuse

The current session shows repeated `compat_text_call_1`, but implementation should not rely on "this looks wrong."

**Existing mitigation (confirmed):** `normalizeToolCallIdsInMessage` in `attempt.ts` (L302-354) already runs as a post-processing step on assistant messages. It assigns `call_auto_N` fallback ids to any duplicate or empty ids. This means runtime breakage from duplicate ids is unlikely in practice — the fix at the source is primarily a correctness invariant improvement.

Before code changes, still verify how repeated synthetic ids affect:

- tool-result pairing (likely tolerated due to the existing fallback)
- transcript repair
- history replay / sanitization
- any guards that assume unique tool-call ids

The implementation should fix id generation at the source so the fallback is not relied upon, but priority is **lower** than alias canonicalization and bootstrap containment.

Deliverable:

- one short note identifying the impacted downstream components
- one regression test that would fail under duplicate ids if the invariant matters behaviorally

### 3. Validate bootstrap containment trigger boundaries

The current evidence covers a fresh Telegram `/start` turn. That is enough to justify a containment rule, but not enough to finalize its exact activation boundary.

Before implementation, validate three scenarios:

1. fresh Telegram `/start` or equivalent onboarding-like turn → containment should activate
2. fresh Telegram concrete task request → containment should activate
3. normal onboarding / local bootstrap flow where bootstrap behavior is still desirable → containment must NOT activate

The implementation should only suppress bootstrap dominance in the first two when Foxcode is acting on an already real external channel turn, not in the third case.

**Recommended validation approach:**

- Use `resolvePromptModeForSession` to distinguish subagent/cron sessions (which return `"minimal"`) from normal sessions. The containment rule should only apply to `"full"` mode sessions.
- Use `normalizeMessageChannel` to resolve the channel. External channels (telegram, signal, discord, slack, etc.) trigger containment; `local`, `web`, and undefined channels do not.
- Check session message count: if the context passed to prompt assembly contains zero prior assistant messages, the session is fresh.

Deliverable:

- explicit trigger rule in the implementation plan (use the triple-gate condition defined in Design section 6)
- at least one negative test proving intended onboarding still works
- at least one negative test proving local/web sessions are unaffected

### 4. Validate non-Foxcode non-regression paths

Because the proposed fix lives near a shared assistant-message boundary, implementation must prove it does not change:

- MiniMax current working path
- providers with native structured tool calls
- OpenAI native `openai-responses` provider behavior when Foxcode compat is not enabled

Deliverable:

- a minimal non-regression matrix in the implementation plan
- tests or spot checks for one stable non-Foxcode provider

## Architecture Decisions To Lock Before Coding

The proposal should also explicitly lock a few design decisions so implementation does not drift back into piecemeal patches.

### Decision 1: Normalize at the shared assistant-message boundary

This fix should happen after assistant content has been assembled into the shared message shape, not inside provider-specific streaming event parsing and not inside individual tool implementations.

Reason:

- Foxcode failure was already mispatched once at the wrong transport boundary
- text recovery, id assignment, argument canonicalization, and stop-reason correction all operate on the same semantic object: the assistant message
- moving these steps deeper into parser code or tool wrappers would re-fragment the behavior

Implementation consequence:

- one shared Foxcode normalization helper should own the full canonicalization pass for recovered assistant content

### Decision 2: Keep argument canonicalization tool-aware, not provider-general

Argument canonicalization is not the same concern as provider output parsing.

Reason:

- the provider may emit semantically correct intent with wrong field names
- the authoritative shape is defined by OpenClaw tool contracts, not by the provider
- this logic should stay bounded and explicit rather than turning into "accept anything vaguely similar"

Implementation consequence:

- use a small helper keyed by canonical tool name
- apply only known alias maps
- fail closed on ambiguity

### Decision 3: Keep bootstrap containment in prompt orchestration

Bootstrap containment should not be implemented in transcript repair, text-tool parsing, or output sanitization.

Reason:

- bootstrap dominance is not malformed output
- it is a prompt-priority / session-stage problem
- solving it later in the pipeline would be brittle and harder to reason about

Implementation consequence:

- gate bootstrap emphasis earlier, during prompt assembly for compat-enabled Foxcode fresh-session external turns

### Decision 4: Keep the first patch Foxcode-specific

Do not generalize the implementation into a broader provider framework during the first patch.

Reason:

- current evidence is Foxcode-only
- MiniMax is currently a working escape path
- a narrow fix has a better chance of landing safely and being verified thoroughly

Implementation consequence:

- require explicit compat activation
- avoid introducing new generic schema/config surface unless the patch truly needs it

## Implementation Readiness Checklist

This proposal is ready to move into implementation once the following are written down and verified:

- confirmed first-patch alias table
- chosen normalization boundary and helper ownership
- chosen bootstrap containment trigger rule
- one non-Foxcode regression check path
- one duplicate-id regression test target

If any of these remain undefined, implementation is likely to drift into another round of issue-driven patching rather than a coherent fix.

## Risks

### Risk: Foxcode-specific logic becomes permanent cruft

Mitigation:

- keep all behavior behind compat gating
- isolate it in one helper with explicit Foxcode activation

### Risk: bootstrap containment breaks intended onboarding

Mitigation:

- scope it to Foxcode
- scope it to fresh external-channel sessions
- do not remove bootstrap context entirely

### Risk: alias canonicalization masks real tool errors

Mitigation:

- only normalize explicit known aliases
- preserve validation failures for everything else

## Recommendation

Do not continue with the original broad provider-normalization proposal as the active implementation target.

Instead:

- treat `fork/plans/2026-03-10-provider-normalization-design.md` as background context
- implement a narrower Foxcode-specific follow-up
- solve the three reproduced issues first:
  - argument canonicalization
  - unique synthetic ids
  - fresh-session bootstrap containment

If future providers reproduce the same failure pattern, the Foxcode helper can then be generalized with real evidence instead of speculation.
