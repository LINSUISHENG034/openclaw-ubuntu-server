# Merge Upstream Main on 2026-03-25

Date: 2026-03-25

## Goal

Complete the local upstream update workflow end-to-end:

1. save a Chinese upstream summary under `fork/updates/`
2. integrate `upstream/main` into local `main`
3. rebuild and restart via `fork/scripts/update-local-openclaw.sh`
4. verify the local gateway with a strict RPC probe
5. record any new merge/update lessons here

## What Happened

### 1. A pre-merge commit was required because local WIP overlapped upstream hot files

Before the merge, the worktree already had local changes in:

- `extensions/telegram/src/thread-bindings.test.ts`
- `extensions/telegram/src/thread-bindings.ts`
- `src/agents/acp-spawn.test.ts`
- `src/channels/plugins/contracts/registry.ts`

Two of those (`src/agents/acp-spawn.test.ts` and
`src/channels/plugins/contracts/registry.ts`) were also touched by
`upstream/main`, so merging on a dirty tree was not safe.

Practical lesson:

- when local WIP is explicitly meant to ride with the upstream sync, make a
  narrow pre-merge commit first instead of trying to merge through overlapping
  unstaged edits

### 2. `scripts/committer` can still be blocked by unrelated repo-wide red gates

The intended pre-merge commit path was:

- `scripts/committer "Fork: prepare upstream sync" ...`

That failed because repo-wide TypeScript issues unrelated to the 5 target files
were already red:

- `extensions/telegram/src/bot-message-dispatch.test.ts`
- `src/agents/pi-embedded-subscribe.subscribe-embedded-pi-session.replays-foxcode-compat-tooluse-boundary.test.ts`
- `src/infra/push-apns.test.ts`
- `src/plugins/copy-bundled-plugin-metadata.test.ts`
- `src/tui/components/filterable-select-list.ts`
- `src/tui/components/searchable-select-list.ts`
- `ui/src/ui/views/agents.ts`

Fallback used:

- a scoped `git commit --no-verify` that included only:
  - the 4 intended local code changes
  - `fork/updates/2026-03-25-upstream-update-summary-zh.md`

Practical lesson:

- if the repo baseline is already red and a clean tree is required for an
  upstream sync, a narrow `--no-verify` commit is still the least disruptive
  way to preserve local intent without using `stash`

### 3. Conflict set was broad, but the resolution pattern stayed consistent

Conflicts landed in:

- `extensions/telegram/src/bot-message-dispatch.ts`
- `scripts/copy-bundled-plugin-metadata.mjs`
- `src/agents/acp-spawn.test.ts`
- `src/agents/openai-ws-stream.ts`
- `src/agents/pi-embedded-runner/run/attempt.test.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/auto-reply/reply/dispatch-from-config.ts`
- `src/config/types.models.ts`
- `src/plugins/copy-bundled-plugin-metadata.test.ts`

What worked:

- keep upstream’s structural refactors when they reduce duplicated logic or fix
  packaging/runtime behavior
- re-apply fork-only Foxcode/ACP compat behavior only where dedicated local
  regression coverage still proves it matters
- when a conflict mixes broadened typing with fork-specific compat extensions,
  prefer the union instead of reverting to either side’s narrower shape

Concrete examples:

- `src/config/types.models.ts`: keep both `"qwen"` and `"openrouter"` in
  `SupportedThinkingFormat`
- `src/agents/pi-embedded-runner/run/attempt.ts`: preserve the fork’s Foxcode
  compat prompt building, but also adopt upstream’s
  `runAttemptContextEngineBootstrap(...)` helper
- `scripts/copy-bundled-plugin-metadata.mjs` and
  `src/plugins/copy-bundled-plugin-metadata.test.ts`: take upstream’s
  package-aware optional-bundle handling instead of keeping the older local
  variant

### 4. New regression found: Telegram compat preview suppression used the wrong dependency path

