import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProjectEnvChoice } from "../src/choices";
import { KrillswitchClient } from "../src/client";
import { configSet, configShow } from "../src/commands/configCommand";
import { onboard } from "../src/commands/onboard";
import { resolveConfig } from "../src/config";
import type { CredentialStore } from "../src/credentials";
import type { ConfigOptions } from "../src/options";
import { printTable, printTextBlock } from "../src/output";

type CliProcessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function ttyPassThrough(): PassThrough {
  const stream = new PassThrough();
  Object.defineProperty(stream, "isTTY", { value: true });
  Object.defineProperty(stream, "isRaw", { value: false, writable: true });
  Object.defineProperty(stream, "setRawMode", {
    value(mode: boolean) {
      Object.defineProperty(stream, "isRaw", {
        value: mode,
        writable: true,
      });
      return stream;
    },
  });
  return stream;
}

function captureTtyWritable(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
      );
      callback();
    },
  });
  Object.defineProperty(stream, "isTTY", { value: true });
  Object.defineProperty(stream, "columns", { value: 80 });
  Object.defineProperty(stream, "rows", { value: 24 });
  return {
    stream,
    text: () => chunks.join(""),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function withCliApi<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(`http://127.0.0.1:${address.port}`);
        return;
      }
      reject(new Error("test server did not bind to a TCP port"));
    });
  });

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function spawnCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<CliProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["src/index.ts", ...args], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        ...env,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 3000);

    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function flagDetailResponse(): object {
  return {
    flag: {
      key: "cli-banner",
      name: "CLI banner",
      kind: "string",
      description: null,
    },
    variations: [
      {
        id: "var_b1253af8-05ee-46c9-bc84-7eb1474f485b",
        value: "minimal",
        name: null,
      },
      {
        id: "var_4fd2a74e-0222-46c9-bc84-7eb1474f485b",
        value: "loud",
        name: null,
      },
    ],
    config: {
      enabled: true,
      offVariationId: "var_4fd2a74e-0222-46c9-bc84-7eb1474f485b",
      defaultVariationId: "var_b1253af8-05ee-46c9-bc84-7eb1474f485b",
      targets: [],
      rules: [],
      rollout: null,
    },
  };
}

