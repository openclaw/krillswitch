#!/usr/bin/env node
import { CliUsageError, parseArgs } from "./args";
import { CliError, KrillswitchClient } from "./client";
import { evalContext } from "./commands/evalCommand";
import { flagsGet, flagsList } from "./commands/flags";
import { logTail } from "./commands/log";
import { projectsList } from "./commands/projects";
import { resolveConfig } from "./config";

const USAGE = `krillswitch — manage feature flags from the terminal

Auth:  KRILLSWITCH_TOKEN env, --token, or ~/.krillswitch.json
Base:  KRILLSWITCH_URL env or --base-url (default http://localhost:8799)

Commands:
  projects list
  flags list      --project <key> --env <key>
  flags get <key> --project <key> --env <key>
  eval            --project <key> --env <key> --key <contextKey> [--attr k=v ...]
  log tail        [--flag <key>] [--project <key>] [--limit <n>]

Global flags:
  --json   machine-readable output
`;

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [group, sub] = args.positionals;

  if (!group || group === "help" || args.booleans.has("help")) {
    process.stdout.write(USAGE);
    return group ? 0 : 1;
  }

  const client = new KrillswitchClient(resolveConfig(args, process.env));

  if (group === "projects" && sub === "list") {
    await projectsList(client, args);
    return 0;
  }
  if (group === "flags" && sub === "list") {
    await flagsList(client, args);
    return 0;
  }
  if (group === "flags" && sub === "get") {
    const flagKey = args.positionals[2];
    if (!flagKey) throw new CliUsageError("flags get needs a flag key");
    await flagsGet(client, args, flagKey);
    return 0;
  }
  if (group === "eval") {
    await evalContext(client, args);
    return 0;
  }
  if (group === "log" && sub === "tail") {
    await logTail(client, args);
    return 0;
  }

  throw new CliUsageError(
    `unknown command: ${[group, sub].filter(Boolean).join(" ")}`,
  );
}

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(`unexpected error: ${String(error)}\n`);
    process.exit(1);
  });
