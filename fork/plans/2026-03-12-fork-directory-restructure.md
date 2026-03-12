# Fork Directory Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic `custom/` area with a clearer fork-specific structure that is suitable for a public downstream repository, preserve secret isolation for `api/`, and explicitly move Ubuntu Server-specific skills out of the main repo skill surface into the external skill repository workflow.

**Architecture:** Keep fork-only material in a top-level directory outside upstream-owned product docs and source trees. Rename `custom/` to `fork/`, split its contents into purpose-specific subdirectories, and update every local script, ignore rule, and human-facing reference to the new paths. Separately, remove Ubuntu Server-specific operational skills such as `deployment-host-diagnostics` from the repository-managed `skills/` tree, and replace them with fork documentation that points users to the external managed skill repository `https://github.com/LINSUISHENG034/agent-skills.git`. Treat this as a repository-structure migration plus ownership-boundary cleanup, not a content rewrite.

**Tech Stack:** Git, TypeScript repository tooling, shell scripts, Markdown documentation, `.gitignore`

---

## Migration Ordering Rule

This migration must preserve a usable location for the active restructuring plan while the move is in progress.

Apply this ordering rule throughout execution:

1. create the new `fork/` structure first
2. move the currently active restructuring plan out of `docs/plans/` into `fork/plans/`
3. update all live references to point at the new `fork/plans/...` path
4. only then migrate the remaining fork-only plan documents out of `docs/plans/`
5. only delete old `docs/plans/` copies after all active references have been switched

Why:

- `docs/plans/` currently contains fork-only planning material, but the active migration plan itself also lives there right now
- deleting or bulk-moving `docs/plans/` too early would make the in-flight migration self-referential and brittle
- the active plan must remain addressable at every step

Practical consequence:

- treat the active plan file as the first plan document to migrate
- do not start the broad `docs/plans/` cleanup until that migration and its path updates are already complete

### Task 1: Lock The Current `custom/` Inventory Before Moving Anything

**Files:**

- Check: `custom/`
- Check: `.gitignore`
- Check: `AGENTS.md`
- Check: `README.md`
- Check: `custom/scripts/update-local-openclaw.sh`
- Check: `docs/plans/`

**Step 1: Record the current `custom/` inventory**

Run:

```bash
find custom -maxdepth 2 -type d | sort
find custom -maxdepth 2 -type f | sort
```

Expected:

- current top-level subdirectories are visible
- `custom/api/` is the only intentionally secret subtree
- all public docs/scripts that need migration are enumerated

**Step 2: Record all repository references to `custom/`**

Run:

```bash
rg -n "custom/" .
```

Expected:

- all code/docs/script references to `custom/` are listed
- references can be grouped into:
  - must-update path references
  - stale historical references inside archived docs/plans
  - ignore rules

**Step 3: Verify the current ignore boundary**

Run:

```bash
git check-ignore -v custom/api/anyrouter.json custom/experience/2026-03-12-foxcode-telegram-leak-repair.md
```

Expected:

- `custom/api/...` is ignored
- current public docs are not ignored after the previous `.gitignore` narrowing

**Step 4: Write down the migration scope in working notes**

No code yet. Summarize:

- which directories move
- which files must be edited
- which docs are historical artifacts and may keep old path text as historical context
- which `docs/plans/` files are fork-only and must eventually move under `fork/plans/`

**Step 5: Commit**

Do not commit in this task. This is inventory only.

### Task 2: Create The New Fork-Specific Directory Skeleton

**Files:**

- Create: `fork/README.md`
- Create: `fork/api/`
- Create: `fork/experience/`
- Create: `fork/experience/upstream-merges/`
- Create: `fork/investigations/`
- Create: `fork/plans/`
- Create: `fork/scripts/`
- Create: `fork/integrations/`

**Step 1: Create the new directory structure**

Create these directories exactly:

```text
fork/
fork/api/
fork/experience/
fork/experience/upstream-merges/
fork/investigations/
fork/plans/
fork/scripts/
fork/integrations/
```

**Step 2: Add `fork/README.md`**

Write a short explainer that states:

