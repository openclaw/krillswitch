---
title: Auth and roles
description: Understand Cloudflare Access, Better Auth sessions, grants, and role boundaries.
---

# Auth and roles

## Defense in depth

Production management uses three independent gates:

1. Cloudflare Access protects the admin hostname.
2. A verified Cloudflare Access JWT, a Better Auth GitHub-backed session, or a
   `ksat_` bearer token establishes the application actor.
3. KrillSwitch resolves the actor's role and authorizes the specific route.

Passing Access does not bypass KrillSwitch roles. A valid Access identity or
session without a role sees the no-access state.

## Roles

| Capability | Admin | Editor | Viewer | No grant |
| --- | --- | --- | --- | --- |
| Read flags and change log | Yes | Yes | Yes | No |
| Change flags and targeting | Yes | Yes | No | No |
| Create projects/environments | Yes | No | No | No |
| Rotate evaluation keys | Yes | No | No | No |
| Manage roles and tokens | Yes | No | No | No |

Access tokens support only editor and viewer roles. There is no token-admin path.

## Bootstrap admin

The first production admin is selected with the `BOOTSTRAP_ADMIN_EMAIL` Worker
secret. After bootstrap, admins manage grants from the dashboard.

## GitHub organization viewers

`GITHUB_VIEWER_ORG=openclaw` allows a signed-in organization member with no
explicit grant to resolve as a viewer. When the admin hostname is protected by
Cloudflare Access, the Access policy proves membership before the request
reaches KrillSwitch. When Better Auth GitHub OAuth is used instead, membership
is checked during sign-in using the user's GitHub token.

## Session and token actors

All authenticated management requests resolve to one actor shape. Audit entries distinguish session users from access tokens and preserve the human-readable actor name.
