---
title: Auth and roles
description: Understand GitHub sessions, access tokens, grants, and role boundaries.
---

# Auth and roles

## Authentication and authorization

Production management uses two actor paths:

1. Better Auth establishes a GitHub-backed human session, or a `ksat_` bearer token establishes an automation actor.
2. KrillSwitch resolves the actor's role and authorizes the specific route.

A valid GitHub session does not grant a KrillSwitch role. A user without an explicit grant or configured organization membership sees the no-access state.

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

The first production admin is selected with the `BOOTSTRAP_ADMIN_EMAIL` Worker secret. Use the approved OpenClaw deploy identity and a real GitHub OAuth application. After bootstrap, admins manage grants from the dashboard.

## GitHub organization viewers

`GITHUB_VIEWER_ORG=openclaw` allows a signed-in organization member with no explicit grant to resolve as a viewer. Membership is checked during sign-in using the user's GitHub token.

## Session and token actors

All authenticated management requests resolve to one actor shape. Audit entries distinguish session users from access tokens and preserve the human-readable actor name.