- `fork/` contains downstream-only material for this public fork
- upstream product code/docs remain in their normal locations
- `fork/api/` may contain machine-local sensitive files and must stay ignored
- other subdirectories are intended to be versioned

Minimal starter content:

```md
# Fork-Specific Repository Material

This directory contains downstream-only material for this fork of OpenClaw.

- `api/`: local sensitive config and secrets (ignored)
- `experience/`: validated repair and operations notes
- `investigations/`: issue-specific debugging notes
- `plans/`: downstream implementation/design plans
- `scripts/`: fork-specific maintenance scripts
- `integrations/`: notes or helpers for fork-only integrations
```

**Step 3: Verify the skeleton exists**

Run:

```bash
find fork -maxdepth 2 -type d | sort
```

Expected:

- all planned subdirectories exist

**Step 4: Commit**

Do not commit yet. The skeleton should be committed together with the moved content.

### Task 3: Migrate The Active Plan And Then Clean `docs/plans/`

**Files:**

- Move: `docs/plans/2026-03-12-fork-directory-restructure.md` -> `fork/plans/2026-03-12-fork-directory-restructure.md`
- Move: fork-only files from `docs/plans/` -> `fork/plans/`
- Modify: any repo file that references `docs/plans/2026-03-12-fork-directory-restructure.md`

**Step 1: Move the active restructuring plan first**

Move:

```text
docs/plans/2026-03-12-fork-directory-restructure.md
-> fork/plans/2026-03-12-fork-directory-restructure.md
```

This is mandatory before any broad `docs/plans/` cleanup.

**Step 2: Update all live references to the active plan**

Run:

```bash
rg -n "2026-03-12-fork-directory-restructure.md|docs/plans/" .
```

Update all active instructions that should now point to:

```text
fork/plans/2026-03-12-fork-directory-restructure.md
```

**Step 3: Inventory remaining fork-only plan documents in `docs/plans/`**

Group them into:

- fork-only implementation/debugging plans that must move to `fork/plans/`
- any true upstream/product docs that should stay in `docs/`

**Step 4: Move the remaining fork-only plan documents**

Move all fork-only plan files from:

```text
docs/plans/
```

to:

```text
fork/plans/
```

Requirement:

- preserve filenames unless there is a strong naming reason to change them
- do not leave fork-only planning material mixed into `docs/`

**Step 5: Verify `docs/plans/` after migration**

Run:

```bash
find docs/plans -maxdepth 1 -type f | sort
find fork/plans -maxdepth 1 -type f | sort
```

Expected:

- the active plan now lives in `fork/plans/`
- fork-only planning files are no longer under `docs/plans/`
- anything still left under `docs/plans/` is intentionally part of upstream/product docs

**Step 6: Commit**

Do not commit yet. This should land together with the broader directory migration.

### Task 4: Move Existing `custom/` Content Into Purpose-Specific `fork/` Paths

**Files:**

- Move: `custom/api/*` -> `fork/api/`
- Move: `custom/experience/*` -> `fork/experience/`
- Move: `custom/issues/*` -> `fork/investigations/`
- Move: `custom/proposals/*` -> `fork/plans/`
- Move: `custom/scripts/*` -> `fork/scripts/`

**Step 1: Move the sensitive subtree**

Move:

```text
custom/api/ -> fork/api/
```

Requirement:

- preserve file contents exactly
- do not unignore anything in `api/`

**Step 2: Move the public experience notes**

Move:

```text
custom/experience/* -> fork/experience/
```

Requirement:

- preserve the existing `upstream-merges/` subdirectory structure under `fork/experience/`

**Step 3: Move investigations and proposals**

Move:

```text
custom/issues/* -> fork/investigations/
custom/proposals/* -> fork/plans/
```

**Step 4: Move fork-specific scripts**

Move:

```text
custom/scripts/* -> fork/scripts/
```

**Step 5: Decide what to do with now-empty `custom/`**

Recommended:

- remove the empty `custom/` tree entirely once all references are updated

**Step 6: Verify the post-move tree**

Run:

```bash
find fork -maxdepth 2 -type f | sort
find custom -maxdepth 2 -type f | sort
```

Expected:

- `fork/` contains all migrated content
- `custom/` is empty or absent

**Step 7: Commit**

