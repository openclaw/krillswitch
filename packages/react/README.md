# @openclaw/krillswitch-react

Typed React feature flags for [Krill Switch](https://krillswitch.com), including
server evaluation and hydration bootstrap without a variant flash.

Registry publication is pending. Until the package is minted, test it from the
workspace or a verified packed tarball.

```tsx
// flags.tsx
"use client";

import { createKrillswitch } from "@openclaw/krillswitch-react";

export const { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } =
  createKrillswitch({ newNav: false });

function Navigation() {
  return useFeatureFlag("newNav") ? <NewNav /> : <CurrentNav />;
}
```

Keep the factory call in a client module. React Server Components can import
and render the exported provider, but cannot call `createKrillswitch` directly.

Use `@openclaw/krillswitch-react/server` to evaluate the same manifest before
server rendering, then pass the result to `initialValues`. See the
[React SDK documentation](https://krillswitch.com/react-sdk.html) for the complete
provider and SSR examples.

## License

MIT © OpenClaw Foundation
