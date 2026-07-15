---
title: Troubleshooting
description: Diagnose local startup, authentication, evaluation, targeting, CLI, and deployment failures.
---

# Troubleshooting

## Local dashboard does not start

Run `pnpm install --frozen-lockfile`, then `pnpm dev`. Port `8799` is intentional because `8787` commonly collides with other Workers. Remove only task-created local Wrangler state when you explicitly want a fresh database.

## Development personas are missing

They require `DEV_AUTH_ENABLED=1` and a loopback URL. `pnpm dev` copies `.dev.vars.example` on first run. A non-loopback hostname disables the persona endpoints even if the variable exists.

## Evaluation returns 401

- `missing_eval_key` — send `Authorization: Bearer ks_...`.
- `invalid_eval_key` — verify project/environment and rotate or copy the current key.
- Do not use a `ksat_` management token on `/v1/eval`.

## Evaluation returns the wrong variation

Check the returned reason. Confirm enabled state, exact context key, attribute types, rule order, rollout weights, and default variation. A target beats a rule; a rule beats a split.

## CLI cannot reach production

Production management needs both the KrillSwitch token and Cloudflare Access client credentials. Run `krillswitch config show` to inspect the redacted origin. A base-URL change intentionally clears the previous token reference.

## CLI shows old values

Read `flags get --json`, then evaluate with the same project, environment, context key, and attributes as the application. Server configuration propagates within one second; client polling may be slower.

## Dashboard gives no access

Cloudflare Access admission and a valid GitHub session are not role grants. Ask an existing admin to grant viewer, editor, or admin. Organization membership may resolve to viewer when `GITHUB_VIEWER_ORG` is configured.

## GitHub Pages HTTPS is pending

New custom-domain certificates appear only after public DNS points at GitHub Pages. Verify A/AAAA records and the repository custom domain first. HTTP may work while certificate issuance is still pending.

## Deployment routes fail

Confirm Wrangler is targeting OpenClaw account `91b59577e757131d68d55a471fe32aca`, both hostnames have proxied DNS in the `openclaw.ai` zone, and the deploy token can manage Workers, D1, routes, and Access where required.
