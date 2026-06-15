export type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
};

const ALIASES: Record<string, string> = {
  p: "project",
  e: "env",
  k: "key",
};
const KNOWN_BOOLEANS = new Set(["json", "on", "off"]);

/**
 * Minimal parser: `--flag value`, `--flag=value`, repeatable flags, boolean
 * flags, and positionals. No external dependency so the published binary stays
 * tiny and registry-independent.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("-")) {
      if (arg !== undefined) positionals.push(arg);
      continue;
    }
    const raw = arg.replace(/^--?/, "");
    const [namePart, inlineValue] = raw.split(/=(.*)/s);
    const name = ALIASES[namePart ?? ""] ?? namePart ?? "";

    if (inlineValue !== undefined) {
      appendFlag(flags, name, inlineValue);
      continue;
    }
    if (KNOWN_BOOLEANS.has(name)) {
      booleans.add(name);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      appendFlag(flags, name, next);
      i++;
    } else {
      booleans.add(name);
    }
  }

  return { positionals, flags, booleans };
}

function appendFlag(flags: Map<string, string[]>, name: string, value: string) {
  const existing = flags.get(name);
  if (existing) {
    existing.push(value);
  } else {
    flags.set(name, [value]);
  }
}

export function flag(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

export function flagAll(args: ParsedArgs, name: string): string[] {
  return args.flags.get(name) ?? [];
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);
  if (value === undefined) {
    throw new CliUsageError(`missing required --${name}`);
  }
  return value;
}

export class CliUsageError extends Error {}
