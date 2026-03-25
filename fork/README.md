# Fork-Specific Repository Material

This directory contains downstream-only material for this public fork of OpenClaw.

- `api/`: local sensitive config and secrets (ignored)
- `experience/`: validated repair and operations notes
- `investigations/`: issue-specific debugging notes
- `plans/`: downstream implementation and migration plans
- `scripts/`: fork-specific maintenance scripts
- `integrations/`: notes and references for fork-only integrations and external skill sources

Historical note:

- Foxcode provider-specific plans and experience notes under `fork/` are retained as historical records only.
- Foxcode is no longer treated as an active fork feature or merge policy.
- Future upstream alignment work should preserve generic compat behavior, not Foxcode-specific runtime hooks.

The upstream product code and official documentation remain in their normal top-level locations.

Ubuntu Server operator skills such as `deployment-host-diagnostics` and `host-assisted-browser-login` are intentionally not maintained in this repository's `skills/` tree. Their source of truth lives in `https://github.com/LINSUISHENG034/agent-skills.git`, and runtime installation belongs under `~/.openclaw/skills/`.
