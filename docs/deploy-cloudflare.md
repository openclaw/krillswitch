# Cloudflare Deployment

Krillswitch has two independently deployed Workers that share the same D1
database:

| Hostname | Purpose | Cloudflare Access |
| --- | --- | --- |
| `flags.openclaw.ai` | `krillswitch-public`: public `POST /v1/eval` origin for SDKs | Never |
| `switch.openclaw.ai` | `krillswitch`: dashboard and `/admin/*` management API | Required |

The public host must remain outside Cloudflare Access. Eval keys identify a
flag environment; they are intentionally usable by browser SDKs. The admin
host is defense in depth around Better Auth, role grants, and admin tokens.
Cloudflare Access does not replace the application's authorization checks.

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

## Cloudflare Access

Use a Cloudflare API token with Zero Trust Access application and policy write
permission, in addition to the deploy scopes. The normal local Wrangler OAuth
token can deploy Workers and D1 but may not administer Access.

The provisioning script is idempotent and only manages the `Krillswitch Admin`
application plus its named policies:

```sh
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
export KRILLSWITCH_ACCESS_ALLOWED_DOMAINS=openclaw.ai
pnpm cf:access
```

After the first successful provisioning run, set
`KRILLSWITCH_ACCESS_APP_ID` as a GitHub Actions repository or environment
variable. Subsequent runs use that immutable Cloudflare Access application id
and refuse partial name or root-hostname matches. `KRILLSWITCH_ACCESS_HOST`
must be a root hostname; path-scoped Access applications are intentionally not
managed by this deploy flow.

For non-browser CLI/agent access, create an Access service token in Cloudflare,
pass its token id to the provisioning script, and set the client credentials
only in the caller environment:

```sh
export KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS=...
pnpm cf:access

export KRILLSWITCH_CF_ACCESS_CLIENT_ID=...
export KRILLSWITCH_CF_ACCESS_CLIENT_SECRET=...
```

The CLI sends those service-token headers alongside its Krillswitch admin
token only to `https://switch.openclaw.ai`; set
`KRILLSWITCH_CF_ACCESS_ORIGIN` to use a different HTTPS Access hostname. They
satisfy the edge gate only; the Worker still enforces the token's editor/viewer
role. An omitted service-token list preserves the existing automation policy
during later admin deploys. To deliberately revoke all automation service
tokens, set
`KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS=1` with no token ids.

## Deploy And Verify

Use the manual `Deploy Cloudflare` workflow from `main` after setting
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Its
`public` target applies migrations and deploys only `krillswitch-public`, so
public evaluation does not depend on Cloudflare Access administration. Its
`admin` target uses the `krillswitch-admin` GitHub Environment, provisions
Cloudflare Access before the route can be deployed, builds the dashboard, and
deploys `krillswitch`.

For an operator deploy, keep the public and admin paths separate:

```sh
pnpm deploy:public
# Requires an Access application/policy write token.
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
`Server-Timing`. An unauthenticated request to `https://switch.openclaw.ai/`
must redirect to, or be denied by, Cloudflare Access. The public
`flags.openclaw.ai` evaluation route must never redirect to Access.
