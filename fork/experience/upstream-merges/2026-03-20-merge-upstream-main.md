# Merge Upstream Main on 2026-03-20

Date: 2026-03-20

## Goal

Complete the standard local upstream update workflow:

1. save a Chinese upstream summary under `fork/updates/`
2. merge `upstream/main` into local `main`
3. rebuild and restart via `fork/scripts/update-local-openclaw.sh`
4. verify the local gateway with a strict RPC probe
5. record any new merge/update lessons here

## What Happened

### 1. `git merge upstream/main` was still the right integration strategy

The fork was still heavily diverged from upstream, so a normal merge remained
more controllable than replaying local history with rebase.

Merge conflicts this time were limited to:

- `AGENTS.md`
- `extensions/telegram/src/bot-message-dispatch.test.ts`
- `src/config/types.models.ts`

### 2. Conflict patterns that worked

- `AGENTS.md`: preserve fork-specific operator notes, then keep new upstream
  guardrails after them instead of picking one side.
- `extensions/telegram/src/bot-message-dispatch.test.ts`: start from upstream’s
  broader test shape, then re-add the local `openclaw/plugin-sdk/reply-runtime`
  mock that still protects the Foxcode compat path.
- `src/config/types.models.ts`: combine upstream’s
  `OpenAICompletionsCompat`-derived typing with the local `textToolCalls`
  compat config instead of flattening back to either side’s older shape.

### 3. New root cause discovered after rebuild

The first rerun of `fork/scripts/update-local-openclaw.sh` looked successful at
the script level, but strict gateway validation still failed:

- `openclaw gateway status --deep --require-rpc` returned abnormal closure
- journal logs initially showed repeated
  `plugin: extension entry escapes package directory` errors

This was **not** caused by the merge-conflict files above.

Root cause:

- `tsdown.config.ts` only builds some bundled extension clusters when
  `OPENCLAW_INCLUDE_OPTIONAL_BUNDLED=1`
- optional clusters include `acpx`, `diagnostics-otel`, `matrix`, `msteams`,
  `nostr`, `tlon`, `twitch`, `whatsapp`, `zalouser`, and others
- `scripts/copy-bundled-plugin-metadata.mjs` still copied/re-wrote
  `dist/extensions/<plugin>/package.json` and `openclaw.plugin.json` for _all_
  source extensions, even when that optional cluster had not actually been built
- result: `dist/extensions/<plugin>/package.json` pointed at `./index.js` or
  `./setup-entry.js`, but those files did not exist in `dist/extensions/<plugin>`
- upstream’s stricter plugin discovery then treated those half-built bundled
  plugin dirs as real load errors, and gateway startup never reached a healthy
  RPC state

### 4. What fixed it

We followed a small TDD cycle:

1. added a failing test in
   `src/plugins/copy-bundled-plugin-metadata.test.ts`
   asserting that optional bundled plugins should be skipped when the optional
   cluster is not being built
2. confirmed the new test failed
3. updated `scripts/copy-bundled-plugin-metadata.mjs` to use the same
   `shouldBuildBundledCluster(...)` filter as `tsdown.config.ts`
4. updated existing tests that intentionally exercise optional bundles to pass
   `OPENCLAW_INCLUDE_OPTIONAL_BUNDLED=1` explicitly
5. reran the targeted test, then the full test file
6. reran `fork/scripts/update-local-openclaw.sh`
7. reran `openclaw gateway status --deep --require-rpc`

### 5. Important false lead ruled out

I also tried a one-off:

- `OPENCLAW_INCLUDE_OPTIONAL_BUNDLED=1 pnpm build`

That failed on an unresolved `jimp` import from WhatsApp/Baileys, which proved
that simply “building all optional bundles locally” is not the right default
workflow here.

Practical lesson:

- when optional bundled clusters are intentionally excluded from the default
  build, metadata-copy logic must share the same inclusion filter
- otherwise the build emits plugin _descriptors_ for code that was never built

### 6. Startup verification nuance after the fix

Even after the half-built bundled plugin issue was fixed, the first strict probe
still failed immediately after restart with:

- runtime active
- port not yet listening
- RPC probe abnormal closure

But a short wait and a second probe succeeded after the gateway reached:

- `listening on ws://127.0.0.1:18789`

Practical lesson:

- keep using `openclaw gateway status --deep --require-rpc` as the final gate
- if the first probe fails right after restart, confirm whether the gateway has
  actually reached the listen log line before declaring startup broken

## Concrete Outputs From This Update

- Added upstream summary:
  - `fork/updates/2026-03-20-upstream-update-summary-zh.md`
- Added new merge note:
  - `fork/experience/upstream-merges/2026-03-20-merge-upstream-main.md`
- Fixed bundled plugin metadata filtering:
  - `scripts/copy-bundled-plugin-metadata.mjs`
- Added regression coverage for the optional-bundle metadata mismatch:
  - `src/plugins/copy-bundled-plugin-metadata.test.ts`

## Recommended Guardrails Going Forward

1. Any script that rewrites `dist/extensions/*` metadata must share the same
   optional-cluster filter as the build graph.
2. If `dist/extensions/<plugin>/package.json` claims `./index.js` or
   `./setup-entry.js`, verify those files actually exist after build.
3. Treat a successful rebuild script exit as insufficient evidence; always rerun
   `openclaw gateway status --deep --require-rpc`.
4. When a restart-time RPC probe fails, check for the explicit gateway listen
   log line before concluding the new build is broken.
