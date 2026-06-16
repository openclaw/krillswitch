#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type BaseContext,
  Cli,
  Command,
  type CommandClass,
  Option,
} from "clipanion";
import {
  resolveFixedChoice,
  resolveFlagChoice,
  resolveProjectChoice,
  resolveProjectEnvChoice,
} from "./choices";
import { CliError, KrillswitchClient } from "./client";
import { configSet, configShow } from "./commands/configCommand";
import { evalContext } from "./commands/evalCommand";
import {
  flagsCreate,
  flagsGet,
  flagsList,
  flagsTargetingSet,
  flagsToggle,
} from "./commands/flags";
import { logTail } from "./commands/log";
import { onboard } from "./commands/onboard";
import { projectsList } from "./commands/projects";
import { resolveConfig } from "./config";
import { CliUsageError } from "./errors";
import type { CommonOptions, ProjectEnvOptions } from "./options";
import { printTextBlock } from "./output";

const BINARY_NAME = "krillswitch";
const BINARY_LABEL = "krillswitch: manage feature flags from the terminal";
const HELP_LINES = [
  "manage feature flags from the terminal.",
  "",
  "Start here",
  "  krillswitch onboard",
  "  krillswitch config set --base-url <url> --token <ksat_...>",
  "",
  "Commands",
  "  krillswitch onboard",
  "      Store the API URL and access token for future commands.",
  "  krillswitch config show",
  "      Show local CLI configuration without printing secrets.",
  "  krillswitch config set",
  "      --base-url <url> --token <ksat_...>",
  "      Update local CLI configuration.",
  "  krillswitch projects list",
  "      List projects.",
  "  krillswitch list <project> <env>",
  "      List flags in an environment. Alias for flags list.",
  "  krillswitch flags list <project> <env>",
  "      List flags in an environment. Also accepts -p <project> -e <env>.",
  "  krillswitch flags get <key> -p <project> -e <env>",
  "      Show one flag.",
  "  krillswitch flags toggle <key> -p <project> -e <env>",
  "      --on|--off",
  "      Turn one flag on or off.",
  "  krillswitch flags create <key> -p <project>",
  "      --kind <boolean|string|number|json>",
  "      Create a flag.",
  "  krillswitch flags targeting set <key>",
  "      -p <project> -e <env> --targeting '<json>'",
  "      Replace a flag's targeting spec.",
  "  krillswitch eval -p <project> -e <env>",
  "      -k <contextKey>",
  "      Evaluate flags for one context.",
  "  krillswitch log tail",
  "      Show recent admin changelog entries.",
  "  krillswitch completion <zsh|bash|fish>",
  "      Print shell completion setup.",
  "  krillswitch completion install <zsh|bash|fish>",
  "      Install shell completion into the local shell config.",
  "",
  "Common options",
  "  --json",
  "      Print machine-readable JSON.",
  "  --token <ksat_...>",
  "      Override the onboarded token for one command.",
  "  --base-url <url>",
  "      Override the onboarded API URL for one command.",
];
const PROJECT_COMMAND_LINES = [
  "projects needs a command",
  "",
  "Available",
  "  krillswitch projects list",
];
const CONFIG_COMMAND_LINES = [
  "config needs a command",
  "",
  "Available",
  "  krillswitch config show",
  "  krillswitch config set --base-url <url>",
  "  krillswitch config set --token <ksat_...>",
];
const FLAG_COMMAND_LINES = [
  "flags needs a command",
  "",
  "Available",
  "  krillswitch flags list <project> <env>",
  "  krillswitch flags get <key>",
  "  krillswitch flags toggle <key> --on|--off",
  "  krillswitch flags create <key> --kind <boolean|string|number|json>",
  "  krillswitch flags targeting set <key> --targeting '<json>'",
];
const FLAG_KIND_CHOICES = [
  { key: "boolean" },
  { key: "string" },
  { key: "number" },
  { key: "json" },
];
const TOGGLE_STATE_CHOICES = [{ key: "on" }, { key: "off" }];
const COMPLETION_SHELLS = ["zsh", "bash", "fish"];
const COMPLETION_BLOCK_START = "# >>> krillswitch completion >>>";
const COMPLETION_BLOCK_END = "# <<< krillswitch completion <<<";