Do not commit yet. Path reference updates must land in the same migration commit.

### Task 5: Update Ignore Rules And Repository References

**Files:**

- Modify: `.gitignore`
- Modify: `AGENTS.md`
- Modify: `fork/scripts/update-local-openclaw.sh`
- Modify: any repository file returned by `rg -n "custom/" .`

**Step 1: Update `.gitignore`**

Replace the old secret rule:

```gitignore
/custom/api/
```

with:

```gitignore
/fork/api/
```

Keep the meaning identical:

- only `fork/api/` is ignored
- other `fork/` content remains tracked

**Step 2: Update operational/script references**

At minimum, update:

- `AGENTS.md`
- `fork/scripts/update-local-openclaw.sh` if it references old `custom/` paths

Requirement:

- all active path references must point to `fork/...`
- historical prose inside archived notes may still mention `custom/...` when describing past events, but active instructions should not

**Step 3: Update any user-facing fork path mentions**

Search and fix:

```bash
rg -n "custom/" .
```

Update any live instructions, examples, or maintenance steps that still point to `custom/...`.

**Step 4: Re-run ignore checks**

Run:

```bash
git check-ignore -v fork/api/anyrouter.json fork/experience/2026-03-12-foxcode-telegram-leak-repair.md
```

Expected:

- `fork/api/...` is ignored
- public fork docs are not ignored

**Step 5: Commit**

Still wait. Verification should happen before the migration commit.

### Task 6: Add Public-Facing Fork Positioning

**Files:**

- Modify: `README.md`
- Modify: `fork/README.md`

**Step 1: Add a short downstream-fork note near the top of `README.md`**

Add a concise section stating:

- this repository is a downstream fork of `openclaw/openclaw`
- it tracks upstream updates continuously
- it focuses on Ubuntu Server/self-hosted deployment concerns and downstream fixes
- upstream-general improvements are intended to be contributed back where possible

Keep it short and factual.

**Step 2: Keep `fork/README.md` aligned with that message**

Make sure `fork/README.md` explains:

- why fork-only material exists
- that `fork/` is the correct home for downstream operational notes
- that this keeps upstream product docs cleanly separated

**Step 3: Verify path consistency in docs**

Run:

```bash
rg -n "custom/|fork/" README.md AGENTS.md fork
```

Expected:

- live references point to `fork/`
- stale `custom/` mentions are only historical/quoted if any remain at all

**Step 4: Commit**

Do not commit separately unless you intentionally want a distinct docs commit.

### Task 7: Move Ubuntu Server-Specific Skills Out Of The Repository Skill Surface

**Files:**

- Check: `skills/deployment-host-diagnostics/`
- Modify or Remove: any repo-tracked files under `skills/deployment-host-diagnostics/`
- Create: `fork/integrations/README.md`
- Create or Modify: `fork/integrations/ubuntu-server-skills.md`
- Modify: `README.md` if it mentions repository-managed versions of these skills
- Modify: `AGENTS.md` if it references repository-managed paths for these skills

**Step 1: Inventory repository-tracked Ubuntu Server-specific skills**

Run:

```bash
git ls-files skills
rg -n "deployment-host-diagnostics|host-assisted-browser-login" .
```

Expected:

- confirm whether `skills/deployment-host-diagnostics/` is still tracked in git
- identify any active references that still point to repo-managed skill paths

**Step 2: Define the ownership boundary**

Document this rule in working notes before editing:

- upstream/general-purpose skills stay in the repository `skills/` tree
- Ubuntu Server deployment/operator-specific skills belong to the external managed skill workflow
- runtime installation lives under `~/.openclaw/skills/`
- source-of-truth development lives in `https://github.com/LINSUISHENG034/agent-skills.git`

**Step 3: Remove repository git records for the deployment-specific skill**

If `skills/deployment-host-diagnostics/` is still tracked, remove it from the repository tree.

Requirement:

- do not remove the runtime copy under `~/.openclaw/skills/`
- only remove the repo-managed copy and its git history going forward
- keep the repository cleanly pointing to the external source of truth instead of keeping a stale mirror

**Step 4: Add fork documentation that points to the external skill repository**

