# OpenClaw Global Install Switched to Repo Build

Date: 2026-03-10

## Goal

Record the exact process used to stop relying on the original `npm install -g openclaw` package payload and make the active `openclaw` CLI and `openclaw-gateway.service` run from the current repository build under `/mnt/sda1/github/openclaw`.

This is useful when debugging or fixing OpenClaw source code locally but the machine is still running an older globally installed package.

## Final Verified State

At the end of the change, the machine was in this state:

- Global `openclaw` binary resolved to:

```bash
/home/lin/.local/share/pnpm/openclaw
```

- `openclaw --version` reported:

```bash
OpenClaw 2026.3.9 (8a6cd80)
```

- systemd user service file `~/.config/systemd/user/openclaw-gateway.service` used this `ExecStart`:

```bash
/home/lin/.nvm/versions/node/v24.14.0/bin/node /mnt/sda1/github/openclaw/dist/index.js gateway --port 18789
```

- `openclaw gateway status` reported:

```bash
Command: /home/lin/.nvm/versions/node/v24.14.0/bin/node /mnt/sda1/github/openclaw/dist/index.js gateway --port 18789
RPC probe: ok
```

This proves the running gateway process came from the repository build, not from the original npm global package directory.

## Why This Was Needed

OpenClaw had originally been installed globally through npm. In that state:

- the CLI entrypoint came from a global install path
- the systemd gateway service pointed to the package under global `node_modules`
- changing repository source files had no effect on the actually running gateway

For local debugging and code fixes, the active CLI and gateway service had to be switched to the repository build.

## High-Level Process

The working migration path was:

1. Install repository dependencies
2. Build the repository
3. Make `pnpm` globally callable from the current environment
4. Link the repository as the global `openclaw`
5. Run `openclaw doctor --repair --yes` so OpenClaw rewrites the service entrypoint
6. Restart the gateway
7. Verify both the global CLI path and the systemd `ExecStart`

## Exact Process

### 1. Install dependencies

The machine did not initially have `pnpm` directly on `PATH`, so `corepack` was used first.

```bash
corepack pnpm install
```

Observed:

- `pnpm` itself was available through `corepack`
- repository `node_modules` was installed successfully

### 2. Build the repository

```bash
pnpm build
```

Observed:

- the build completed successfully
- repository output was generated under `dist/`

This step is required because the gateway service ultimately runs:

```bash
/mnt/sda1/github/openclaw/dist/index.js
```

### 3. Make `pnpm` global bin usable

`pnpm link --global` initially failed because no global bin directory was configured.

Error seen:

```bash
ERR_PNPM_NO_GLOBAL_BIN_DIR
```

The working fix was to set `PNPM_HOME` explicitly and ensure it was prepended to `PATH`.

```bash
mkdir -p /home/lin/.local/share/pnpm
PATH="/home/lin/.local/share/pnpm:$PATH" PNPM_HOME=/home/lin/.local/share/pnpm pnpm link --global
```

This succeeded and linked the repository package as the global `openclaw`.

### 4. Verify the global CLI path

After linking, the active binary was checked using:

```bash
PATH="/home/lin/.local/share/pnpm:$PATH" which openclaw
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw --version
```

Expected result:

- `which openclaw` points to `~/.local/share/pnpm/openclaw`
- version matches the repository build

### 5. Rewrite the gateway service entrypoint

Linking the package alone is not enough. The existing systemd unit still points to the old path until OpenClaw rewrites it.

This was done with:

```bash
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw doctor --repair --yes
```

Observed during doctor:

- it detected that the gateway service entrypoint did not match the current install
- it rewrote `~/.config/systemd/user/openclaw-gateway.service`
- it backed up the previous unit file

The key signal in doctor output was:

```bash
Gateway service entrypoint does not match the current install.
(/home/lin/.nvm/.../lib/node_modules/openclaw/dist/index.js -> /mnt/sda1/github/openclaw/dist/index.js)
Installed systemd service: /home/lin/.config/systemd/user/openclaw-gateway.service
Previous unit backed up to: /home/lin/.config/systemd/user/openclaw-gateway.service.bak
```

### 6. Restart the gateway

After doctor rewrote the unit:

```bash
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw gateway restart
```

Observed:

- systemd service restarted successfully
- the gateway came back listening on `127.0.0.1:18789`

### 7. Verify the running service

Verification commands:

```bash
cat ~/.config/systemd/user/openclaw-gateway.service
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw gateway status
systemctl --user show -p MainPID,ActiveState,SubState openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 40 --no-pager
```

Success criteria:

- `ExecStart` points to `/mnt/sda1/github/openclaw/dist/index.js`
- `openclaw gateway status` shows the same command line
- service is `active/running`
- `RPC probe: ok`

## What Changed Conceptually

Before the change:

- source edits in `/mnt/sda1/github/openclaw` did not affect the live gateway
- the systemd service was pinned to the global npm package payload

After the change:

- the global `openclaw` command resolves to the repository-linked install
- the gateway service runs the repository build under `dist/`
- rebuilding the repository and restarting the service is enough to test source fixes locally

## Current Caveat

Even after the switch, the service still uses Node from an nvm-managed path:

```bash
/home/lin/.nvm/versions/node/v24.14.0/bin/node
```

`openclaw doctor` still warns about this because:

- system Node 22+ is not installed in a stable non-version-manager path
- future upgrades may break if the nvm path changes

This is not what blocked the source-code switch, but it remains an operational risk.

## Recommended Repeatable Procedure

When working on OpenClaw source fixes locally on this machine, use this sequence:

```bash
cd /mnt/sda1/github/openclaw
corepack pnpm install
pnpm build
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw gateway restart
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw gateway status
```

If the service ever drifts back to another entrypoint, run:

```bash
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw doctor --repair --yes
```

Then re-check:

```bash
cat ~/.config/systemd/user/openclaw-gateway.service
```

## Fast Verification Checklist

Use this to quickly confirm future repairs are actually running from source:

```bash
PATH="/home/lin/.local/share/pnpm:$PATH" which openclaw
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw --version
cat ~/.config/systemd/user/openclaw-gateway.service
PATH="/home/lin/.local/share/pnpm:$PATH" openclaw gateway status
```

Expected indicators:

- global binary under `~/.local/share/pnpm/openclaw`
- service `ExecStart` points to `/mnt/sda1/github/openclaw/dist/index.js`
- status command shows the same `Command:`
- `RPC probe: ok`

## Why This Matters for Future Bug Fixes

If a bug fix is applied only in repository source but the live service still uses a global package path, testing will appear inconsistent:

- repository tests may pass
- repository files may contain the fix
- but Telegram/QQ/runtime behavior will still reflect the old installed code

This verification step should always be completed before concluding that a runtime fix "didn't work".