abstract class KrillswitchCommand extends Command {
  json = Option.Boolean("--json", false, {
    description: "Print machine-readable JSON output",
  });
  token = Option.String("--token", {
    description: "Access token; overrides KRILLSWITCH_TOKEN",
  });
  baseUrl = Option.String("--base-url", {
    description: "API base URL; overrides KRILLSWITCH_URL",
  });

  protected commonOptions(): CommonOptions {
    return {
      json: this.json,
      token: this.token,
      baseUrl: this.baseUrl,
    };
  }

  protected async client(): Promise<KrillswitchClient> {
    return new KrillswitchClient(
      await resolveConfig(this.commonOptions(), this.context.env),
    );
  }

  protected async runWithClient(
    action: (client: KrillswitchClient) => Promise<void>,
  ): Promise<number> {
    return this.runGuarded(async () => {
      await action(await this.client());
    });
  }

  protected async runWithOptions<T>(
    buildOptions: () => T,
    action: (client: KrillswitchClient, options: T) => Promise<void>,
  ): Promise<number> {
    return this.runGuarded(async () => {
      const options = buildOptions();
      await action(await this.client(), options);
    });
  }

  protected async runGuarded(action: () => Promise<void>): Promise<number> {
    try {
      await action();
      return 0;
    } catch (error: unknown) {
      if (error instanceof CliUsageError) {
        printTextBlock(error.title, error.message.split("\n"), {
          marker: "✕",
          output: this.context.stderr,
        });
        return 1;
      }
      if (error instanceof CliError) {
        printTextBlock("Request failed", [error.message], {
          marker: "✕",
          output: this.context.stderr,
        });
        return error.exitCode;
      }
      if (error instanceof Error) {
        printTextBlock("Unexpected error", [error.message], {
          marker: "✕",
          output: this.context.stderr,
        });
        return 1;
      }
      printTextBlock("Unexpected error", [String(error)], {
        marker: "✕",
        output: this.context.stderr,
      });
      return 1;
    }
  }
}

abstract class ProjectEnvCommand extends KrillswitchCommand {
  project = Option.String("--project,-p", {
    description: "Project key",
  });
  env = Option.String("--env,-e", {
    description: "Environment key",
  });

  protected async resolveProjectEnvOptions(
    client: KrillswitchClient,
    commandName: string,
    syntax: string,
    project = this.project,
    env = this.env,
  ): Promise<ProjectEnvOptions> {
    const required = await resolveProjectEnvChoice(client, {
      commandName,
      syntax,
      project,
      env,
      json: this.json,
      io: {
        stdin: this.context.stdin,
        stdout: this.context.stdout,
      },
    });
    return {
      ...this.commonOptions(),
      ...required,
    };
  }

  protected async runWithProjectEnv(
    commandName: string,
    syntax: string,
    action: (
      client: KrillswitchClient,
      options: ProjectEnvOptions,
    ) => Promise<void>,
    project = this.project,
    env = this.env,
  ): Promise<number> {
    return this.runGuarded(async () => {
      const client = await this.client();
      const options = await this.resolveProjectEnvOptions(
        client,
        commandName,
        syntax,
        project,
        env,
      );
      await action(client, options);
    });
  }
}

class HelpCommand extends Command {
  static paths = [Command.Default, ["help"], ["--help"], ["-h"]];

  async execute(): Promise<number> {
    printTextBlock(BINARY_NAME, HELP_LINES, { output: this.context.stdout });
    return 0;
  }
}

