// Warn during install lifecycle when a package manager other than pnpm is used.
import { pathToFileURL } from "node:url";

const allowedLifecyclePackageManagers = new Set(["pnpm", "npm", "yarn"]);

function normalizeEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function detectLifecyclePackageManager(env = process.env) {
  const userAgent = normalizeEnvValue(env.npm_config_user_agent);
  const match = /^([A-Za-z0-9._-]+)\//u.exec(userAgent);
  if (match) {
    const manager = match[1].toLowerCase();
    return allowedLifecyclePackageManagers.has(manager) ? manager : null;
  }

  const execPath = normalizeEnvValue(env.npm_execpath).toLowerCase();
  for (const manager of allowedLifecyclePackageManagers) {
    if (execPath.includes(manager)) return manager;
  }
  return null;
}

function warnIfNonPnpmLifecycle(env = process.env, warn = console.warn) {
  const packageManager = detectLifecyclePackageManager(env);
  if (!packageManager || packageManager === "pnpm") return false;

  warn(
    [
      `[krillswitch] warning: detected ${packageManager} for install lifecycle.`,
      "[krillswitch] this repository is maintained with pnpm.",
      "[krillswitch] prefer: corepack pnpm install",
    ].join("\n"),
  );
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  warnIfNonPnpmLifecycle();
}