describe("entrypoint", () => {
  it("prints help successfully without requiring auth", () => {
    const result = spawnSync("bun", ["src/index.ts", "--help"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("manage feature flags from the terminal");
    expect(result.stdout).toContain("krillswitch onboard");
    expect(result.stdout).toContain("krillswitch flags list <project> <env>");
    expect(result.stdout).not.toContain("#0");
    expect(result.stdout.indexOf("krillswitch onboard")).toBeLessThan(
      result.stdout.indexOf("krillswitch projects list"),
    );
    expect(result.stderr).toBe("");
  });

  it("prints a framed error when flags list is missing project and env", () => {
    const result = spawnSync("bun", ["src/index.ts", "flags", "list"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  No access token\n");
    expect(result.stderr).toContain("No access token is configured.");
    expect(result.stderr).toContain("Run: krillswitch onboard");
    expect(result.stderr).toContain(
      "Or:  krillswitch flags list <project> <env> --token <ksat_...>",
    );
    expect(result.stderr).not.toContain("can choose");
    expect(result.stderr).not.toContain("Could not list choices");
    expect(result.stderr).not.toContain("Usage:");
    expect(result.stderr).toContain("╭");
    expect(result.stderr).toContain("╰");
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("shows the project subcommand when only the group is provided", () => {
    const result = spawnSync("bun", ["src/index.ts", "projects"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  Projects\n");
    expect(result.stderr).toContain("projects needs a command");
    expect(result.stderr).toContain("Available");
    expect(result.stderr).toContain("krillswitch projects list");
    expect(result.stdout).toBe("");
  });

  it("completes partial root commands", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "__complete", "1", "--", "li"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
          KRILLSWITCH_COMPLETION_BIN: "/tmp/krillswitch-cli-bin/krillswitch",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("list\n");
    expect(result.stderr).toBe("");
  });

  it("completes nested subcommands", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "__complete", "2", "--", "flags", "l"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
          KRILLSWITCH_COMPLETION_BIN: "/tmp/krillswitch-cli-bin/krillswitch",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("list\n");
    expect(result.stderr).toBe("");
  });

  it("prints zsh completion setup", () => {
    const result = spawnSync("bun", ["src/index.ts", "completion", "zsh"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_krillswitch()");
    expect(result.stdout).toContain("compdef _krillswitch krillswitch");
    expect(result.stderr).toBe("");
  });

  it("installs zsh completion into an rc file once", () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const rcFile = join(dir, ".zshrc");
    writeFileSync(rcFile, "# existing config\n");

    const first = spawnSync(
      "bun",
      ["src/index.ts", "completion", "install", "zsh", "--rc-file", rcFile],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
          KRILLSWITCH_COMPLETION_BIN: "/tmp/krillswitch-cli-bin/krillswitch",
        },
      },
    );
    const second = spawnSync(
      "bun",
      ["src/index.ts", "completion", "install", "zsh", "--rc-file", rcFile],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
          KRILLSWITCH_COMPLETION_BIN: "/tmp/krillswitch-cli-bin/krillswitch",
        },
      },
    );

    const content = readFileSync(rcFile, "utf8");
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(content).toContain("# >>> krillswitch completion >>>");
    expect(content).toContain("/tmp/krillswitch-cli-bin/krillswitch");
    expect(content.match(/# >>> krillswitch completion >>>/g)?.length).toBe(1);
    expect(
      content.match(/\/tmp\/krillswitch-cli-bin\/krillswitch/g)?.length,
    ).toBe(1);
    expect(first.stdout).toContain("Installed zsh completion");
    expect(second.stdout).toContain("already installed");
  });

  it("explains how to recover when live choices cannot be listed", () => {
    const result = spawnSync("bun", ["src/index.ts", "flags", "list"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "ksat_test",
        KRILLSWITCH_URL: "http://127.0.0.1:9",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  API unavailable\n");
    expect(result.stderr).toContain(
      "Could not reach krillswitch at http://127.0.0.1:9.",
    );
    expect(result.stderr).toContain("Run: krillswitch onboard");
    expect(result.stderr).toContain(
      "Or:  krillswitch flags list <project> <env> --base-url <url>",
    );
    expect(result.stderr).not.toContain("can choose");
    expect(result.stderr).not.toContain("Could not list choices");
    expect(result.stderr).not.toContain("Usage:");
    expect(result.stdout).toBe("");
  });

  it("shows recovery when flags get cannot choose project and env", () => {
    const result = spawnSync("bun", ["src/index.ts", "flags", "get"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  No access token\n");
    expect(result.stderr).toContain("No access token is configured.");
    expect(result.stderr).toContain("Run: krillswitch onboard");
    expect(result.stderr).toContain(
      "Or:  krillswitch flags get <key> -p <project> -e <env> --token <ksat_...>",
    );
    expect(result.stderr).not.toContain("can choose");
    expect(result.stderr).not.toContain("Could not list choices");
    expect(result.stdout).toBe("");
  });

  it("lists available flags when a flag key is missing and project/env are known", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (
          req.url === "/admin/projects/clawhub/environments/development/flags"
        ) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              flags: [
                {
                  key: "souls",
                  name: "Souls",
                  kind: "boolean",
                  enabled: false,
                },
                {
                  key: "theme",
                  name: "Theme",
                  kind: "string",
                  enabled: true,
                },
              ],
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(
          ["flags", "get", "-p", "clawhub", "-e", "development"],
          {
            KRILLSWITCH_TOKEN: "ksat_test",
            KRILLSWITCH_URL: baseUrl,
            KRILLSWITCH_CONFIG: "/does/not/exist.json",
          },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("flags get needs <key>");
        expect(result.stderr).toContain(
          "Available flags in clawhub/development: souls, theme",
        );
        expect(result.stderr).toContain(
          "Usage: krillswitch flags get <key> -p <project> -e <env>",
        );
        expect(result.stderr).not.toContain("#0");
        expect(result.stdout).toBe("");
      },
    );
  });

  it("shows recovery when flags toggle cannot choose project and env", () => {
    const result = spawnSync("bun", ["src/index.ts", "flags", "toggle"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  No access token\n");
    expect(result.stderr).toContain("No access token is configured.");
    expect(result.stderr).toContain("Run: krillswitch onboard");
    expect(result.stderr).toContain(
      "Or:  krillswitch flags toggle <key> -p <project> -e <env> --on|--off --token <ksat_...>",
    );
    expect(result.stderr).not.toContain("can choose");
    expect(result.stderr).not.toContain("Could not list choices");
    expect(result.stdout).toBe("");
  });

  it("treats flags list positional project as a missing env error", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "flags", "list", "clawhub"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✕  No access token\n");
    expect(result.stderr).toContain("No access token is configured.");
    expect(result.stderr).toContain(
      "Or:  krillswitch flags list <project> <env> --token <ksat_...>",
    );
    expect(result.stderr).not.toContain("Usage:");
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("lists available environments when env is missing and auth is configured", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (req.url === "/admin/projects/clawhub") {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              project: { key: "clawhub", name: "ClawHub" },
              environments: [{ key: "development" }, { key: "production" }],
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(["flags", "list", "clawhub"], {
          KRILLSWITCH_TOKEN: "ksat_test",
          KRILLSWITCH_URL: baseUrl,
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("flags list needs --env");
        expect(result.stderr).toContain(
          "Available environments for clawhub: development, production",
        );
        expect(result.stderr).toContain(
          "Usage: krillswitch flags list <project> <env>",
        );
        expect(result.stderr).not.toContain("#0");
        expect(result.stdout).toBe("");
      },
    );
  });

  it("skips the project prompt when only one project is available", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer ksat_test",
        });
        if (String(input) === "http://krill.test/admin/projects") {
          return new Response(
            JSON.stringify({
              projects: [{ key: "clawhub", name: "ClawHub" }],
            }),
          );
        }
        if (String(input) === "http://krill.test/admin/projects/clawhub") {
          return new Response(
            JSON.stringify({
              project: { key: "clawhub", name: "ClawHub" },
              environments: [
                { key: "development", name: "Development" },
                { key: "production", name: "Production" },
              ],
            }),
          );
        }
        return new Response("{}", { status: 404 });
      },
    );
    const stdin = ttyPassThrough();
    const stdout = captureTtyWritable();
    const choice = resolveProjectEnvChoice(
      new KrillswitchClient({
        baseUrl: "http://krill.test",
        token: "ksat_test",
      }),
      {
        commandName: "flags get",
        syntax: "krillswitch flags get <key> -p <project> -e <env>",
        project: undefined,
        env: undefined,
        json: false,
        io: {
          stdin,
          stdout: stdout.stream,
        },
      },
    );

    setTimeout(() => {
      stdin.write("\r");
    }, 0);

    await expect(choice).resolves.toEqual({
      project: "clawhub",
      env: "development",
    });
    expect(stdout.text()).not.toContain("Project");
    expect(stdout.text()).toContain("Environment");
    expect(stdout.text()).toContain("development  Development");
    expect(stdout.text()).toContain("production  Production");
    expect(stdout.text()).not.toContain("Choose");
  });

  it("prints flag details as framed tables", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (
          req.url ===
          "/admin/projects/clawhub/environments/development/flags/cli-banner"
        ) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(flagDetailResponse()));
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(
          ["flags", "get", "cli-banner", "-p", "clawhub", "-e", "development"],
          {
            KRILLSWITCH_TOKEN: "ksat_test",
            KRILLSWITCH_URL: baseUrl,
            KRILLSWITCH_CONFIG: "/does/not/exist.json",
          },
        );

        const stdout = stripVTControlCharacters(result.stdout);
        expect(result.status).toBe(0);
        expect(stdout).toMatch(/^╭─ CLI banner /);
        expect(stdout).toContain("│ field │ value      │");
        expect(stdout).toContain("├───────┼────────────┤");
        expect(stdout).toContain("│ key   │ cli-banner │");
        expect(stdout).toContain("│ kind  │ string     │");
        expect(stdout).toContain("│ state │ on         │");
        expect(stdout).toContain("╭─ Variations ");
        expect(stdout).toContain("│ role    │ value   │");
        expect(stdout).toContain("├─────────┼─────────┤");
        expect(stdout).toContain("│ default │ minimal │");
        expect(stdout).toContain("│ off     │ loud    │");
        expect(stdout).not.toContain("🦐  CLI banner");
        expect(stdout).not.toContain("#  VALUE    ROLE");
        expect(stdout).not.toContain("var_b1253af8");
        expect(result.stderr).toBe("");
      },
    );
  });

  it("prints project lists as a framed table", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (req.url === "/admin/projects") {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              projects: [{ id: "proj_1", key: "clawhub", name: "ClawHub" }],
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(["projects", "list"], {
          KRILLSWITCH_TOKEN: "ksat_test",
          KRILLSWITCH_URL: baseUrl,
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        });

        const stdout = stripVTControlCharacters(result.stdout);
        expect(result.status).toBe(0);
        expect(stdout).toMatch(/^╭─ Projects /);
        expect(stdout).toContain("│ key     │ name    │");
        expect(stdout).toContain("├─────────┼─────────┤");
        expect(stdout).toContain("│ clawhub │ ClawHub │");
        expect(stdout).toContain("╰─────────┴─────────╯");
        expect(stdout).not.toContain("🦐  Projects");
        expect(stdout).not.toContain("KEY      NAME");
        expect(result.stderr).toBe("");
      },
    );
  });

  it("prints flag lists as a compact width-aware table", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (
          req.url === "/admin/projects/clawhub/environments/development/flags"
        ) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              flags: [
                {
                  key: "checkout-experiments-2026-q3-progressive-disclosure-variant-rollout-long-tail",
                  name: "Checkout progressive disclosure rollout",
                  kind: "boolean",
                  enabled: false,
                },
                {
                  key: "cli-banner",
                  name: "CLI banner",
                  kind: "string",
                  enabled: true,
                },
              ],
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(
          ["flags", "list", "-p", "clawhub", "-e", "development"],
          {
            KRILLSWITCH_TOKEN: "ksat_test",
            KRILLSWITCH_URL: baseUrl,
            KRILLSWITCH_CONFIG: "/does/not/exist.json",
            COLUMNS: "80",
          },
        );

        const stdout = stripVTControlCharacters(result.stdout);
        expect(result.status).toBe(0);
        expect(stdout).toMatch(/^╭─ Flags /);
        expect(stdout).toContain("key");
        expect(stdout).toContain("name");
        expect(stdout).toContain("kind");
        expect(stdout).toContain("state");
        expect(stdout).toContain("╭─ Flags ");
        expect(stdout).toContain("├");
        expect(stdout).toContain("╰");
        expect(stdout).toContain("│ key");
        expect(stdout).toContain("│ checkout-experiments-2026-… │");
        expect(stdout).toContain("Checkout progressive disclo…");
        expect(stdout).toContain("cli-banner");
        expect(stdout).toContain("CLI banner");
        expect(stdout).not.toContain("│  name");
        expect(result.stderr).toBe("");
      },
    );
  });

  it("supports list as a shorthand for flags list", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (
          req.url === "/admin/projects/clawhub/environments/development/flags"
        ) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              flags: [
                {
                  key: "cli-banner",
                  name: "CLI banner",
                  kind: "string",
                  enabled: true,
                },
              ],
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(["list", "clawhub", "development"], {
          KRILLSWITCH_TOKEN: "ksat_test",
          KRILLSWITCH_URL: baseUrl,
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        });

        const stdout = stripVTControlCharacters(result.stdout);
        expect(result.status).toBe(0);
        expect(stdout).toMatch(/^╭─ Flags /);
        expect(stdout).toContain("cli-banner");
        expect(result.stderr).toBe("");
      },
    );
  });

  it("prints flag toggle confirmation as a bordered result", async () => {
    await withCliApi(
      (req, res) => {
        expect(req.headers.authorization).toBe("Bearer ksat_test");
        if (
          req.method === "PATCH" &&
          req.url ===
            "/admin/projects/clawhub/environments/development/flags/cli-banner"
        ) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              flag: {
                key: "cli-banner",
                name: "CLI banner",
                kind: "string",
                enabled: false,
              },
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      },
      async (baseUrl) => {
        const result = await spawnCli(
          [
            "flags",
            "toggle",
            "cli-banner",
            "-p",
            "clawhub",
            "-e",
            "development",
            "--off",
          ],
          {
            KRILLSWITCH_TOKEN: "ksat_test",
            KRILLSWITCH_URL: baseUrl,
            KRILLSWITCH_CONFIG: "/does/not/exist.json",
          },
        );

        const stdout = stripVTControlCharacters(result.stdout);
        expect(result.status).toBe(0);
        expect(stdout).toMatch(/^╭─ Flag updated /);
        expect(stdout).toContain("│ key        │ state │");
        expect(stdout).toContain("├────────────┼───────┤");
        expect(stdout).toContain("│ cli-banner │ off   │");
        expect(stdout).not.toContain("🦐  Flag updated");
        expect(stdout).not.toContain("cli-banner: off");
        expect(result.stderr).toBe("");
      },
    );
  });

  it("uses color for TTY tables and error blocks", () => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", undefined);

    const stdout = captureTtyWritable();
    printTable(
      [{ key: "cli-banner", state: "on" }],
      [
        { header: "KEY", value: (row) => row.key },
        { header: "STATE", value: (row) => row.state },
      ],
      { title: "Flags", output: stdout.stream },
    );

    const stderr = captureTtyWritable();
    printTextBlock("API unavailable", ["Could not reach krillswitch."], {
      marker: "✕",
      output: stderr.stream,
    });

    expect(stdout.text()).toContain("\u001b[");
    expect(stdout.text()).toContain("\u001b[32m");
    expect(stderr.text()).toContain("\u001b[");
    expect(stderr.text()).toContain("\u001b[31m");
  });

  it("formats parser syntax errors without placeholder names", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "flags", "list", "clawhub", "development", "extra"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Invalid command: krillswitch flags list clawhub development extra",
    );
    expect(result.stderr).toContain(
      "Usage: krillswitch flags list <project> <env>",
    );
    expect(result.stderr).toContain("✕  Command error\n");
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("shows allowed values when a required option has a fixed set", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "flags", "create", "demo-flag", "-p", "clawhub"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("flags create needs --kind");
    expect(result.stderr).toContain(
      "Available kinds: boolean, string, number, json",
    );
    expect(result.stderr).toContain(
      "Usage: krillswitch flags create <key> -p <project> --kind <boolean|string|number|json>",
    );
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("explains missing free-form flag create inputs", () => {
    const missingKey = spawnSync("bun", ["src/index.ts", "flags", "create"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(missingKey.status).toBe(1);
    expect(missingKey.stderr).toContain("flags create needs <key>");
    expect(missingKey.stderr).toContain(
      "Flag keys are new. Pass the key you want to create, for example cli-banner.",
    );
    expect(missingKey.stdout).toBe("");

    const missingVariation = spawnSync(
      "bun",
      [
        "src/index.ts",
        "flags",
        "create",
        "demo-flag",
        "-p",
        "clawhub",
        "--kind",
        "string",
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(missingVariation.status).toBe(1);
    expect(missingVariation.stderr).toContain(
      "string flags need at least one --variation",
    );
    expect(missingVariation.stderr).toContain(
      "Example: krillswitch flags create demo-flag -p clawhub --kind string --variation minimal",
    );
    expect(missingVariation.stdout).toBe("");
  });

  it("shows available states when flags toggle is missing on or off", () => {
    const result = spawnSync(
      "bun",
      [
        "src/index.ts",
        "flags",
        "toggle",
        "cli-banner",
        "-p",
        "clawhub",
        "-e",
        "development",
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("flags toggle needs --on or --off");
    expect(result.stderr).toContain("Available states: on, off");
    expect(result.stderr).toContain(
      "Usage: krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
    );
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("shows usage when a required option has no live choices", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "eval", "-p", "clawhub", "-e", "development"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("eval needs --key");
    expect(result.stderr).toContain(
      "Use the context key to evaluate, for example user_123.",
    );
    expect(result.stderr).toContain(
      "Usage: krillswitch eval -p <project> -e <env> -k <contextKey>",
    );
    expect(result.stderr).not.toContain("#0");
    expect(result.stdout).toBe("");
  });

  it("explains missing targeting JSON", () => {
    const result = spawnSync(
      "bun",
      [
        "src/index.ts",
        "flags",
        "targeting",
        "set",
        "cli-banner",
        "-p",
        "clawhub",
        "-e",
        "development",
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          KRILLSWITCH_TOKEN: "",
          KRILLSWITCH_CONFIG: "/does/not/exist.json",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("flags targeting set needs --targeting");
    expect(result.stderr).toContain(
      'Example: --targeting \'{"allowlist":[{"variationIndex":0,"contextKeys":["user_123"]}]}\'',
    );
    expect(result.stderr).toContain(
      "Usage: krillswitch flags targeting set <key> -p <project> -e <env> --targeting '<json>'",
    );
    expect(result.stdout).toBe("");
  });

  it("builds a Node-runnable package binary", () => {
    const build = spawnSync("bun", ["run", "build"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    expect(build.status).toBe(0);

    const result = spawnSync("node", ["dist/index.js", "--help"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("manage feature flags from the terminal");
    expect(result.stderr).toBe("");

    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const shimPath = join(dir, "krillswitch");
    symlinkSync(
      join(new URL("..", import.meta.url).pathname, "dist/index.js"),
      shimPath,
    );
    const shimResult = spawnSync("node", [shimPath, "--help"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        KRILLSWITCH_TOKEN: "",
        KRILLSWITCH_CONFIG: "/does/not/exist.json",
      },
    });

    expect(shimResult.status).toBe(0);
    expect(shimResult.stdout).toContain(
      "manage feature flags from the terminal",
    );
    expect(shimResult.stderr).toBe("");
  });
});

describe("resolveConfig precedence", () => {
  const noFile = { KRILLSWITCH_CONFIG: "/does/not/exist.json" };
  const noFlags: ConfigOptions = { baseUrl: undefined, token: undefined };

  it("prefers flags over env and defaults the base URL", async () => {
    const config = await resolveConfig(
      { ...noFlags, token: "ksat_flag" },
      {
        ...noFile,
        KRILLSWITCH_TOKEN: "ksat_env",
      },
    );
    expect(config.token).toBe("ksat_flag");
    expect(config.baseUrl).toBe("http://localhost:8799");
  });

  it("falls back to env vars", async () => {
    const config = await resolveConfig(noFlags, {
      ...noFile,
      KRILLSWITCH_TOKEN: "ksat_env",
      KRILLSWITCH_URL: "https://krill.example",
    });
    expect(config.token).toBe("ksat_env");
    expect(config.baseUrl).toBe("https://krill.example");
  });

  it("reads an onboarded token reference from secure storage", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
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

    const credentialStore: CredentialStore = {
      async getToken(ref) {
        expect(ref).toEqual({
          kind: "keyring",
          service: "krillswitch",
          account: "https://krill.example",
        });
        return "ksat_keychain";
      },
      async setToken() {
        throw new Error("not used");
      },
    };

    const config = await resolveConfig(
      noFlags,
      { KRILLSWITCH_CONFIG: configPath },
      credentialStore,
    );
    expect(config.token).toBe("ksat_keychain");
    expect(config.baseUrl).toBe("https://krill.example");
  });

  it("leaves the token undefined when nothing supplies it", async () => {
    const config = await resolveConfig(noFlags, noFile);
    expect(config.token).toBeUndefined();
  });

  it("passes Cloudflare Access service-token credentials from the environment", async () => {
    const config = await resolveConfig(noFlags, {
      ...noFile,
      KRILLSWITCH_CF_ACCESS_CLIENT_ID: "service-client-id",
      KRILLSWITCH_CF_ACCESS_CLIENT_SECRET: "service-client-secret",
    });
    expect(config).toMatchObject({
      accessClientId: "service-client-id",
      accessClientSecret: "service-client-secret",
    });
  });
});

describe("Cloudflare Access service token", () => {
  it("sends service-token headers with the admin access token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await new KrillswitchClient({
      baseUrl: "https://switch.openclaw.ai",
      token: "ksat_test",
      accessClientId: "service-client-id",
      accessClientSecret: "service-client-secret",
    }).request("/admin/projects");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://switch.openclaw.ai/admin/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ksat_test",
          "cf-access-client-id": "service-client-id",
          "cf-access-client-secret": "service-client-secret",
        }),
      }),
    );
  });

  it("rejects a partial Cloudflare Access service-token configuration", async () => {
    await expect(
      new KrillswitchClient({
        baseUrl: "https://switch.openclaw.ai",
        token: "ksat_test",
        accessClientId: "service-client-id",
      }).request("/admin/projects"),
    ).rejects.toThrow(/requires both KRILLSWITCH_CF_ACCESS/);
  });
});

describe("config commands", () => {
  it("stores base URL changes in the config file", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");

    await configSet(
      {
        baseUrl: "https://krill.example/path",
        token: undefined,
        json: false,
      },
      { KRILLSWITCH_CONFIG: configPath },
      undefined,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );

    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      baseUrl: "https://krill.example",
    });
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("stores access tokens in secure storage without writing the secret", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ baseUrl: "https://krill.example" }),
    );
    const stored: { account: string; token: string }[] = [];
    const credentialStore: CredentialStore = {
      async getToken() {
        throw new Error("not used");
      },
      async setToken(ref, token) {
        stored.push({ account: ref.account, token });
      },
    };

    await configSet(
      {
        baseUrl: undefined,
        token: "ksat_secret",
        json: false,
      },
      { KRILLSWITCH_CONFIG: configPath },
      credentialStore,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );

    const content = readFileSync(configPath, "utf8");
    expect(content).not.toContain("ksat_secret");
    expect(JSON.parse(content)).toEqual({
      baseUrl: "https://krill.example",
      tokenRef: {
        kind: "keyring",
        service: "krillswitch",
        account: "https://krill.example",
      },
    });
    expect(stored).toEqual([
      { account: "https://krill.example", token: "ksat_secret" },
    ]);
  });

  it("clears mismatched token references when only the base URL changes", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: "https://old.example",
        tokenRef: {
          kind: "keyring",
          service: "krillswitch",
          account: "https://old.example",
        },
      }),
    );

    await configSet(
      {
        baseUrl: "https://new.example",
        token: undefined,
        json: false,
      },
      { KRILLSWITCH_CONFIG: configPath },
      undefined,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );

    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      baseUrl: "https://new.example",
    });
  });

  it("shows config without exposing the access token", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
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
    const credentialStore: CredentialStore = {
      async getToken() {
        return "ksat_secret";
      },
      async setToken() {
        throw new Error("not used");
      },
    };
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
        );
        callback();
      },
    });
    const chunks: string[] = [];

    await configShow(
      { baseUrl: undefined, token: undefined, json: false },
      { KRILLSWITCH_CONFIG: configPath },
      credentialStore,
      output,
    );

    const text = chunks.join("");
    expect(text).toContain("https://krill.example");
    expect(text).toContain("OS secure storage");
    expect(text).not.toContain("ksat_secret");
  });
});

