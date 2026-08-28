# @openclaw/krillswitch-core

Pure TypeScript feature-flag evaluation and shared wire contracts for
[Krill Switch](https://krillswitch.com).

Registry publication is pending. Until the package is minted, test it from the
workspace or a verified packed tarball.

```ts
import { evaluateFlag, type FlagConfig } from "@openclaw/krillswitch-core";

declare const flag: FlagConfig;

const result = evaluateFlag(flag, {
  key: "user-123",
  attributes: { plan: "pro" },
});
```

The package performs no I/O and has no framework dependency. For the full API
and evaluation order, see the
[Core SDK documentation](https://krillswitch.com/core-sdk.html).

## License

MIT © OpenClaw Foundation
