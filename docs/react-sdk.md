---
title: React SDK
description: Evaluate typed flags for SSR, hydrate without a variant flash, then refresh safely in the background.
---

# React SDK

This page documents the prepared package contract. The package has not been
published to npm yet; use the workspace or a verified packed tarball for
pre-release testing.

## Declare a manifest

```ts
// flag-manifest.ts — safe to import from server or browser code
export const flagManifest = {
  newNav: false,
  density: "comfortable",
  resultLimit: 25,
  searchTuning: { semantic: true },
};
```

```tsx
// flags.tsx — client bindings safe to import into Server Components
"use client";

import { createKrillswitch } from "@openclaw/krillswitch-react";
import { flagManifest } from "./flag-manifest";

export const { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } =
  createKrillswitch(flagManifest);
```

The manifest is both a type contract and the code-owned fallback. Literal primitives widen correctly: `false` becomes `boolean`, not the unusable literal type `false`.

Keep the factory call in this consumer-owned client module. React Server
Components can import and render the exported provider, but cannot call a
client-module function such as `createKrillswitch` themselves.

## Add the provider

```tsx
<FeatureFlagProvider
  evalKey="ks_project_production_..."
  baseUrl="https://flags.openclaw.ai"
  contextKey={user.id}
  attributes={{ role: user.role, plan: user.plan }}
>
  <App />
</FeatureFlagProvider>
```

Read one flag or the full typed set:

```tsx
const newNav = useFeatureFlag("newNav");
const allFlags = useFeatureFlags();
```

## Server rendering and hydration

Evaluate flags before rendering and pass the result to `initialValues` on both
the server render and the browser hydration render:

```tsx
import { createKrillswitchEvaluator } from "@openclaw/krillswitch-react/server";
import { flagManifest } from "./flag-manifest";
import { FeatureFlagProvider } from "./flags";

const evaluateFlags = createKrillswitchEvaluator(flagManifest);
const contextKey = getOrSetAnonymousCookie(request, response);
const evalKey = process.env.KRILLSWITCH_EVAL_KEY;
if (!evalKey) {
  throw new Error("KRILLSWITCH_EVAL_KEY is required");
}

const initialValues = await evaluateFlags({
  evalKey,
  baseUrl: "https://flags.openclaw.ai",
  context: {
    key: contextKey,
    attributes: { plan: currentUser?.plan ?? "anonymous" },
  },
  signal: AbortSignal.timeout(200),
})
  .catch((error: unknown) => {
    logger.warn({ error }, "KrillSwitch SSR evaluation failed");
    return null;
  });

<FeatureFlagProvider
  evalKey={evalKey}
  baseUrl="https://flags.openclaw.ai"
  contextKey={contextKey}
  attributes={{ plan: currentUser?.plan ?? "anonymous" }}
  initialValues={initialValues}
>
  <App />
</FeatureFlagProvider>;
```

Use your framework's normal server-data serialization so the browser receives
the same `initialValues`, `contextKey`, and attributes that produced the HTML.
The provider keeps those values through hydration and while its first refresh
is pending, so visible UI does not flash from code defaults to the evaluated
variant. A successful refresh becomes the new value and is persisted normally.

The `/server` entry point does not import React or access the DOM or browser
storage, including under the `react-server` condition used by React Server
Components. `evaluateFlags` returns the complete manifest-shaped value set:
missing, undeclared, and wrong-typed remote values cannot replace code defaults.
Network, HTTP, abort, and malformed-response failures are thrown so applications
can log or measure them. Keep the SSR wait bounded (about 200 ms is a practical
starting point). Pass `null` after a failed SSR evaluation to bootstrap code
defaults on both the server and browser; omitting `initialValues` preserves the
client-only behavior of using matching browser cache when available.

## Runtime behavior

- The first render uses cached values for the exact identity and attributes, or manifest defaults.
- Server-provided `initialValues` take priority over browser cache until refresh succeeds.
- A background request refreshes values on mount.
- The provider polls every 60 seconds by default and refreshes when the page becomes visible.
- ETags turn unchanged polls into `304 Not Modified` responses.
- Last-known values are scoped by eval key, context key, and serialized attributes.
- A changed identity never flashes values from the previous identity.
- Unreachable service, invalid JSON, and storage failures keep rendering safe local values.

Set `pollIntervalMs` when your application needs a different cadence. KrillSwitch configuration itself propagates within one second, but clients decide how often to ask.

## Anonymous contexts

If `contextKey` is omitted in the browser, the SDK persists an anonymous UUID.
SSR evaluation requires an explicit context key. For signed-out visitors,
persist a random identifier in a first-party cookie and use that same value for
`evaluateFlags` and the browser provider. Browser local storage is not available
to the server, and using different identities can produce different rollout or
targeting results.

## Value safety

Remote keys not declared in the manifest are ignored. Primitive remote values must match the manifest type. JSON-kind defaults accept any valid JSON value.
