# Deployment Host Diagnostics Design

**Goal:** Create a skill that helps an OpenClaw agent answer questions about the deployment host using live command-backed evidence instead of general system knowledge.

**Approach:** Add a focused skill under `skills/deployment-host-diagnostics` with a concise `SKILL.md` that enforces an evidence-first, read-only workflow. Put command recipes and diagnostic pivots in `references/` so the skill stays compact while still teaching the agent how to inspect the host reliably.

**Scope**

- Deployment-host diagnostics, not general Linux education
- Emphasize "execute first, answer from observed output"
- Default to read-only checks
- Cover host identity, OpenClaw runtime, Bluetooth/audio, ports, processes, and logs

**Non-goals**

- Broad generic sysadmin automation
- State-changing repair workflows by default
- Overly narrow single-command-only skill behavior
