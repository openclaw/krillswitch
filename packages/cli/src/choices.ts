import type { Readable, Writable } from "node:stream";
import { isCancel, select } from "@clack/prompts";
import { CliError, type KrillswitchClient } from "./client";
import { CliUsageError } from "./errors";

type ChoiceIo = {
  stdin: Readable;
  stdout: Writable;
};

type Choice = {
  key: string;
  name?: string | null;
};

type ProjectEnvInput = {
  commandName: string;
  syntax: string;
  project: string | undefined;
  env: string | undefined;
  json: boolean;
  io: ChoiceIo;
};

type ProjectInput = {
  commandName: string;
  syntax: string;
  project: string | undefined;
  json: boolean;
  io: ChoiceIo;
};

type FixedChoiceInput = {
  commandName: string;
  missingOption: string;
  syntax: string;
  label: string;
  choices: Choice[];
  json: boolean;
  io: ChoiceIo;
};

type ProjectListResponse = {
  projects: Choice[];
};

type ProjectDetailResponse = {
  project: Choice;
  environments: Choice[];
};

type FlagListResponse = {
  flags: Choice[];
};

export async function resolveProjectChoice(
  client: KrillswitchClient,
  input: ProjectInput,
): Promise<string> {
  return resolveProjectChoiceWithMissing(client, input, "--project");
}

async function resolveProjectChoiceWithMissing(
  client: KrillswitchClient,
  input: ProjectInput,
  missingOption: string,
): Promise<string> {
  if (input.project) return input.project;

  const projects = await fetchChoices(input.syntax, () => listProjects(client));
  return chooseOrExplain(input, missingOption, "project", projects);
}

export async function resolveProjectEnvChoice(
  client: KrillswitchClient,
  input: ProjectEnvInput,
): Promise<{ project: string; env: string }> {
  const project = await resolveProjectChoiceWithMissing(
    client,
    input,
    !input.project && !input.env ? "--project and --env" : "--project",
  );
  if (input.env) return { project, env: input.env };

  const environments = await fetchChoices(
    input.syntax,
    () => listEnvironments(client, project),
    `for ${project}`,
  );
  const env = await chooseOrExplain(
    input,
    "--env",
    `environment for ${project}`,
    environments,
  );
  return { project, env };
}

export async function resolveFlagChoice(
  client: KrillswitchClient,
  input: ProjectEnvInput & { flagKey: string | undefined },
): Promise<string> {
  if (input.flagKey) return input.flagKey;

  const flags = await fetchChoices(
    input.syntax,
    () => listFlags(client, input.project, input.env),
    `in ${input.project}/${input.env}`,
  );
  return chooseOrExplain(
    input,
    "<key>",
    `flag in ${input.project}/${input.env}`,
    flags,
  );
}

export async function resolveFixedChoice(
  input: FixedChoiceInput,
): Promise<string> {
  if (!input.json && isInteractive(input.io)) {
    return promptChoice(input.io, input.label, input.choices);
  }
  throw new CliUsageError(
    [
      `${input.commandName} needs ${input.missingOption}`,
      `Available ${pluralize(input.label)}: ${input.choices.map((choice) => choice.key).join(", ")}`,
      `Usage: ${input.syntax}`,
    ].join("\n"),
  );
}

async function listProjects(client: KrillswitchClient): Promise<Choice[]> {
  const { projects } =
    await client.request<ProjectListResponse>("/admin/projects");
  return projects;
}

async function listEnvironments(
  client: KrillswitchClient,
  project: string,
): Promise<Choice[]> {
  const { environments } = await client.request<ProjectDetailResponse>(
    `/admin/projects/${encodeURIComponent(project)}`,
  );
  return environments;
}

async function listFlags(
  client: KrillswitchClient,
  project: string | undefined,
  env: string | undefined,
): Promise<Choice[]> {
  if (!project || !env) return [];
  const { flags } = await client.request<FlagListResponse>(
    `/admin/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}/flags`,
  );
  return flags;
}

