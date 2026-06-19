import type { CliConfig } from "./config";

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
  constructor(private readonly config: CliConfig) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.config.token) {
      throw new CliError(
        "no access token: set KRILLSWITCH_TOKEN, pass --token, or add it to ~/.krillswitch.json",
      );
    }
    const accessHeaders = cloudflareAccessHeaders(this.config);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          ...accessHeaders,
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new CliError(
        `could not reach krillswitch at ${this.config.baseUrl}`,
      );
    }
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
    return response.json() as Promise<T>;
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
  return {
    "cf-access-client-id": accessClientId,
    "cf-access-client-secret": accessClientSecret,
  };
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
