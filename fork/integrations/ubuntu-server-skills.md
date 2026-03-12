# Ubuntu Server Skills

This fork uses a separate skill repository for Ubuntu Server deployment and operator workflows:

- Source of truth: `https://github.com/LINSUISHENG034/agent-skills.git`
- Runtime install location: `~/.openclaw/skills/`

Examples:

- `deployment-host-diagnostics`
- `host-assisted-browser-login`

Why this repository does not vendor them:

- they are deployment/operator-specific rather than upstream product defaults
- they evolve independently from the OpenClaw source tree
- keeping them external reduces upstream-sync conflicts in the main repository

If you need these skills on a machine running this fork, install or sync them from the external skill repository into `~/.openclaw/skills/`.