class CompletionCommand extends Command {
  static paths = [["completion"]];
  static usage = Command.Usage({
    description: "Print shell completion setup",
  });

  shell = Option.String({ name: "shell", required: false });

  async execute(): Promise<number> {
    const shell = this.shell;
    if (!isCompletionShell(shell)) {
      printTextBlock(
        "Completion",
        [
          "completion needs a shell",
          `Available shells: ${COMPLETION_SHELLS.join(", ")}`,
          "Usage: krillswitch completion <zsh|bash|fish>",
        ],
        { marker: "✕", output: this.context.stderr },
      );
      return 1;
    }

    this.context.stdout.write(completionScript(shell));
    return 0;
  }
}

class CompletionInstallCommand extends Command {
  static paths = [["completion", "install"]];
  static usage = Command.Usage({
    description: "Install shell completion into the local shell config",
  });

  shell = Option.String({ name: "shell", required: false });
  rcFile = Option.String("--rc-file", {
    description: "Shell config file to update",
  });

  async execute(): Promise<number> {
    const shell = this.shell;
    if (!isCompletionShell(shell)) {
      printTextBlock(
        "Completion",
        [
          "completion install needs a shell",
          `Available shells: ${COMPLETION_SHELLS.join(", ")}`,
          "Usage: krillswitch completion install <zsh|bash|fish>",
        ],
        { marker: "✕", output: this.context.stderr },
      );
      return 1;
    }

    const target = this.rcFile ?? defaultCompletionRcFile(shell);
    const result = installCompletion(shell, target, completionBinary());
    printTextBlock(
      "Completion",
      [
        result.installed
          ? `Installed ${shell} completion in ${target}.`
          : `${shell} completion is already installed in ${target}.`,
        "Open a new shell, or source the config file in this shell.",
      ],
      { output: this.context.stdout },
    );
    return 0;
  }
}

class InternalCompleteCommand extends Command {
  static paths = [["__complete"]];

  cword = Option.String({ name: "cword" });
  words = Option.Rest({ name: "word" });

  async execute(): Promise<number> {
    const cword = Number.parseInt(this.cword, 10);
    const cli = createCli();
    const completions = completionCandidates(
      cli.suggest.bind(cli),
      Number.isFinite(cword) ? cword : this.words.length,
      this.words,
    );
    for (const completion of completions) {
      this.context.stdout.write(`${completion}\n`);
    }
    return 0;
  }
}

class ProjectsListCommand extends KrillswitchCommand {
  static paths = [["projects", "list"]];
  static usage = Command.Usage({
    description: "List projects",
  });

  async execute(): Promise<number> {
    return this.runWithClient((client) =>
      projectsList(client, this.commonOptions()),
    );
  }
}

class ProjectsCommand extends Command {
  static paths = [["projects"]];

  async execute(): Promise<number> {
    printTextBlock("Projects", PROJECT_COMMAND_LINES, {
      marker: "✕",
      output: this.context.stderr,
    });
    return 1;
  }
}

class ConfigCommand extends Command {
  static paths = [["config"]];

  async execute(): Promise<number> {
    printTextBlock("Config", CONFIG_COMMAND_LINES, {
      marker: "✕",
      output: this.context.stderr,
    });
    return 1;
  }
}

class ConfigShowCommand extends KrillswitchCommand {
  static paths = [["config", "show"]];
  static usage = Command.Usage({
    description: "Show local CLI configuration",
  });

  async execute(): Promise<number> {
    return this.runGuarded(() =>
      configShow(
        this.commonOptions(),
        this.context.env,
        undefined,
        this.context.stdout,
      ),
    );
  }
}

class ConfigSetCommand extends KrillswitchCommand {
  static paths = [["config", "set"]];
  static usage = Command.Usage({
    description: "Update local CLI configuration",
  });

  async execute(): Promise<number> {
    return this.runGuarded(() =>
      configSet(
        this.commonOptions(),
        this.context.env,
        undefined,
        this.context.stdout,
      ),
    );
  }
}

