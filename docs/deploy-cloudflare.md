# Cloudflare Deployment

Krillswitch has two independently deployed Workers that share the same D1
database:

| Hostname | Purpose | Application authentication |
| --- | --- | --- |
| `flags.openclaw.ai` | `krillswitch-public`: public `POST /v1/eval` origin for SDKs | Environment eval key |
| `switch.openclaw.ai` | `krillswitch`: dashboard and `/admin/*` management API | GitHub session or `ksat_` token |

Eval keys identify a flag environment; they are intentionally usable by
browser SDKs. Better Auth, role grants, and admin tokens protect management
inside the Worker. The admin hostname does not use Cloudflare Access, so users
authenticate with GitHub only once.

Both hostnames use Cloudflare Worker Custom Domains. Wrangler creates their DNS records and certificates; do not add separate origin records for them.

When migrating from Worker Routes, delete any existing `A`, `AAAA`, or `CNAME` records for `flags.openclaw.ai` and `switch.openclaw.ai` before deploying these configurations. Cloudflare cannot create a Custom Domain while an externally managed record owns the same hostname. If both names return `NXDOMAIN`, there is nothing to remove.

## Cache Policy

Do not put shared HTTP or Cloudflare Cache API caching in front of evaluation
responses. A response is personalized by a context key and attributes, so
sharing it can leak a flag value between users and creates an unbounded cache
keyspace.

The Worker instead caches the environment configuration inside each isolate:

- a hot evaluation performs no I/O;
- entries expire after one second, which bounds cross-isolate flag propagation;
- invalid keys are cached briefly too, but the cache is LRU-bounded to 512
  entries so arbitrary bearer values cannot grow isolate memory indefinitely;
- a refresh begins at D1's primary and uses the same D1 session for the
  remaining reads, so replicas are only used after they can satisfy that
  bookmark;
- browser SDKs use ETags and local storage; responses send
  `Cache-Control: private, no-store`.

Static dashboard assets are immutable Vite assets and are served by Cloudflare
Assets only from the admin Worker. CORS preflight for the public eval route is
cached by browsers for one day.

## Prerequisites

The D1 database `krillswitch` already exists in the OpenClaw account. Before
the first deploy, make sure the deploy identity can manage Workers, D1, and
Worker Custom Domains in the `openclaw.ai` zone.

Set Worker secrets without placing them in git:

```sh
cd apps/api
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put BOOTSTRAP_ADMIN_EMAIL
```

Create the GitHub OAuth app callback at:

```text
https://switch.openclaw.ai/api/auth/callback/github
```

`BETTER_AUTH_URL` and `GITHUB_VIEWER_ORG` are non-secret production vars in
`wrangler.jsonc`. Never set `DEV_AUTH_ENABLED` in production.

## Remove legacy Cloudflare Access

Older deployments placed a Cloudflare Access application in front of the admin
hostname. Removing policy provisioning does not remove that external gate, so
the first admin deployment after this migration deletes the legacy application.

Set `KRILLSWITCH_ACCESS_APP_ID` to the exact legacy application id. The removal
script verifies the id, name, and root hostname before deletion and succeeds if
the application is already absent:

```sh
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
export KRILLSWITCH_ACCESS_APP_ID=...
pnpm cf:access:remove
```

The GitHub workflow runs this step only while the environment variable exists.
After a successful migration, remove `KRILLSWITCH_ACCESS_APP_ID` from the
`krillswitch-admin` environment. Future deployments then need only the normal
Workers and D1 permissions.

## Deploy And Verify

Use the manual `Deploy Cloudflare` workflow from `main` after setting
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Its
`public` target applies migrations and deploys only `krillswitch-public`. Its
`admin` target uses the `krillswitch-admin` GitHub Environment, builds and
deploys `krillswitch`, then removes the legacy Access application when
configured.

For an operator deploy, keep the public and admin paths separate:

```sh
pnpm deploy:public
pnpm deploy:admin
```

After deployment, verify the public evaluation boundary with a real eval key:

```sh
curl -i -X POST https://flags.openclaw.ai/v1/eval \
  -H 'Authorization: Bearer ks_...' \
  -H 'Content-Type: application/json' \
  -d '{"context":{"key":"smoke"}}'
```

The response must include `Cache-Control: private, no-store`, an `ETag`, and
`Server-Timing`. The admin dashboard must load without a Cloudflare Access
prompt, while an unauthenticated request to `/admin/me` returns `401`.
