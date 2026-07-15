---
title: React SDK
description: Render typed defaults immediately, then refresh flag values safely in the background.
---

# React SDK

## Declare a manifest

```tsx
import { createKrillswitch } from "@openclaw/krillswitch-react";

export const flags = createKrillswitch({
  newNav: false,
  density: "comfortable",
  resultLimit: 25,
  searchTuning: { semantic: true },
});
```

The manifest is both a type contract and the code-owned fallback. Literal primitives widen correctly: `false` becomes `boolean`, not the unusable literal type `false`.

## Add the provider

```tsx
<flags.FeatureFlagProvider
  evalKey="ks_project_production_..."
  baseUrl="https://flags.openclaw.ai"
  contextKey={user.id}
  attributes={{ role: user.role, plan: user.plan }}
>
  <App />
</flags.FeatureFlagProvider>
```

Read one flag or the full typed set:

```tsx
const newNav = flags.useFeatureFlag("newNav");
const allFlags = flags.useFeatureFlags();
```

## Runtime behavior

- The first render uses cached values for the exact identity and attributes, or manifest defaults.
- A background request refreshes values on mount.
- The provider polls every 60 seconds by default and refreshes when the page becomes visible.
- ETags turn unchanged polls into `304 Not Modified` responses.
- Last-known values are scoped by eval key, context key, and serialized attributes.
- A changed identity never flashes values from the previous identity.
- Unreachable service, invalid JSON, and storage failures keep rendering safe local values.

Set `pollIntervalMs` when your application needs a different cadence. KrillSwitch configuration itself propagates within one second, but clients decide how often to ask.

## Anonymous contexts

If `contextKey` is omitted in the browser, the SDK persists an anonymous UUID. During server rendering it uses the stable placeholder `anonymous`; provide an explicit identity when hydration consistency or rollout stability across devices matters.

## Value safety

Remote keys not declared in the manifest are ignored. Primitive remote values must match the manifest type. JSON-kind defaults accept any valid JSON value.
