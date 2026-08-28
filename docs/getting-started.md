---
title: Getting started
description: Run KrillSwitch locally, sign in with a development persona, and evaluate your first flag.
---

# Getting started

## Requirements

- Node.js 22.22 or newer
- Corepack and pnpm 11.24.0
- No Cloudflare account for local development

## Start the local stack

```sh
git clone https://github.com/openclaw/krillswitch.git
cd krillswitch
corepack pnpm install
pnpm dev
```

The command builds the dashboard, applies local D1 migrations, seeds a `clawhub` project, and starts the Worker at `http://localhost:8799`.

Open that URL and choose a development persona:

| Persona | Role | Use |
| --- | --- | --- |
| Admin | admin | Full management, roles, keys, projects |
| Editor | editor | Read and change flags |
| Viewer | viewer | Read-only inspection |
| No grant | none | Access-denied behavior |

Development personas are loopback-only. They are never enabled by the production configuration.

## Evaluate the seeded flag

```sh
EVAL_KEY=ks_clawhub_development_local
curl -sS -X POST http://localhost:8799/v1/eval \
  -H "Authorization: Bearer ${EVAL_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"context":{"key":"some-user"}}'
```

```json
{
  "flags": {
    "souls": {
      "value": true,
      "variationId": "var_souls_on",
      "reason": { "kind": "default" }
    }
  }
}
```

## Make a change

Sign in as the admin or editor persona, open the `clawhub` project, choose the development environment, and toggle `souls`. The next evaluation reflects the change. Open the change log to see the actor and before/after state.

## Use the CLI

Build the local executable, then onboard it against the local API:

```sh
pnpm --dir packages/cli build
node packages/cli/dist/index.js onboard \
  --base-url http://localhost:8799 \
  --token ksat_...
```

Mint the `ksat_...` access token from **Access → Access tokens** in the dashboard. Continue with the [CLI guide](cli.md).

## Next

- Learn the [flag model](flag-model.md).
- Add deterministic [targeting](targeting.md).
- Integrate the [React SDK](react-sdk.md) or [HTTP API](api.md).