class FlagsCommand extends Command {
  static paths = [["flags"]];

  async execute(): Promise<number> {
    printTextBlock("Flags", FLAG_COMMAND_LINES, {
      marker: "✕",
      output: this.context.stderr,
    });
    return 1;
  }
}

class FlagsListCommand extends ProjectEnvCommand {
  static paths = [["flags", "list"], ["list"]];
  static usage = Command.Usage({
    description: "List flags in an environment",
  });

  projectArg = Option.String({ name: "project", required: false });
  envArg = Option.String({ name: "env", required: false });

  async execute(): Promise<number> {
    const rootAlias = this.path[0] === "list";
    const commandName = rootAlias ? "list" : "flags list";
    const syntax = rootAlias
      ? "krillswitch list <project> <env>"
      : "krillswitch flags list <project> <env>";
    return this.runWithProjectEnv(
      commandName,
      syntax,
      (client, options) => flagsList(client, options),
      this.project ?? this.projectArg,
      this.env ?? this.envArg,
    );
  }
}

class FlagsGetCommand extends ProjectEnvCommand {
  static paths = [["flags", "get"]];
  static usage = Command.Usage({
    description: "Show one flag",
  });

  flagKey = Option.String({ name: "key", required: false });

  async execute(): Promise<number> {
    return this.runGuarded(async () => {
      const client = await this.client();
      const options = await this.resolveProjectEnvOptions(
        client,
        "flags get",
        "krillswitch flags get <key> -p <project> -e <env>",
      );
      const flagKey = await resolveFlagChoice(client, {
        commandName: "flags get",
        syntax: "krillswitch flags get <key> -p <project> -e <env>",
        project: options.project,
        env: options.env,
        flagKey: this.flagKey,
        json: this.json,
        io: {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      });
      await flagsGet(client, options, flagKey);
    });
  }
}

class FlagsToggleCommand extends ProjectEnvCommand {
  static paths = [["flags", "toggle"]];
  static usage = Command.Usage({
    description: "Turn one flag on or off",
  });

  flagKey = Option.String({ name: "key", required: false });
  on = Option.Boolean("--on", false, {
    description: "Enable the flag",
  });
  off = Option.Boolean("--off", false, {
    description: "Disable the flag",
  });

