import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type CredentialStore,
  normalizeBaseUrl,
  systemCredentialStore,
  type TokenReference,
} from "./credentials";
import type { ConfigOptions } from "./options";

export type CliConfig = {
  baseUrl: string;
  token: string | undefined;
  accessClientId?: string;
  accessClientSecret?: string;
  accessOrigin?: string;
};

const DEFAULT_BASE_URL = "http://localhost:8799";
const DEFAULT_CLOUDFLARE_ACCESS_ORIGIN = "https://switch.openclaw.ai";

export function defaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}

export type ConfigFile = {
  token?: string;
  baseUrl?: string;
  tokenRef?: TokenReference;
};

export function configPathFromEnv(
  env: Record<string, string | undefined>,
): string {
  return env.KRILLSWITCH_CONFIG ?? join(homedir(), ".krillswitch.json");
}

export function readConfigFile(
  env: Record<string, string | undefined>,
): ConfigFile {
  const path = configPathFromEnv(env);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      token: stringProperty(parsed, "token"),
      baseUrl: stringProperty(parsed, "baseUrl"),
      tokenRef: tokenReferenceProperty(parsed),
    };
  } catch {
    // No config file, or an unreadable one, is normal when env/flags carry it.
    return {};
  }
}

function stringProperty(value: object, key: string): string | undefined {
  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === "string" ? property : undefined;
}

function objectProperty(value: object, key: string): object | undefined {
  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === "object" && property !== null
    ? property
    : undefined;
}

function tokenReferenceProperty(value: object): TokenReference | undefined {
  const tokenRef = objectProperty(value, "tokenRef");
  if (!tokenRef) return undefined;
  const kind = stringProperty(tokenRef, "kind");
  const service = stringProperty(tokenRef, "service");
  const account = stringProperty(tokenRef, "account");
  if (kind !== "keyring" || !service || !account) return undefined;
  return { kind, service, account };
}

export function writeConfigFile(path: string, config: ConfigFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Precedence for both fields: flag > env var > config file > default. */
export async function resolveConfig(
  options: ConfigOptions,
  env: Record<string, string | undefined>,
  credentialStore: CredentialStore = systemCredentialStore,
): Promise<CliConfig> {
  const file = readConfigFile(env);
  const keyringToken = file.tokenRef
    ? await credentialStore.getToken(file.tokenRef)
    : undefined;
  const baseUrl =
    options.baseUrl ?? env.KRILLSWITCH_URL ?? file.baseUrl ?? DEFAULT_BASE_URL;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    token: options.token ?? env.KRILLSWITCH_TOKEN ?? keyringToken ?? file.token,
    ...(env.KRILLSWITCH_CF_ACCESS_CLIENT_ID?.trim() ||
    env.KRILLSWITCH_CF_ACCESS_CLIENT_SECRET?.trim()
      ? {
          accessClientId: env.KRILLSWITCH_CF_ACCESS_CLIENT_ID?.trim(),
          accessClientSecret: env.KRILLSWITCH_CF_ACCESS_CLIENT_SECRET?.trim(),
          accessOrigin:
            env.KRILLSWITCH_CF_ACCESS_ORIGIN?.trim() ||
            DEFAULT_CLOUDFLARE_ACCESS_ORIGIN,
        }
      : {}),
  };
}