describe("onboard", () => {
  it("stores the token in secure storage and keeps it out of the config file", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    const stored: { service: string; account: string; token: string }[] = [];
    const credentialStore: CredentialStore = {
      async getToken() {
        throw new Error("not used");
      },
      async setToken(ref, token) {
        stored.push({ service: ref.service, account: ref.account, token });
      },
    };

    await onboard(
      {
        baseUrl: "https://krill.example/path",
        token: "ksat_secret",
        json: false,
        skipVerify: true,
      },
      { KRILLSWITCH_CONFIG: configPath },
      credentialStore,
      {
        stdin: process.stdin,
        stdout: new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      },
    );

    const content = readFileSync(configPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    expect(content).not.toContain("ksat_secret");
    expect(parsed).toMatchObject({
      baseUrl: "https://krill.example",
      tokenRef: {
        kind: "keyring",
        service: "krillswitch",
        account: "https://krill.example",
      },
    });
    expect(stored).toEqual([
      {
        service: "krillswitch",
        account: "https://krill.example",
        token: "ksat_secret",
      },
    ]);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("prompts for base URL and token when flags are omitted", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    const stdin = new PassThrough();
    stdin.end("https://krill.example\nksat_prompted\n");
    const stored: { account: string; token: string }[] = [];
    const credentialStore: CredentialStore = {
      async getToken() {
        return undefined;
      },
      async setToken(ref, token) {
        stored.push({ account: ref.account, token });
      },
    };

    await Promise.race([
      onboard(
        {
          baseUrl: undefined,
          token: undefined,
          json: false,
          skipVerify: true,
        },
        { KRILLSWITCH_CONFIG: configPath },
        credentialStore,
        {
          stdin,
          stdout: new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          }),
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("onboard prompt timed out")), 250),
      ),
    ]);

    const content = readFileSync(configPath, "utf8");
    expect(content).not.toContain("ksat_prompted");
    expect(JSON.parse(content)).toMatchObject({
      baseUrl: "https://krill.example",
    });
    expect(stored).toEqual([
      { account: "https://krill.example", token: "ksat_prompted" },
    ]);
  });

  it("uses Cloudflare Access service-token credentials while verifying", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    const credentialStore: CredentialStore = {
      async getToken() {
        return undefined;
      },
      async setToken() {},
    };
    const fetchMock = vi.fn(async () => new Response('{"projects":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    await onboard(
      {
        baseUrl: "https://switch.openclaw.ai",
        token: "ksat_secret",
        json: false,
        skipVerify: false,
      },
      {
        KRILLSWITCH_CONFIG: configPath,
        KRILLSWITCH_CF_ACCESS_CLIENT_ID: "service-client-id",
        KRILLSWITCH_CF_ACCESS_CLIENT_SECRET: "service-client-secret",
      },
      credentialStore,
      {
        stdin: process.stdin,
        stdout: new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://switch.openclaw.ai/admin/projects",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ksat_secret",
          "cf-access-client-id": "service-client-id",
          "cf-access-client-secret": "service-client-secret",
        }),
      }),
    );
  });

  it("masks pasted access tokens in the interactive prompt", async () => {
    const dir = join(tmpdir(), `krillswitch-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.json");
    const stdin = ttyPassThrough();
    const stdout = captureTtyWritable();
    const stored: { account: string; token: string }[] = [];
    const credentialStore: CredentialStore = {
      async getToken() {
        return undefined;
      },
      async setToken(ref, token) {
        stored.push({ account: ref.account, token });
      },
    };

    const run = onboard(
      {
        baseUrl: "https://krill.example",
        token: undefined,
        json: false,
        skipVerify: true,
      },
      { KRILLSWITCH_CONFIG: configPath },
      credentialStore,
      {
        stdin,
        stdout: stdout.stream,
      },
    );

    setTimeout(() => {
      stdin.write("ksat_prompted\r");
    }, 0);

    await Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("onboard prompt timed out")), 250),
      ),
    ]);

    const text = stdout.text();
    expect(text).toContain(
      `Access token: ${"*".repeat("ksat_prompted".length)}`,
    );
    expect(text).not.toContain("ksat_prompted");
    expect(stored).toEqual([
      { account: "https://krill.example", token: "ksat_prompted" },
    ]);
  });
});
