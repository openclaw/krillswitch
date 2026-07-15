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

## Development personas

Local mode offers admin, editor, viewer, and ungranted personas. Production never enables this route; it is guarded by both configuration and loopback-host checks.