async function fetchChoices(
  syntax: string,
  fetcher: () => Promise<Choice[]>,
  labelSuffix = "",
): Promise<Choice[]> {
  try {
    return await fetcher();
  } catch (error: unknown) {
    if (error instanceof CliError) {
      const failure = choiceLookupFailure({
        syntax,
        labelSuffix,
        cause: error.message,
      });
      throw new CliUsageError(failure.lines.join("\n"), failure.title);
    }
    throw error;
  }
}

function choiceLookupFailure(input: {
  syntax: string;
  labelSuffix: string;
  cause: string;
}): { title: string; lines: string[] } {
  if (input.cause.startsWith("could not reach krillswitch at ")) {
    const baseUrl = input.cause.slice("could not reach krillswitch at ".length);
    return {
      title: "API unavailable",
      lines: [
        `Could not reach krillswitch at ${baseUrl}.`,
        "Run: krillswitch onboard",
        `Or:  ${input.syntax} --base-url <url>`,
      ],
    };
  }
  if (input.cause.startsWith("no access token:")) {
    return {
      title: "No access token",
      lines: [
        "No access token is configured.",
        "Run: krillswitch onboard",
        `Or:  ${input.syntax} --token <ksat_...>`,
      ],
    };
  }
  return {
    title: "Cannot choose options",
    lines: [
      `Could not list choices${input.labelSuffix ? ` ${input.labelSuffix}` : ""}: ${input.cause}`,
      "Run: krillswitch onboard",
      `Or:  ${input.syntax} --base-url <url> --token <ksat_...>`,
    ],
  };
}

async function chooseOrExplain(
  input: ProjectInput | ProjectEnvInput,
  missingOption: string,
  label: string,
  choices: Choice[],
): Promise<string> {
  if (choices.length === 0) {
    throw new CliUsageError(
      [
        `${input.commandName} needs ${missingOption}`,
        `No ${label}s found.`,
        `Usage: ${input.syntax}`,
      ].join("\n"),
    );
  }

  const [onlyChoice] = choices;
  if (choices.length === 1 && onlyChoice) {
    return onlyChoice.key;
  }

  if (!input.json && isInteractive(input.io)) {
    return promptChoice(input.io, label, choices);
  }

  throw new CliUsageError(
    [
      `${input.commandName} needs ${missingOption}`,
      `Available ${pluralize(label)}: ${choices.map((choice) => choice.key).join(", ")}`,
      `Usage: ${input.syntax}`,
    ].join("\n"),
  );
}

async function promptChoice(
  io: ChoiceIo,
  label: string,
  choices: Choice[],
): Promise<string> {
  const selected = await select({
    message: choiceTitle(label),
    options: choices.map((choice) => {
      const label = choiceLabel(choice);
      return {
        value: choice.key,
        label,
      };
    }),
    input: io.stdin,
    output: io.stdout,
    maxItems: 8,
    withGuide: true,
  });
  if (isCancel(selected)) {
    throw new CliUsageError(`${choiceTitle(label)} selection cancelled`);
  }
  io.stdout.write("\n");
  return selected;
}

function choiceTitle(label: string): string {
  if (label.startsWith("environment for ")) {
    return "Environment";
  }
  if (label.startsWith("flag in ")) {
    return "Flag";
  }
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function choiceLabel(choice: Choice): string {
  if (!choice.name) return choice.key;
  return `${choice.key}  ${choice.name}`;
}

function pluralize(label: string): string {
  if (label.startsWith("environment for ")) {
    return label.replace("environment", "environments");
  }
  if (label.startsWith("flag in ")) {
    return label.replace("flag", "flags");
  }
  return `${label}s`;
}

function isInteractive(io: ChoiceIo): boolean {
  return (
    booleanProperty(io.stdin, "isTTY") && booleanProperty(io.stdout, "isTTY")
  );
}

function booleanProperty(value: object, key: string): boolean {
  return Reflect.get(value, key) === true;
}
