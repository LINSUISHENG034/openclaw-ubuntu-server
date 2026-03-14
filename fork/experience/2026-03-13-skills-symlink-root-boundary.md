# Skills Symlink Root Boundary

Date: 2026-03-13

## Goal

Verify whether OpenClaw failing to load a skill symlinked from `~/.openclaw/skills/<skill>` to an external directory is an incidental bug or an intentional boundary in the current implementation.

## Verified Result

The conclusion is correct in substance:

- OpenClaw treats each configured skills root as a containment boundary.
- A skill directory or `SKILL.md` whose resolved realpath escapes that root is intentionally skipped.
- The warning `Skipping skill path that resolves outside its configured root.` is the expected result of that policy, not a flaky failure.

The boundary difference is also real:

- Supported: the configured root itself can be a symlink, as long as discovery stays inside the resolved root.
- Not supported: a child skill directory symlink or child `SKILL.md` symlink that resolves outside the configured root.

## Code Evidence

The enforcement sits in `src/agents/skills/workspace.ts`.

- `loadSkillEntries()` resolves each source root with `rootDir = path.resolve(...)` and `rootRealPath = tryRealpath(rootDir) ?? rootDir` in `src/agents/skills/workspace.ts:302-305`.
- Every discovered candidate path is re-resolved through `resolveContainedSkillPath()` in `src/agents/skills/workspace.ts:201-220`.
- That helper only accepts the candidate when `isPathInside(rootRealPath, candidateRealPath)` passes in `src/agents/skills/workspace.ts:211-212`.
- On failure it emits the warning in `src/agents/skills/workspace.ts:193`.
- The same helper is used for root/base dir, skill dir, and `SKILL.md` checks in `src/agents/skills/workspace.ts:309-317`, `src/agents/skills/workspace.ts:383-389`, and `src/agents/skills/workspace.ts:396-403`.

This is why a root symlink can work: once the configured root is realpathed, candidates are checked relative to that resolved root. This is also why a child symlink escaping the root is rejected.

## Existing Test And Audit Coverage

The repository already has direct coverage for the "escape gets skipped" behavior:

- `src/agents/skills.loadworkspaceskillentries.test.ts:133-176` asserts that workspace skill directories and workspace `SKILL.md` files resolving outside the workspace root are not loaded.
- `src/security/audit.test.ts:895-928` asserts that a workspace `SKILL.md` escaping via symlink produces the `skills.workspace.symlink_escape` warning.
- `docs/gateway/security/index.md:255` documents `skills.workspace.symlink_escape` as a security warning.
- `docs/tools/skills.md:73` documents that workspace and extra-dir discovery only accepts skill roots and `SKILL.md` files whose resolved realpath stays inside the configured root.

Important nuance:

- In this pass, I did not find an existing repo test specifically asserting the managed-root-symlink-supported case.
- That supported case is still well-founded, but the evidence is code-path analysis plus local repro, not an existing committed test.

## Local Verification Run

I ran two isolated local repros against `loadWorkspaceSkillEntries()` with a temporary `HOME` so personal skills would not affect results.

### 1. Managed root is a symlink

Setup:

- create a real shared skills directory outside the managed path
- symlink `managedSkillsDir` itself to that shared directory
- load skills with `managedSkillsDir` pointing at the symlink

Result:

- loaded names were `["demo"]`

This confirms the configured root itself may be a symlink.

### 2. Managed child skill dir is a symlink escaping the root

Setup:

- create a normal managed root
- create a skill directory outside that root
- symlink `managedRoot/demo -> outside/demo`

Result:

- warning logged: `Skipping skill path that resolves outside its configured root.`
- loaded names were `[]`

This confirms the child escape is intentionally blocked for managed skills too.

## Recommended Path

If the goal is to reuse a shared external skills folder, the supported path in the current design is to configure:

- `skills.load.extraDirs` in `~/.openclaw/openclaw.json`

Relevant references:

- `src/agents/skills/workspace.ts:448-469`
- `docs/tools/skills.md:25-26`
- `docs/help/faq.md:1060-1064`

## Practical Rule

Treat `~/.openclaw/skills` as a managed root, not as a directory of outbound symlink trampolines.

- If you want managed overrides, put real skill content under that root.
- If you want to mount a whole alternate shared root, symlink the root itself or use `skills.load.extraDirs`.
- Do not expect `~/.openclaw/skills/<skill>` or `~/.openclaw/skills/<skill>/SKILL.md` to be allowed to escape to an arbitrary external directory under the current implementation.
