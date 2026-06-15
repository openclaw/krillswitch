import { describe, expect, it } from "vitest";
import { flag, flagAll, parseArgs } from "../src/args";
import { resolveConfig } from "../src/config";

describe("parseArgs", () => {
  it("splits positionals, valued flags, and booleans with aliases", () => {
    const args = parseArgs([
      "flags",
      "list",
      "--project",
      "clawhub",
      "-e",
      "development",
      "--json",
    ]);
    expect(args.positionals).toEqual(["flags", "list"]);
    expect(flag(args, "project")).toBe("clawhub");
    expect(flag(args, "env")).toBe("development");
    expect(args.booleans.has("json")).toBe(true);
  });

  it("supports --flag=value and repeated flags", () => {
    const args = parseArgs([
      "eval",
      "--attr=role=admin",
      "--attr",
      "tier=gold",
    ]);
    expect(flagAll(args, "attr")).toEqual(["role=admin", "tier=gold"]);
  });

  it("treats a trailing valueless flag as boolean", () => {
    const args = parseArgs(["flags", "toggle", "souls", "--off"]);
    expect(args.positionals).toEqual(["flags", "toggle", "souls"]);
    expect(args.booleans.has("off")).toBe(true);
  });
});

describe("resolveConfig precedence", () => {
  const noFile = { KRILLSWITCH_CONFIG: "/does/not/exist.json" };

  it("prefers flags over env and defaults the base URL", () => {
    const args = parseArgs(["projects", "list", "--token", "ksat_flag"]);
    const config = resolveConfig(args, {
      ...noFile,
      KRILLSWITCH_TOKEN: "ksat_env",
    });
    expect(config.token).toBe("ksat_flag");
    expect(config.baseUrl).toBe("http://localhost:8799");
  });

  it("falls back to env vars", () => {
    const args = parseArgs(["projects", "list"]);
    const config = resolveConfig(args, {
      ...noFile,
      KRILLSWITCH_TOKEN: "ksat_env",
      KRILLSWITCH_URL: "https://krill.example",
    });
    expect(config.token).toBe("ksat_env");
    expect(config.baseUrl).toBe("https://krill.example");
  });

  it("leaves the token undefined when nothing supplies it", () => {
    const config = resolveConfig(parseArgs(["projects", "list"]), noFile);
    expect(config.token).toBeUndefined();
  });
});
