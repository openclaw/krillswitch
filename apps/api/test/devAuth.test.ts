import { describe, expect, it } from "vitest";
import { isDevPersonaAuthEnabled } from "../src/auth/devAuth";

const LOCAL_URL = "http://localhost:8799/admin/dev-login";

describe("isDevPersonaAuthEnabled", () => {
  it("requires the env opt-in", () => {
    expect(isDevPersonaAuthEnabled({}, LOCAL_URL)).toBe(false);
    expect(
      isDevPersonaAuthEnabled({ DEV_AUTH_ENABLED: "true" }, LOCAL_URL),
    ).toBe(false);
    expect(isDevPersonaAuthEnabled({ DEV_AUTH_ENABLED: "1" }, LOCAL_URL)).toBe(
      true,
    );
  });

  it("accepts a localhost base URL when the request host is a public route", () => {
    // `wrangler dev` serves the worker under its production route, so the
    // request URL is the public host even locally; the configured base URL is
    // what distinguishes a laptop from a deploy.
    const env = {
      DEV_AUTH_ENABLED: "1",
      BETTER_AUTH_URL: "http://localhost:8799",
    };
    expect(
      isDevPersonaAuthEnabled(env, "http://switch.openclaw.ai/admin"),
    ).toBe(true);
  });

  it("stays disabled when neither the request nor the base URL is local", () => {
    expect(
      isDevPersonaAuthEnabled(
        {
          DEV_AUTH_ENABLED: "1",
          BETTER_AUTH_URL: "https://switch.openclaw.ai",
        },
        "https://switch.openclaw.ai/admin",
      ),
    ).toBe(false);
  });

  it("requires a localhost request host even when the env opts in", () => {
    const env = { DEV_AUTH_ENABLED: "1" };
    expect(
      isDevPersonaAuthEnabled(env, "https://krillswitch.openclaw.ai/admin"),
    ).toBe(false);
    expect(isDevPersonaAuthEnabled(env, "not-a-url")).toBe(false);
    expect(isDevPersonaAuthEnabled(env, "http://127.0.0.1:8799/x")).toBe(true);
    expect(isDevPersonaAuthEnabled(env, "http://[::1]/x")).toBe(true);
  });
});