Create `fork/integrations/ubuntu-server-skills.md` with:

- a short explanation that Ubuntu Server-specific operational skills are managed outside this repository
- a link to `https://github.com/LINSUISHENG034/agent-skills.git`
- examples naming at least:
  - `deployment-host-diagnostics`
  - `host-assisted-browser-login`
- the expected runtime location:
  - `~/.openclaw/skills/`

Keep the wording clear that this repository intentionally does not vendor those skills anymore.

**Step 5: Add or update `fork/integrations/README.md`**

Add a short index entry pointing to the Ubuntu Server skills note, so the purpose of `fork/integrations/` is obvious.

**Step 6: Update live references**

Replace any active repository references that still imply:

- `deployment-host-diagnostics` lives in `skills/`
- `host-assisted-browser-login` is expected to be sourced from this repository

Those references should instead point to:

- the external skill repository
- or the runtime-managed `~/.openclaw/skills/` location

**Step 7: Verify the cleanup**

Run:

```bash
git ls-files skills | rg "deployment-host-diagnostics" || true
rg -n "skills/deployment-host-diagnostics|deployment-host-diagnostics" README.md AGENTS.md fork
```

Expected:

- no repository-managed `skills/deployment-host-diagnostics` remains
- public docs now describe the external skill source of truth correctly

**Step 8: Commit**

Recommended commit:

```bash
scripts/committer "Fork: externalize Ubuntu Server operator skills" \
  README.md \
  AGENTS.md \
  fork/integrations/README.md \
  fork/integrations/ubuntu-server-skills.md \
  skills/deployment-host-diagnostics
```

Adjust the exact file list based on what is actually tracked.

### Task 8: Verify The Migration End-To-End

**Files:**

- Check: `.gitignore`
- Check: `fork/scripts/update-local-openclaw.sh`
- Check: migrated `fork/` content

**Step 1: Verify the repository no longer depends on `custom/`**

Run:

```bash
test -d custom && find custom -maxdepth 2 -type f | sort || true
rg -n "custom/" .
```

Expected:

- no active repo logic depends on `custom/`
- any remaining matches are historical artifacts that are intentionally preserved or should be updated before commit

**Step 2: Re-run the local update script from its new location**

Run:

```bash
./fork/scripts/update-local-openclaw.sh
```

Expected:

- install step succeeds
- targeted Foxcode leak regressions pass
- build succeeds
- service restarts successfully

**Step 3: Verify Git sees the right boundary**

Run:

```bash
git status --short
```

Expected:

- migrated public docs/scripts are tracked
- `fork/api/` remains ignored

**Step 4: Create the migration commit**

Use one commit unless the rename is too large and you want docs split out:

```bash
scripts/committer "Fork: replace custom with fork workspace" \
  .gitignore \
  README.md \
  AGENTS.md \
  fork/README.md \
  fork/scripts/update-local-openclaw.sh \
  fork/api \
  fork/experience \
  fork/investigations \
  fork/plans
```

If Git pathspec handling is awkward for renames, pass the exact moved files instead.

### Task 9: Post-Migration Follow-Up

**Files:**

- Optional: `CONTRIBUTING.md`
- Optional: `SECURITY.md`
- Optional: additional public-facing fork docs

**Step 1: Decide whether to document fork contribution policy**

If helpful, add a short note explaining:

- upstream-general fixes should be isolated when possible
- fork-only integrations remain under `fork/`

**Step 2: Decide whether to keep archived historical docs under `fork/plans/`**

If some files are purely transient or superseded:

- either keep them for traceability
- or move the obsolete ones under a clearly named archival subdirectory such as `fork/plans/archive/`

Do not mix that cleanup into the structural migration unless it is trivial.

**Step 3: Push after verification**

Run:

```bash
git push origin main
```

Expected:

- remote branch contains the new `fork/` layout
- no sensitive `fork/api/` content is pushed

## Recommended Execution Strategy

Use this migration as three commits if you want safer review:

1. `Fork: replace custom with fork workspace`
2. `Fork: externalize Ubuntu Server operator skills`
3. `Docs: add downstream fork positioning`

That split is optional. A smaller sequence is preferable to one giant rename when the skill-ownership cleanup is included.