  async execute(): Promise<number> {
    return this.runGuarded(async () => {
      const client = await this.client();
      const options = await this.resolveProjectEnvOptions(
        client,
        "flags toggle",
        "krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
      );
      const flagKey = await resolveFlagChoice(client, {
        commandName: "flags toggle",
        syntax:
          "krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
        project: options.project,
        env: options.env,
        flagKey: this.flagKey,
        json: this.json,
        io: {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      });
      const state = await resolveToggleState({
        commandName: "flags toggle",
        syntax:
          "krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
        on: this.on,
        off: this.off,
        json: this.json,
        io: {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      });
      await flagsToggle(
        client,
        {
          ...options,
          on: state === "on",
          off: state === "off",
        },
        flagKey,
      );
    });
  }
}

class FlagsCreateCommand extends KrillswitchCommand {
  static paths = [["flags", "create"]];
  static usage = Command.Usage({
    description: "Create a flag",
  });

  flagKey = Option.String({ name: "key", required: false });
  project = Option.String("--project,-p", {
    description: "Project key",
  });
  kind = Option.String("--kind", {
    description: "Flag kind: boolean, string, number, or json",
  });
  name = Option.String("--name", {
    description: "Display name",
  });
  variations = Option.Array("--variation", [], {
    description: "Variation value; may be repeated",
  });
  defaultIndex = Option.String("--default-index", {
    description: "Default variation index",
  });
  offIndex = Option.String("--off-index", {
    description: "Off variation index",
  });
  enabled = Option.Boolean("--enabled", false, {
    description: "Create the flag enabled",
  });

  async execute(): Promise<number> {
    return this.runGuarded(async () => {
      const flagKey = requireOption(
        this.flagKey,
        "flags create",
        "<key>",
        "krillswitch flags create <key> -p <project> --kind <boolean|string|number|json>",
        "Flag keys are new. Pass the key you want to create, for example cli-banner.",
      );
      const client = await this.client();
      const project = await resolveProjectChoice(client, {
        commandName: "flags create",
        syntax:
          "krillswitch flags create <key> -p <project> --kind <boolean|string|number|json>",
        project: this.project,
        json: this.json,
        io: {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      });
      const required = {
        project,
        kind:
          this.kind ??
          (await resolveFixedChoice({
            commandName: "flags create",
            missingOption: "--kind",
            syntax:
              "krillswitch flags create <key> -p <project> --kind <boolean|string|number|json>",
            label: "kind",
            choices: FLAG_KIND_CHOICES,
            json: this.json,
            io: {
              stdin: this.context.stdin,
              stdout: this.context.stdout,
            },
          })),
      };
      await flagsCreate(
        client,
        {
          ...this.commonOptions(),
          project: required.project,
          kind: required.kind,
          name: this.name,
          variations: this.variations,
          defaultIndex: this.defaultIndex,
          offIndex: this.offIndex,
          enabled: this.enabled,
        },
        flagKey,
      );
    });
  }
}

class FlagsTargetingSetCommand extends ProjectEnvCommand {
  static paths = [["flags", "targeting", "set"]];
  static usage = Command.Usage({
    description: "Replace a flag's targeting spec",
  });

  flagKey = Option.String({ name: "key", required: false });
  targeting = Option.String("--targeting", {
    description: "Targeting JSON",
  });

  async execute(): Promise<number> {
    return this.runGuarded(async () => {
      const client = await this.client();
      const projectEnvOptions = await this.resolveProjectEnvOptions(
        client,
        "flags targeting set",
        "krillswitch flags targeting set <key> -p <project> -e <env> --targeting '<json>'",
      );
      const flagKey = await resolveFlagChoice(client, {
        commandName: "flags targeting set",
        syntax:
          "krillswitch flags targeting set <key> -p <project> -e <env> --targeting '<json>'",
        project: projectEnvOptions.project,
        env: projectEnvOptions.env,
        flagKey: this.flagKey,
        json: this.json,
        io: {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      });
      const options = {
        ...projectEnvOptions,
        targeting: requireOption(
          this.targeting,
          "flags targeting set",
          "--targeting",
          "krillswitch flags targeting set <key> -p <project> -e <env> --targeting '<json>'",
          'Example: --targeting \'{"allowlist":[{"variationIndex":0,"contextKeys":["user_123"]}]}\'',
        ),
      };
      await flagsTargetingSet(client, options, flagKey);
    });
  }
}

class EvalCommand extends ProjectEnvCommand {
  static paths = [["eval"]];
  static usage = Command.Usage({
    description: "Evaluate flags for one context",
  });

  key = Option.String("--key,-k", {
    description: "Context key",
  });
  attrs = Option.Array("--attr", [], {
    description: "Context attribute in key=value form; may be repeated",
  });

  async execute(): Promise<number> {
    return this.runWithProjectEnv(
      "eval",
      "krillswitch eval -p <project> -e <env> -k <contextKey>",
      (client, projectEnvOptions) =>
        evalContext(client, {
          ...projectEnvOptions,
          key: requireOption(
            this.key,
            "eval",
            "--key",
            "krillswitch eval -p <project> -e <env> -k <contextKey>",
            "Use the context key to evaluate, for example user_123.",
          ),
          attrs: this.attrs,
        }),
    );
  }
}

class LogTailCommand extends KrillswitchCommand {
  static paths = [["log", "tail"]];
  static usage = Command.Usage({
    description: "Show recent admin changelog entries",
  });

  flagKey = Option.String("--flag", {
    description: "Flag key filter",
  });
  project = Option.String("--project,-p", {
    description: "Project key filter",
  });
  limit = Option.String("--limit", {
    description: "Maximum rows to print",
  });

  async execute(): Promise<number> {
    return this.runWithClient((client) =>
      logTail(client, {
        ...this.commonOptions(),
        flagKey: this.flagKey,
        project: this.project,
        limit: this.limit,
      }),
    );
  }
}

class OnboardCommand extends KrillswitchCommand {
  static paths = [["onboard"]];
  static usage = Command.Usage({
    description: "Store local CLI configuration",
  });

  skipVerify = Option.Boolean("--skip-verify", false, {
    description: "Store config without checking the API first",
  });

  async execute(): Promise<number> {
    return this.runGuarded(() =>
      onboard(
        {
          ...this.commonOptions(),
          skipVerify: this.skipVerify,
        },
        this.context.env,
        undefined,
        {
          stdin: this.context.stdin,
          stdout: this.context.stdout,
        },
      ),
    );
  }
}

const COMMANDS: CommandClass[] = [
  HelpCommand,
  CompletionCommand,
  CompletionInstallCommand,
  InternalCompleteCommand,
  OnboardCommand,
  ConfigCommand,
  ConfigShowCommand,
  ConfigSetCommand,
  ProjectsCommand,
  ProjectsListCommand,
  FlagsCommand,
  FlagsListCommand,
  FlagsGetCommand,
  FlagsToggleCommand,
  FlagsCreateCommand,
  FlagsTargetingSetCommand,
  EvalCommand,
  LogTailCommand,
];

function requireOption(
  value: string | undefined,
  commandName: string,
  optionName: string,
  syntax?: string,
  hint?: string,
): string {
  if (value) return value;
  throw new CliUsageError(
    [
      `${commandName} needs ${optionName}`,
      ...(hint ? [hint] : []),
      ...(syntax ? [`Usage: ${syntax}`] : []),
    ].join("\n"),
  );
}

async function resolveToggleState(input: {
  commandName: string;
  syntax: string;
  on: boolean;
  off: boolean;
  json: boolean;
  io: {
    stdin: BaseContext["stdin"];
    stdout: BaseContext["stdout"];
  };
}): Promise<"on" | "off"> {
  if (input.on !== input.off) {
    return input.on ? "on" : "off";
  }
  if (input.on && input.off) {
    throw new CliUsageError(
      [
        `${input.commandName} needs exactly one of --on / --off`,
        `Usage: ${input.syntax}`,
      ].join("\n"),
    );
  }
  const state = await resolveFixedChoice({
    commandName: input.commandName,
    missingOption: "--on or --off",
    syntax: input.syntax,
    label: "state",
    choices: TOGGLE_STATE_CHOICES,
    json: input.json,
    io: input.io,
  });
  return state === "on" ? "on" : "off";
}

function isCompletionShell(shell: string | undefined): shell is string {
  return shell !== undefined && COMPLETION_SHELLS.includes(shell);
}

function defaultCompletionRcFile(shell: string): string {
  if (shell === "zsh") return join(homedir(), ".zshrc");
  if (shell === "bash") return join(homedir(), ".bashrc");
  return join(homedir(), ".config", "fish", "conf.d", "krillswitch.fish");
}

function installCompletion(
  shell: string,
  rcFile: string,
  binary: string,
): { installed: boolean } {
  const current = readFileIfExists(rcFile);
  const next = upsertCompletionBlock(
    current,
    completionInstallBlock(shell, binary),
  );
  if (next === current) return { installed: false };

  mkdirSync(dirname(rcFile), { recursive: true });
  writeFileSync(rcFile, next, { mode: 0o600 });
  return { installed: true };
}

function completionBinary(): string {
  return (
    process.env.KRILLSWITCH_COMPLETION_BIN ?? process.argv[1] ?? BINARY_NAME
  );
}

function readFileIfExists(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function upsertCompletionBlock(current: string, block: string): string {
  const pattern = new RegExp(
    `${escapeRegExp(COMPLETION_BLOCK_START)}[\\s\\S]*?${escapeRegExp(COMPLETION_BLOCK_END)}\\n?`,
  );
  const withTrailingNewline =
    current === "" || current.endsWith("\n") ? current : `${current}\n`;
  const nextBlock = `${block}\n`;
  if (pattern.test(current)) {
    return current.replace(pattern, nextBlock);
  }
  return `${withTrailingNewline}${nextBlock}`;
}

function completionInstallBlock(shell: string, binary: string): string {
  const lines =
    shell === "zsh"
      ? zshCompletionScript(binary).trimEnd().split("\n")
      : shell === "bash"
        ? bashCompletionScript(binary).trimEnd().split("\n")
        : fishCompletionScript(binary).trimEnd().split("\n");

  return [COMPLETION_BLOCK_START, ...lines, COMPLETION_BLOCK_END].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function completionScript(shell: string): string {
  if (shell === "zsh") return zshCompletionScript(BINARY_NAME);
  if (shell === "bash") return bashCompletionScript(BINARY_NAME);
  return fishCompletionScript(BINARY_NAME);
}

function zshCompletionScript(binary: string): string {
  const command = shellQuote(binary);
  const words = "$" + "{words[@]:1}";
  const splitStart = "$" + '{(f)"';
  const splitEnd = '"}';
  return [
    "#compdef krillswitch",
    "_krillswitch() {",
    "  local -a completions",
    `  completions=(${splitStart}$(${command} __complete $((CURRENT - 1)) -- ${words})${splitEnd})`,
    "  compadd -- $completions",
    "}",
    "compdef _krillswitch krillswitch",
    "",
  ].join("\n");
}

function bashCompletionScript(binary: string): string {
  const command = shellQuote(binary);
  const current = "$" + "{COMP_WORDS[COMP_CWORD]}";
  const words = "$" + "{COMP_WORDS[@]:1}";
  return [
    "_krillswitch() {",
    "  local cur completions",
    `  cur="${current}"`,
    `  completions="$(${command} __complete "$COMP_CWORD" -- "${words}")"`,
    '  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )',
    "}",
    "complete -o default -F _krillswitch krillswitch",
    "",
  ].join("\n");
}

function fishCompletionScript(binary: string): string {
  const command = shellQuote(binary);
  return [
    "function __krillswitch_complete",
    "  set -l tokens (commandline -opc)",
    "  set -l current (commandline -ct)",
    "  set -l words $tokens $current",
    "  set -l cword (math (count $words))",
    `  ${command} __complete $cword -- $words`,
    "end",
    "complete -c krillswitch -f -a '(__krillswitch_complete)'",
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function completionCandidates(
  suggest: (input: string[], partial: boolean) => string[][],
  cword: number,
  words: string[],
): string[] {
  const currentIndex = Math.max(0, Math.min(words.length - 1, cword - 1));
  const current = words[currentIndex] ?? "";
  const input = [...words.slice(0, currentIndex), current];
  let suggestions: string[][];
  try {
    suggestions = suggest(input, true);
  } catch {
    return [];
  }

  const completions = new Set<string>();
  for (const suggestion of suggestions) {
    const completion = completionFromSuggestion(current, suggestion);
    if (completion && completion !== "__complete") {
      completions.add(completion);
    }
  }
  return [...completions].sort();
}

function completionFromSuggestion(
  current: string,
  suggestion: string[],
): string | undefined {
  const first = suggestion[0];
  if (first === undefined) return undefined;
  if (first === "" && current.startsWith("-")) {
    return suggestion[1];
  }
  return `${current}${first}`;
}

export function createCli(): Cli {
  return Cli.from(COMMANDS, {
    binaryName: BINARY_NAME,
    binaryLabel: BINARY_LABEL,
    enableColors: false,
  });
}

export async function runCli(
  argv: string[],
  context: Partial<BaseContext> = {},
): Promise<number> {
  const cli = createCli();
  const runContext = {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    ...context,
  };
  try {
    const command = cli.process(argv, runContext);
    return await cli.run(command, runContext);
  } catch {
    printTextBlock("Command error", syntaxErrorLines(argv), {
      marker: "✕",
      output: runContext.stderr,
    });
    return 1;
  }
}

function syntaxErrorLines(argv: string[]): string[] {
  const command = argv.length > 0 ? ` ${argv.join(" ")}` : "";
  const syntax = syntaxFor(argv);
  if (!syntax) {
    return [
      `Command not found: ${BINARY_NAME}${command}`,
      "",
      "Run `krillswitch help` to see commands.",
    ];
  }
  return [
    `Invalid command: ${BINARY_NAME}${command}`,
    "",
    ...syntaxHelp(syntax),
  ];
}

function syntaxHelp(syntax: {
  primary: string;
  alternates: string[];
}): string[] {
  return [
    `Usage: ${syntax.primary}`,
    ...syntax.alternates.map((alternate) => `       ${alternate}`),
    "Run `krillswitch help` to see all commands.",
  ];
}

function syntaxFor(
  argv: string[],
): { primary: string; alternates: string[] } | undefined {
  const [first, second, third] = argv;
  if (first === "onboard") {
    return {
      primary: "krillswitch onboard [--base-url <url>] [--token <ksat_...>]",
      alternates: [],
    };
  }
  if (first === "completion") {
    if (second === "install") {
      return {
        primary: "krillswitch completion install <zsh|bash|fish>",
        alternates: [],
      };
    }
    return {
      primary: "krillswitch completion <zsh|bash|fish>",
      alternates: [],
    };
  }
  if (first === "config" && second === "show") {
    return { primary: "krillswitch config show", alternates: [] };
  }
  if (first === "config" && second === "set") {
    return {
      primary: "krillswitch config set [--base-url <url>] [--token <ksat_...>]",
      alternates: [],
    };
  }
  if (first === "projects" && second === "list") {
    return { primary: "krillswitch projects list", alternates: [] };
  }
  if (first === "list") {
    return {
      primary: "krillswitch list <project> <env>",
      alternates: ["krillswitch flags list <project> <env>"],
    };
  }
  if (first === "flags" && second === "list") {
    return {
      primary: "krillswitch flags list <project> <env>",
      alternates: ["krillswitch flags list -p <project> -e <env>"],
    };
  }
  if (first === "flags" && second === "get") {
    return {
      primary: "krillswitch flags get <key> -p <project> -e <env>",
      alternates: [],
    };
  }
  if (first === "flags" && second === "toggle") {
    return {
      primary:
        "krillswitch flags toggle <key> -p <project> -e <env> --on|--off",
      alternates: [],
    };
  }
  if (first === "flags" && second === "create") {
    return {
      primary:
        "krillswitch flags create <key> -p <project> --kind <boolean|string|number|json>",
      alternates: [],
    };
  }
  if (first === "flags" && second === "targeting" && third === "set") {
    return {
      primary:
        "krillswitch flags targeting set <key> -p <project> -e <env> --targeting '<json>'",
      alternates: [],
    };
  }
  if (first === "eval") {
    return {
      primary: "krillswitch eval -p <project> -e <env> -k <contextKey>",
      alternates: [],
    };
  }
  if (first === "log" && second === "tail") {
    return {
      primary: "krillswitch log tail [--flag <key>] [--project <key>]",
      alternates: [],
    };
  }
  return undefined;
}

process.exitCode = await runCli(process.argv.slice(2));
