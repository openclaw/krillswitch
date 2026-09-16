import type { CliConfig } from "./config";

/** Bound API calls so a silent base URL cannot hang the process. */
export const CLI_FETCH_TIMEOUT_MS = 30_000;

function validateTimeoutMs(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new CliError(
      "KRILLSWITCH_TIMEOUT_MS must be an integer between 0 and 2147483647 (0 disables the deadline)",
    );
  }
  return value;
}

function fetchTimeoutMsFromEnv(
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  const raw = env.KRILLSWITCH_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return validateTimeoutMs(Number(raw));
}

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export class KrillswitchClient {
  constructor(
    private readonly config: CliConfig,
    private readonly fetchTimeoutMs = fetchTimeoutMsFromEnv() ??
      CLI_FETCH_TIMEOUT_MS,
  ) {
    validateTimeoutMs(fetchTimeoutMs);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.config.token) {
      throw new CliError(
        "no access token: set KRILLSWITCH_TOKEN, pass --token, or add it to ~/.krillswitch.json",
      );
    }
    const accessHeaders = cloudflareAccessHeaders(this.config);
    const hasBody = options.body !== undefined;
    const signal =
      this.fetchTimeoutMs === 0
        ? undefined
        : AbortSignal.timeout(this.fetchTimeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          ...accessHeaders,
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
        signal,
      });
      if (response.status === 401) {
        throw new CliError("unauthorized: token missing, invalid, or revoked");
      }
      if (response.status === 403) {
        throw new CliError(
          "forbidden: this token's role cannot perform that action",
        );
      }
      if (!response.ok) {
        throw new CliError(await errorMessage(response, path));
      }
      return (await response.json()) as T;
    } catch (error) {
      if (signal?.aborted) {
        throw new CliError(
          `request to ${this.config.baseUrl} timed out after ${this.fetchTimeoutMs}ms`,
        );
      }
      if (response) throw error;
      throw new CliError(
        `could not reach krillswitch at ${this.config.baseUrl}`,
      );
    }
  }
}

function cloudflareAccessHeaders(config: CliConfig): Record<string, string> {
  const { accessClientId, accessClientSecret } = config;
  if (!accessClientId && !accessClientSecret) {
    return {};
  }
  if (!accessClientId || !accessClientSecret) {
    throw new CliError(
      "Cloudflare Access requires both KRILLSWITCH_CF_ACCESS_CLIENT_ID and KRILLSWITCH_CF_ACCESS_CLIENT_SECRET",
    );
  }
  if (!isTrustedAccessOrigin(config.baseUrl, config.accessOrigin)) {
    return {};
  }
  return {
    "cf-access-client-id": accessClientId,
    "cf-access-client-secret": accessClientSecret,
  };
}

function isTrustedAccessOrigin(
  baseUrl: string,
  accessOrigin = "https://switch.openclaw.ai",
): boolean {
  try {
    const target = new URL(baseUrl);
    const trusted = new URL(accessOrigin);
    return (
      target.protocol === "https:" &&
      trusted.protocol === "https:" &&
      target.origin === trusted.origin
    );
  } catch {
    return false;
  }
}

async function errorMessage(response: Response, path: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return `${body.error} (${path})`;
    }
  } catch {
    // fall through
  }
  return `request to ${path} failed with ${response.status}`;
}
