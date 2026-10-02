import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config";

describe("token overrides with unavailable secure storage", () => {
  let dir: string;
  let configPath: string;
  const unavailable = new Error("secure storage unavailable");
  const credentialStore = {
    getToken: vi.fn(async () => {
      throw unavailable;
    }),
    setToken: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "krillswitch-token-precedence-"));
    configPath = join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: "https://krill.example",
        tokenRef: {
          kind: "keyring",
          service: "krillswitch",
          account: "https://krill.example",
        },
      }),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    {
      source: "flag",
      token: "ksat_flag",
      env: "ksat_env",
      expected: "ksat_flag",
    },
    {
      source: "environment",
      token: undefined,
      env: "ksat_env",
      expected: "ksat_env",
    },
    { source: "empty flag", token: "", env: "ksat_env", expected: "" },
  ])(
    "uses the $source without accessing secure storage",
    async ({ token, env, expected }) => {
      const config = await resolveConfig(
        { baseUrl: undefined, token },
        { KRILLSWITCH_CONFIG: configPath, KRILLSWITCH_TOKEN: env },
        credentialStore,
      );
      expect(config.token).toBe(expected);
      expect(credentialStore.getToken).not.toHaveBeenCalled();
    },
  );

  it("still reports secure-storage failure when no override is provided", async () => {
    await expect(
      resolveConfig(
        { baseUrl: undefined, token: undefined },
        { KRILLSWITCH_CONFIG: configPath },
        credentialStore,
      ),
    ).rejects.toBe(unavailable);
    expect(credentialStore.getToken).toHaveBeenCalledOnce();
  });
});
