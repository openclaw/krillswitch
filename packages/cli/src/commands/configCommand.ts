import type { Writable } from "node:stream";
import {
  type ConfigFile,
  configPathFromEnv,
  defaultBaseUrl,
  readConfigFile,
  writeConfigFile,
} from "../config";
import {
  type CredentialStore,
  normalizeBaseUrl,
  systemCredentialStore,
  tokenReferenceForBaseUrl,
} from "../credentials";
import { CliUsageError } from "../errors";
import type { CommonOptions } from "../options";
import { printJson, printKeyValues, wantsJson } from "../output";

export async function configShow(
  options: CommonOptions,
  env: Record<string, string | undefined>,
  credentialStore: CredentialStore = systemCredentialStore,
  output: Writable = process.stdout,
): Promise<void> {
  const configPath = configPathFromEnv(env);
  const config = readConfigFile(env);
  const baseUrl = config.baseUrl ?? defaultBaseUrl();
  const tokenStatus = await storedTokenStatus(config, credentialStore);

  if (wantsJson(options)) {
    printJson({
      configPath,
      baseUrl,
      token: tokenStatus,
      tokenRef: config.tokenRef ?? null,
    });
    return;
  }

  printKeyValues(
    "Config",
    [
      ["api", baseUrl],
      ["config", configPath],
      ["token", tokenStatus],
    ],
    { output },
  );
}

export async function configSet(
  options: CommonOptions,
  env: Record<string, string | undefined>,
  credentialStore: CredentialStore = systemCredentialStore,
  output: Writable = process.stdout,
): Promise<void> {
  if (!options.baseUrl && !options.token) {
    throw new CliUsageError(
      [
        "config set needs --base-url or --token",
        "Example: krillswitch config set --base-url http://localhost:8799",
        "Example: krillswitch config set --token <ksat_...>",
      ].join("\n"),
    );
  }

  const configPath = configPathFromEnv(env);
  const previous = readConfigFile(env);
  const baseUrl = options.baseUrl
    ? normalizeBaseUrl(options.baseUrl)
    : (previous.baseUrl ?? defaultBaseUrl());
  const next: ConfigFile = { ...previous, baseUrl };

  if (options.baseUrl && previous.tokenRef?.account !== baseUrl) {
    delete next.token;
    delete next.tokenRef;
  }

  if (options.token) {
    const tokenRef = tokenReferenceForBaseUrl(baseUrl);
    await credentialStore.setToken(tokenRef, options.token);
    delete next.token;
    next.tokenRef = tokenRef;
  }

  writeConfigFile(configPath, next);

  if (wantsJson(options)) {
    printJson({
      configPath,
      baseUrl: next.baseUrl ?? null,
      tokenRef: next.tokenRef ?? null,
    });
    return;
  }

  printKeyValues(
    "Config updated",
    [
      ["api", baseUrl],
      ["config", configPath],
      ["token", next.tokenRef ? "OS secure storage" : "not configured"],
    ],
    { output },
  );
}

async function storedTokenStatus(
  config: ConfigFile,
  credentialStore: CredentialStore,
): Promise<string> {
  if (config.tokenRef) {
    return (await credentialStore.getToken(config.tokenRef))
      ? "OS secure storage"
      : "missing from OS secure storage";
  }
  return config.token ? "config file (legacy plaintext)" : "not configured";
}
