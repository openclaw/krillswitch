# @openclaw/krillswitch-react

Typed React feature flags for [Krill Switch](https://krillswitch.com), including
server evaluation and hydration bootstrap without a variant flash.

```sh
npm install @openclaw/krillswitch-react
```

```tsx
import { createKrillswitch } from "@openclaw/krillswitch-react";

const flags = createKrillswitch({ newNav: false });

function Navigation() {
  return flags.useFeatureFlag("newNav") ? <NewNav /> : <CurrentNav />;
}
```

Use `@openclaw/krillswitch-react/server` to evaluate the same manifest before
server rendering, then pass the result to `initialValues`. See the
[React SDK documentation](https://krillswitch.com/react-sdk.html) for the complete
provider and SSR examples.

## License

MIT © OpenClaw Foundation
