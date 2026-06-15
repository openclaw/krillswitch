import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { flag, type ParsedArgs } from "./args";

export type CliConfig = {
  baseUrl: string;
  token: string | undefined;
};

const DEFAULT_BASE_URL = "http://localhost:8799";

type ConfigFile = { token?: string; baseUrl?: string };

function readConfigFile(env: NodeJS.ProcessEnv): ConfigFile {
  const path = env.KRILLSWITCH_CONFIG ?? join(homedir(), ".krillswitch.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const file = parsed as Record<string, unknown>;
    return {
      token: typeof file.token === "string" ? file.token : undefined,
      baseUrl: typeof file.baseUrl === "string" ? file.baseUrl : undefined,
    };
  } catch {
    // No config file (or unreadable) is normal — env/flags carry it.
    return {};
  }
}

/** Precedence for both fields: flag > env var > config file > default. */
export function resolveConfig(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
): CliConfig {
  const file = readConfigFile(env);
  return {
    baseUrl:
      flag(args, "base-url") ??
      env.KRILLSWITCH_URL ??
      file.baseUrl ??
      DEFAULT_BASE_URL,
    token: flag(args, "token") ?? env.KRILLSWITCH_TOKEN ?? file.token,
  };
}
