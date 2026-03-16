# Merge Upstream Main on 2026-03-16

Date: 2026-03-16

## Goal

Record the practical lessons from merging `upstream/main` into the local `main` branch, rebuilding locally, restarting the gateway, and pushing the result.

This merge was easier than the 2026-03-12 merge in terms of conflict count, but it exposed a few local-maintenance problems that are worth preserving:

- a local regression gate still pointed at a file path that upstream had moved
- a hand-resolved lockfile conflict left `pnpm install` to repair the lockfile during the update script
- the first deep RPC probe ran before gateway warm-up finished and produced a false negative
- the repo pre-commit hook re-added staged files and tripped on `.agent/workflows/...` because `.agent/` is ignored

## What Worked

### 1. Commit the local one-line `.gitignore` tweak first

Before merging, the working tree contained one local-only `.gitignore` change:

- `fork/investigations/prompt_hub.md`

That file was unrelated to the upstream merge, but leaving it unstaged would have made the merge needlessly fragile because upstream had also changed `.gitignore` in nearby areas.

Practical lesson:

- if the tree is almost clean and only has a small local housekeeping diff, commit it first instead of carrying it through the merge
- that keeps the merge conflict set focused on actual upstream integration

### 2. `git merge upstream/main` was still the right tool

The branch had a large local lead over upstream, and the goal was safe integration, not history cleanup.

This merge produced a manageable real conflict set:

- `extensions/telegram/src/bot-message-dispatch.ts`
- `pnpm-lock.yaml`
- `src/memory/batch-voyage.test.ts`
- `src/plugins/discovery.test.ts`
- `src/plugins/manifest-registry.test.ts`
- `ui/src/styles/chat/layout.css`

Practical lesson:

- keep preferring a normal merge for this fork when local downstream commits are substantial and upstream has been moving quickly
- the conflict surface is easier to reason about than replaying a long downstream stack with rebase

## Conflict Patterns That Mattered

### Pattern 1: upstream path refactor + local behavior patch

In `extensions/telegram/src/bot-message-dispatch.ts`:

- upstream had already moved Telegram ownership under `extensions/telegram`
- local downstream code still needed the Foxcode compat helper import (`normalizeModelSelection`)

The right merge was:

1. keep upstream’s extension-owned import layout
2. re-add the local compat helper import
3. avoid mixing old `src/telegram/...` paths back into the file

Practical lesson:

- when upstream moves a channel under `extensions/*`, preserve the new ownership boundary
- only reintroduce the downstream behavior you still need; do not drag the old path structure back in

### Pattern 2: duplicated local test scaffolding should be deleted, not preserved

In:

- `src/plugins/discovery.test.ts`
- `src/plugins/manifest-registry.test.ts`

the local side had stale duplicated `afterAll(() => process.umask(previousUmask))` blocks, while upstream had already removed them.

Practical lesson:

- when a conflict shows duplicated local scaffolding and upstream has the cleaner version, take the cleaner version
- don’t preserve downstream noise just because it is “ours”

### Pattern 3: lockfile conflicts are easy to “resolve” incorrectly

`pnpm-lock.yaml` conflicted in `@smithy/*` versions.

The manual text resolution removed the conflict markers, but `pnpm install` still reported:

- broken lockfile
- missing preferred package `@smithy/util-stream@4.5.17`

Root cause:

- the lockfile block was syntactically merged but still semantically inconsistent with the rest of the dependency graph

Practical lesson:

- for lockfile conflicts, treat `pnpm install` as mandatory validation, not optional cleanup
- a clean-looking lockfile diff is not enough

## Post-Merge Verification Lessons

### 1. The local update script had drifted from upstream file moves

`fork/scripts/update-local-openclaw.sh` still referenced:

- `src/telegram/bot-message-dispatch.test.ts`

but upstream had moved the real file to:

- `extensions/telegram/src/bot-message-dispatch.test.ts`

Symptom:

- the script reported only 2 test files executed instead of the intended 3

Fix:

- update the script to point at `extensions/telegram/src/bot-message-dispatch.test.ts`
- rerun the explicit three-file Foxcode leak gate

Practical lesson:

- after upstream channel ownership moves, re-check any local verification scripts that hardcode old source paths
- when a “known 3-file gate” suddenly runs only 2 files, treat that as a broken verification surface, not as a harmless rename

### 2. A passing restart is not the same as a ready gateway

Right after `systemctl --user restart openclaw-gateway.service`, the first:

- `openclaw gateway status --deep --require-rpc`

failed with:

- abnormal closure / RPC probe failure

But the service was not actually broken.

What the logs showed:

1. the gateway was still warming up
2. Control UI asset handling happened during startup
3. the actual `listening on ws://0.0.0.0:18789` log line appeared later
4. a second deep RPC probe succeeded

Practical lesson:

- if the first deep probe fails immediately after restart, check logs and timing before assuming the build is bad
- verify whether the gateway has actually reached the `listening on ws://...` log line
- rerun `openclaw gateway status --deep --require-rpc` after warm-up before concluding failure

### 3. `ss` and RPC probe answer different questions

During debugging:

- `ss -ltnp | rg 18789` showed the process listening
- the earlier RPC probe still failed

Practical lesson:

- `ss` only proves a socket exists
- `openclaw gateway status --deep --require-rpc` proves the gateway is actually responding correctly
- use both, in that order, when startup timing is suspicious

## Commit Workflow Gotcha

### Pre-commit hook can fail on tracked files under ignored parents

The merge commit initially failed in the repo hook.

Root cause:

- `git-hooks/pre-commit` runs `git add -- "${files[@]}"`
- the staged merge included `.agent/workflows/update_clawdbot.md`
- `.agent/` is ignored in `.gitignore`, even though `.agent/workflows/` is intentionally tracked
- the re-add step tripped on the ignored parent path

Practical lesson:

- if the merge commit fails after the hook already ran formatting/lint successfully, inspect whether the failure is from the hook’s final `git add`
- for this specific repo state, a merge commit may require `--no-verify` after manually running the relevant checks
- do not skip verification; skip only the broken hook re-add step after you already have independent evidence

## Effective Validation Order

The safest sequence for this merge was:

1. commit the unrelated local `.gitignore` tweak
2. merge `upstream/main`
3. resolve conflicts
4. run `pnpm install` as part of `fork/scripts/update-local-openclaw.sh` and let it validate lockfile consistency
5. notice that the Foxcode leak gate only ran 2 files
6. fix `fork/scripts/update-local-openclaw.sh` to the new Telegram test path
7. rerun the explicit three-file Foxcode leak gate
8. confirm `pnpm build` succeeds
9. restart the gateway
10. check logs, `ss -ltnp`, and then rerun `openclaw gateway status --deep --require-rpc`
11. commit the merge
12. push only after the steady-state RPC probe is green

## Recommended Guardrails Going Forward

1. Whenever upstream moves channel code into `extensions/*`, immediately audit local scripts for hardcoded old `src/<channel>/...` test paths.
2. Treat any lockfile conflict as unresolved until `pnpm install` completes successfully.
3. After a restart, wait for the gateway `listening on ws://...` log line before trusting the first deep probe result.
4. Keep using `openclaw gateway status --deep --require-rpc` as the final health gate, not just `systemctl` or `ss`.
5. If the merge commit fails inside `git-hooks/pre-commit`, inspect the hook itself before assuming the merge content is wrong.