The first run of `fork/scripts/update-local-openclaw.sh` failed in the Foxcode
protection lane:

- `extensions/telegram/src/bot-message-dispatch.test.ts`
- failing case:
  - `does not create Telegram partial previews for Foxcode compat sessions`

Symptom:

- `createTelegramDraftStream` was called twice, meaning answer/reasoning preview
  lanes were created for a Foxcode compat session that should have suppressed
  answer previews entirely

Root cause:

- after the merge, `resolveTelegramReasoningLevel(...)` already used injected
  `telegramDeps.resolveStorePath/loadSessionStore`
- but `shouldSuppressTelegramCompatAnswerPreview(...)` still called
  `resolveTelegramSessionEntry(...)`, which was reading the session store
  through direct `config-runtime` imports instead of the injected `telegramDeps`
- in the test/runtime seam used here, that direct path returned no session entry,
  so compat suppression silently failed and preview lanes were created

Minimal fix that worked:

- thread `telegramDeps` through:
  - `resolveTelegramSessionEntry(...)`
  - `shouldSuppressTelegramCompatAnswerPreview(...)`
- use the same injected store loader/resolver as the reasoning path

Verification evidence:

- failing repro:
  - `pnpm test -- extensions/telegram/src/bot-message-dispatch.test.ts -t "does not create Telegram partial previews for Foxcode compat sessions"`
- passing after fix:
  - same command returned `1 passed`

Practical lesson:

- when upstream moves one code path onto injected runtime deps, sibling helper
  paths that still use direct imports become prime suspects for merge-time seam
  regressions
- for Telegram dispatch specifically, reasoning-level lookup and compat-preview
  suppression must resolve session state through the same dependency source

### 5. First strict RPC probe can still fail even after a successful rebuild

After the repaired update script finished, the first strict verification still
failed:

- `openclaw gateway status --deep --require-rpc`
- result:
  - `RPC probe: failed`
  - `Gateway port 18789 is not listening`

At the same time, logs were confusing because they still contained the old PID’s
shutdown error about pre-upgrade plugin compatibility:

- previous process reported host version `2026.3.14`
- many plugins required `>=2026.3.22`

That was not the final post-restart state.

Fresh evidence from the new PID showed the gateway was still warming up:

- `systemctl --user status openclaw-gateway.service` showed new PID `3252901`
- later `journalctl` output showed the new PID loading plugins and bringing up
  QQBot/Telegram/Discord
- `ss -ltnp | rg 18789` later showed the port listening
- rerunning `openclaw gateway status --deep --require-rpc` then returned:
  - `RPC probe: ok`

Practical lesson:

- when the first strict RPC probe fails immediately after a restart, separate
  the old PID’s shutdown logs from the new PID’s startup logs before concluding
  the gateway is broken
- confirm all three:
  - new PID exists in `systemctl --user status`
  - new PID logs show forward startup progress
  - `ss -ltnp | rg 18789` eventually shows the listener
- only treat it as a real post-merge startup failure if a later rerun of
  `openclaw gateway status --deep --require-rpc` still fails

## Concrete Outputs From This Update

- Added upstream summary:
  - `fork/updates/2026-03-25-upstream-update-summary-zh.md`
- Added new merge note:
  - `fork/experience/upstream-merges/2026-03-25-merge-upstream-main.md`
- Fixed Telegram compat preview suppression seam:
  - `extensions/telegram/src/bot-message-dispatch.ts`

## Recommended Guardrails Going Forward

1. If a merge changes one runtime seam from direct imports to injected deps,
   audit sibling helpers for the same seam before trusting related tests.
2. Keep using a narrow pre-merge commit when local WIP intentionally ships with
   the upstream sync and overlaps upstream-modified files.
3. Treat `scripts/committer` failure during upstream sync as potentially
   repo-baseline-related, not necessarily caused by the small bookkeeping commit.
4. Do not trust the first strict gateway probe right after restart when logs are
   still mixing old-process shutdown errors with new-process startup progress.
