---
title: CLI
description: Operate KrillSwitch from a terminal or coding agent with stable JSON output.
---

# CLI

## Design contract

The CLI is built for humans and agents. Every command supports `--json`, diagnostics go to stderr, and failures exit nonzero. Interactive terminals can choose projects and environments; non-interactive callers receive exact usage plus available keys.

## Install and build

The package is private until its go-live npm publication. Build it from the workspace:

```sh
pnpm --dir packages/cli build
node packages/cli/dist/index.js --help
```

## Onboard

Mint an editor or viewer token in the dashboard, then store it in OS secure storage:

```sh
krillswitch onboard \
  --base-url https://switch.openclaw.ai \
  --token ksat_...
```

Non-secret settings live in `~/.krillswitch.json`. The token lives in macOS Keychain, Windows Credential Manager, or the Linux keyring.

## Common commands

```sh
krillswitch projects list --json
krillswitch flags list -p clawhub -e production --json
krillswitch flags get souls -p clawhub -e production --json
krillswitch flags toggle souls -p clawhub -e production --off --json
krillswitch eval -p clawhub -e production -k user-123 --attr role=admin --json
krillswitch log tail --project clawhub --limit 75 --json
```

Use `krillswitch completion install zsh`, `bash`, or `fish` for persistent shell completion.

## Configuration precedence

Token: command flag → `KRILLSWITCH_TOKEN` → secure-storage reference → legacy plaintext config.

Base URL: command flag → `KRILLSWITCH_URL` → config file → `http://localhost:8799`.

Changing the stored base URL without a new token clears the old token reference. This prevents a credential minted for one origin from being sent to another.

## Cloudflare Access

The production admin host also requires a Cloudflare Access service token for non-browser automation:

```sh
export KRILLSWITCH_CF_ACCESS_CLIENT_ID=...
export KRILLSWITCH_CF_ACCESS_CLIENT_SECRET=...
krillswitch projects list --json
```

Those credentials satisfy only the edge gate. KrillSwitch still requires a valid editor or viewer access token.

## Roles

Viewer tokens read flags, projects, environments, and the change log. Editor tokens can also create and change flags. Tokens cannot create projects, manage environments, rotate eval keys, grant roles, or mint admin authority.

See [Access tokens](access-tokens.md) and [Auth and roles](auth-and-roles.md).
