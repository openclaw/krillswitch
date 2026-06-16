import { CliError } from "./client";

export type TokenReference = {
  kind: "keyring";
  service: string;
  account: string;
};

export type CredentialStore = {
  getToken(ref: TokenReference): Promise<string | undefined>;
  setToken(ref: TokenReference, token: string): Promise<void>;
};

export const KEYRING_SERVICE = "krillswitch";

type KeyringModule = typeof import("@napi-rs/keyring");

async function loadKeyring(): Promise<KeyringModule> {
  try {
    return await import("@napi-rs/keyring");
  } catch {
    throw new CliError(
      "could not load OS keychain support: reinstall @openclaw/krillswitch-cli or pass --token",
    );
  }
}

function keyringError(action: "read" | "store"): CliError {
  return new CliError(
    `could not ${action} the access token in OS secure storage: pass --token for this run`,
  );
}

export const systemCredentialStore: CredentialStore = {
  async getToken(ref) {
    try {
      const { AsyncEntry } = await loadKeyring();
      return (
        (await new AsyncEntry(ref.service, ref.account).getPassword()) ??
        undefined
      );
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw keyringError("read");
    }
  },

  async setToken(ref, token) {
    try {
      const { AsyncEntry } = await loadKeyring();
      await new AsyncEntry(ref.service, ref.account).setPassword(token);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw keyringError("store");
    }
  },
};

export function tokenReferenceForBaseUrl(baseUrl: string): TokenReference {
  return {
    kind: "keyring",
    service: KEYRING_SERVICE,
    account: normalizeBaseUrl(baseUrl),
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.trim();
  }
}
