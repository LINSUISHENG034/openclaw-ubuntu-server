# Merge Upstream Main on 2026-03-12

Date: 2026-03-12

## Goal

Record what happened while merging `upstream/main` into the local `main` branch after the Foxcode leak fixes had already been landed locally.

This merge mattered because the upstream repository had moved far enough that the same files were being actively edited on both sides:

- `src/agents/openai-ws-stream.ts`
- `src/agents/pi-embedded-runner/run/attempt.test.ts`
- Telegram preview/dispatch code
- Responses/compat plumbing

## What Worked And What Did Not

### 1. `git pull --rebase upstream main` was the wrong tool here

Rebase started replaying a long stack of local Foxcode-related commits across a heavily changed upstream branch.

That produced repeated conflicts in the same hot files, especially:

- `src/agents/openai-ws-stream.ts`
- `src/agents/pi-embedded-runner/run/attempt.test.ts`

Practical lesson:

- when a local branch contains a long sequence of tightly related commits touching the same files that upstream also changed repeatedly, rebase can become conflict-amplifying
- in that situation, abort early and switch to a one-shot merge

### 2. `git merge upstream/main` was easier to control

After aborting the rebase, a normal merge reduced the problem to the real conflict set:

- `src/agents/openai-ws-stream.ts`
- `src/agents/pi-embedded-runner/run/attempt.test.ts`

That was much easier to reason about than resolving the same logical conflict across many historical commits.

Practical lesson:

- if rebase starts replaying the same conflict over and over, prefer a merge when the human goal is "integrate upstream safely" rather than "rewrite local history cleanly"

## Actual Conflict Patterns

### Pattern 1: Upstream added metadata while local code added compat behavior

In `src/agents/openai-ws-stream.ts`:

- upstream added assistant `phase` tracking and `textSignature` handling
- local code added compat text-tool-call recovery and post-recovery normalization

The correct merge was not "pick one side".

The correct merge was:

1. keep upstream's assistant phase handling
2. keep local compat parsing
3. keep local recovered tool-call normalization
4. make sure new helper inputs (`allowedToolNames`) still exist in the final merged scope

### Pattern 2: Tests diverged because both sides added different regressions

In `src/agents/pi-embedded-runner/run/attempt.test.ts`:

- upstream kept malformed-tool-arg repair tests
- local code added Foxcode compat / block-reply leak regressions

The safest merge strategy was:

1. start from the locally verified test file
2. re-add the upstream-specific test block
3. rerun the targeted suite immediately

Practical lesson:

- for conflict-heavy test files, treat the currently verified local version as the baseline if it already matches the code you intend to ship
- then reintroduce upstream coverage in small, explicit chunks

## The Easy-To-Miss Post-Merge Failure

The merge itself completed, but the local update script at `./fork/scripts/update-local-openclaw.sh` still failed during `pnpm build`.

Root cause:

- `src/agents/openai-ws-stream.ts` still referenced `allowedToolNames`
- the merged file did not reintroduce the local definition in the request-send scope

Symptom:

- TypeScript build failure on a missing shorthand property binding

Practical lesson:

- after resolving semantic merge conflicts, run a real build immediately
- helper arguments and local variables are easy to lose during manual conflict resolution even when the merged code looks logically correct

## Post-Merge Verification That Caught Real Problems

The local update script now runs a small Foxcode leak regression gate before build:

```bash
pnpm vitest run \
  src/telegram/bot-message-dispatch.test.ts \
  src/agents/pi-embedded-runner/run/attempt.test.ts \
  src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts
```

Why this matters:

- these tests protect the exact areas most likely to drift during upstream merges
- the persisted final transcript can still look correct even when Telegram previews briefly leak process text
- a green full app build is not enough to prove the Foxcode leak fix survived

## Effective Validation Order

The safest sequence after a large upstream merge was:

1. merge upstream
2. resolve conflicts
3. run the Foxcode leak regression gate
4. run `./fork/scripts/update-local-openclaw.sh`
5. verify the gateway restarted against the rebuilt `dist`

This caught both:

- logical regressions in the Foxcode leak fix
- mechanical merge mistakes that only surfaced in TypeScript build output

## Recommended Merge Tactics Going Forward

1. Fetch upstream first and inspect how far the branches diverged before choosing rebase or merge.
2. If rebase starts replaying the same conflict in the same hot files, abort and switch to merge.
3. For hot-path runtime files, merge behavior, not text.
4. For hot-path test files, preserve the currently verified local guardrails first, then re-add upstream coverage.
5. Always run the local update script after merge completion, not just targeted tests.
6. When a post-merge build fails, look first for missing helper scope/arguments before assuming the higher-level merge logic is wrong.
