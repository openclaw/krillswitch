import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { KrillswitchClient } from "../client";
import { configPathFromEnv, resolveConfig, writeConfigFile } from "../config";
import {
  type CredentialStore,
  normalizeBaseUrl,
  systemCredentialStore,
  tokenReferenceForBaseUrl,
} from "../credentials";
import { CliUsageError } from "../errors";
import type { OnboardOptions } from "../options";
import { printJson, printKeyValues, wantsJson } from "../output";

type OnboardIo = {
  stdin: Readable;
  stdout: Writable;
};

type RawModeInput = Readable & {
  isRaw: boolean;
  setRawMode(mode: boolean): void;
};

const DEFAULT_BASE_URL = "http://localhost:8799";

// The krill-toggle mark rendered from the logo art (body + legs on the left,
// the switch track with the round knob as the gap on the right).
const KRILL_ART = [
  "",
  "   ▄▄",
  "     ▀██▄▄▄▄▄▄▄",
  "  ▄▄    ▀▀██████      ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "   ▀▀▀███████████▄▄      ▀▀███████████████████████████████▄▄",
  " ▄▄▄▄▄███████████████▄   ▄▄   ▀▀█████████████████▀▀     ▀▀███▄",
  "   ▀█████████  ████████  ██▄ ▄▄▄ ▀▀████████████▀           ▀██▄",
  "   █████████████████████  ██  ███   ▀▀████████▀              ██▄",
  "   █████████████████████  ██  ████  ▄  ▀██████               ███",
  "   ██████▀█████████████  ▄██  ████  ██▄  ▀████               ███",
  "   ▀███▀ ▄██▀ ███▀████▀  ██▀ ▄████  ███▄   ▀██▄             ▄██▀",
  "    ▀██ ███▀ ███▀ ████  ▀██▄▄█████ ▄████  ▄  ▀█▄           ▄██▀",
  "     ▀▀ ███ ████ ████▀ ▄█████▀███ ▄█▀▀▀▀  ██▄  ▀█▄▄▄   ▄▄▄███▀",
  "        ▀██ ████ ▀█  ▄███▀▀ ▄▄████████▄  ▄  ▀    █████████▀▀",
  "",
  "   krillswitch · feature flags, straight from your terminal",
  "",
];

const emptyCredentialStore: CredentialStore = {
  async getToken() {
    return undefined;
  },
  async setToken() {
    throw new Error("not used");
  },
};

export async function onboard(
  options: OnboardOptions,
  env: Record<string, string | undefined>,
  credentialStore: CredentialStore = systemCredentialStore,
  io: OnboardIo = { stdin: process.stdin, stdout: process.stdout },
): Promise<void> {
  if (!wantsJson(options)) {
    io.stdout.write(`${KRILL_ART.join("\n")}\n`);
  }
  const existing = await resolveConfig(
    { baseUrl: undefined, token: undefined },
    env,
    emptyCredentialStore,
  );
  const prompted = await promptOnboardOptions(options, existing.baseUrl, io);
  const baseUrl = normalizeBaseUrl(prompted.baseUrl);
  const token = prompted.token;
  if (token.trim() === "") {
    throw new CliUsageError("onboard needs an access token");
  }

  if (!options.skipVerify) {
    await new KrillswitchClient({ baseUrl, token }).request("/admin/projects");
  }

  const tokenRef = tokenReferenceForBaseUrl(baseUrl);
  await credentialStore.setToken(tokenRef, token);
  const configPath = configPathFromEnv(env);
  writeConfigFile(configPath, { baseUrl, tokenRef });

  if (wantsJson(options)) {
    printJson({ configPath, baseUrl, tokenRef });
    return;
  }
  printKeyValues(
    "Onboarding complete",
    [
      ["api", baseUrl],
      ["config", configPath],
      ["token", "OS secure storage"],
    ],
    { output: io.stdout },
  );
}

async function promptOnboardOptions(
  options: OnboardOptions,
  existingBaseUrl: string | undefined,
  io: OnboardIo,
): Promise<{ baseUrl: string; token: string }> {
  if (options.baseUrl && options.token) {
    return { baseUrl: options.baseUrl, token: options.token };
  }

  const defaultBaseUrl = existingBaseUrl ?? DEFAULT_BASE_URL;
  if (!supportsRawMode(io.stdin)) {
    const answers = await readBufferedLines(io.stdin);
    let answerIndex = 0;
    let baseUrl = options.baseUrl;
    if (!baseUrl) {
      io.stdout.write(`Krillswitch URL (${defaultBaseUrl}): `);
      baseUrl = answerOrDefault(answers[answerIndex], defaultBaseUrl);
      answerIndex += 1;
    }
    let token = options.token;
    if (!token) {
      io.stdout.write("Access token: ");
      token = answers[answerIndex]?.trim() ?? "";
    }
    return { baseUrl, token };
  }

  return {
    baseUrl:
      options.baseUrl ??
      (await promptText(io, "Krillswitch URL", defaultBaseUrl)),
    token: options.token ?? (await promptSecret(io, "Access token")),
  };
}

async function readBufferedLines(input: Readable): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
}

function answerOrDefault(
  answer: string | undefined,
  defaultValue: string,
): string {
  const trimmed = answer?.trim() ?? "";
  return trimmed === "" ? defaultValue : trimmed;
}

async function questionWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`${label} (${defaultValue}): `);
  return answerOrDefault(answer, defaultValue);
}

async function promptText(
  io: OnboardIo,
  label: string,
  defaultValue: string,
): Promise<string> {
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  try {
    return await questionWithDefault(rl, label, defaultValue);
  } finally {
    rl.close();
  }
}

async function promptSecret(io: OnboardIo, label: string): Promise<string> {
  const input = io.stdin;
  if (!supportsRawMode(input)) {
    const rl = createInterface({ input, output: io.stdout });
    try {
      return (await rl.question(`${label}: `)).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    const chars: string[] = [];
    const wasRaw = input.isRaw;

    const finish = () => {
      cleanup();
      io.stdout.write("\n");
      resolve(chars.join("").trim());
    };
    const abort = () => {
      cleanup();
      io.stdout.write("\n");
      reject(new CliUsageError("onboard cancelled"));
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          abort();
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f") {
          if (chars.pop() !== undefined) {
            io.stdout.write("\b \b");
          }
          continue;
        }
        chars.push(char);
        io.stdout.write("*");
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };

    io.stdout.write(`${label}: `);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function supportsRawMode(input: Readable): input is RawModeInput {
  return "setRawMode" in input && typeof input.setRawMode === "function";
}
