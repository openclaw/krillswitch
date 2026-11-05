---
title: Admin console
description: Operate projects, environments, flags, access, and audit history from the dashboard.
---

# Admin console

The production console is served at `https://switch.openclaw.ai` by the same Worker that handles the management API. Cloudflare Access gates the hostname before Better Auth and KrillSwitch role checks run.

## Projects and environments

Admins create projects and environments, rotate evaluation keys, and delete environments. Editors and viewers can inspect the hierarchy but cannot alter these boundaries.

## Flags

The flag detail view manages:

- enabled state;
- typed variations;
- off and default variations;
- exact context-key targets;
- ordered attribute rules;
- deterministic percentage splits.

Edits are submitted as validated whole-state updates. The dashboard keeps a local draft until save and shows destructive actions on dedicated confirmation pages.

## Access

The Access area lists users and role grants, and lets admins mint or revoke CLI tokens. Plaintext access tokens are shown once and never stored.

## Change log

The change log supports project, flag, action, and actor inspection. Each detail page shows before/after values and stable actor attribution. Token mint/revoke entries contain token id, name, and role—never the plaintext credential.

## Webhooks

Settings lists each webhook's most recent delivery result. Each subscriber POST has a
two-second deadline; a slow subscriber records `timeout` and its current drain
stops so other subscribers can proceed. Delivery is notify-only: the attempted
entry is not retried, including after a timeout. Unattempted entries remain
queued for the next drain, which is triggered by an admin mutation.

New webhooks and replacement URLs must use HTTPS without URL credentials.
Private, loopback, link-local, metadata, and other non-global IP literals are
rejected. Hostnames are resolved through Cloudflare DNS over HTTPS (A and AAAA)
at creation, replacement, and before every delivery hop. Any non-global answer
blocks the destination. Each A or AAAA lookup also has a two-second deadline. Lookup failures or empty answers fail closed.

The Workers fetch API resolves the hostname again for the actual connection.
It neither exposes the peer IP nor provides general off-zone IP pinning with
the original TLS hostname. These DNS checks therefore **do not guarantee
protection against DNS rebinding** between the check and connection. A deployment
requiring that guarantee needs an egress service that validates or pins the
actual connection; this change does not add one.

Upgrades retain existing subscribers as legacy deliveries: public HTTP URLs and
redirecting subscribers continue to receive events. Each legacy row is reported
with a warning in Settings and in the admin API's `warnings` field. Legacy
redirects are followed manually for at most twenty hops, validating both the URL
and DNS answers before each hop. Blocked destinations record `blocked`; failed
DNS checks record `dns-error`. Neither advances the undelivered entry's cursor. DNS lookups and followed redirects count against the Worker subrequest budget; long chains or many subscribers may exhaust that runtime limit.
An earlier successful entry in the batch remains acknowledged.

Use **Replace URL** with a public HTTPS endpoint to migrate a legacy subscriber
to strict delivery. Replacement preserves queued entries and disables redirect
following; a strict subscriber's redirect records `redirect` and advances the
attempted entry as other notify-only delivery failures do. No subscriber is
silently disabled by this migration. This addresses the webhook boundary
raised in [#75](https://github.com/openclaw/krillswitch/pull/75) without adding a retry queue or an egress proxy.


## Development personas

Local mode offers admin, editor, viewer, and ungranted personas. Production never enables this route; it is guarded by both configuration and loopback-host checks.
