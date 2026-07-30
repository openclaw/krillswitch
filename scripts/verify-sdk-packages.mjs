import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromReactPackage = createRequire(
  path.join(root, "packages/react/package.json"),
);
const pnpmExecPath = process.env.npm_execpath;
assert(pnpmExecPath, "npm_execpath is required; run this check through pnpm");

const packageDefinitions = [
  {
    directory: "packages/core",
    name: "@openclaw/krillswitch-core",
    tarball: "core.tgz",
  },
  {
    directory: "packages/react",
    name: "@openclaw/krillswitch-react",
    tarball: "react.tgz",
  },
];

function runPnpm(args) {
  const result = spawnSync(process.execPath, [pnpmExecPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `pnpm ${args.join(" ")} failed`);
}

function extractTarball(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  execFileSync(
    "tar",
    ["-xzf", tarball, "--strip-components=1", "-C", destination],
    { stdio: "inherit" },
  );
}

function readPackedManifest(tarball) {
  return JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
}

function linkReactDependency(packageName, destination) {
  const manifestPath = requireFromReactPackage.resolve(
    `${packageName}/package.json`,
  );
  symlinkSync(path.dirname(manifestPath), destination);
}

const temporaryDirectory = mkdtempSync(
  path.join(tmpdir(), "krillswitch-sdk-pack-"),
);

try {
  const packed = new Map();

  for (const definition of packageDefinitions) {
    const tarball = path.join(temporaryDirectory, definition.tarball);
    runPnpm(["--dir", definition.directory, "pack", "--out", tarball]);

    const entries = execFileSync("tar", ["-tf", tarball], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    assert(
      entries.includes("package/LICENSE"),
      `${definition.name} omits LICENSE`,
    );
    assert(
      entries.includes("package/README.md"),
      `${definition.name} omits README.md`,
    );
    assert(
      entries.includes("package/dist/index.js"),
      `${definition.name} omits runtime entry`,
    );
    assert(
      entries.includes("package/dist/index.d.ts"),
      `${definition.name} omits type entry`,
    );
    assert(
      entries.every(
        (entry) => !entry.includes("/src/") && !entry.includes(".test."),
      ),
      `${definition.name} includes source or test files`,
    );

    const manifest = readPackedManifest(tarball);
    assert.equal(manifest.name, definition.name);
    assert.notEqual(manifest.private, true, `${definition.name} is private`);
    assert.equal(manifest.publishConfig?.access, "public");
    assert.equal(manifest.main, "./dist/index.js");
    assert.equal(manifest.types, "./dist/index.d.ts");
    packed.set(definition.name, { manifest, tarball });
  }

  const core = packed.get("@openclaw/krillswitch-core");
  const react = packed.get("@openclaw/krillswitch-react");
  assert(core && react);
  assert.equal(
    react.manifest.dependencies?.["@openclaw/krillswitch-core"],
    core.manifest.version,
    "the packed React SDK must depend on the matching core version",
  );
  assert.equal(
    react.manifest.exports?.["./server"]?.import,
    "./dist/server.js",
  );
  assert.equal(react.manifest.imports?.["#evaluation"], "./dist/evaluation.js");

  const consumerDirectory = path.join(temporaryDirectory, "consumer");
  const consumerModules = path.join(consumerDirectory, "node_modules");
  extractTarball(
    core.tarball,
    path.join(consumerModules, "@openclaw", "krillswitch-core"),
  );
  extractTarball(
    react.tarball,
    path.join(consumerModules, "@openclaw", "krillswitch-react"),
  );
  linkReactDependency("react", path.join(consumerModules, "react"));
  mkdirSync(path.join(consumerModules, "@types"), { recursive: true });
  linkReactDependency(
    "@types/react",
    path.join(consumerModules, "@types", "react"),
  );
  linkReactDependency("csstype", path.join(consumerModules, "csstype"));
  writeFileSync(
    path.join(consumerDirectory, "smoke.mjs"),
    `import { evaluateFlag } from "@openclaw/krillswitch-core";
import { createKrillswitch } from "@openclaw/krillswitch-react";
import { createKrillswitchEvaluator } from "@openclaw/krillswitch-react/server";

if (typeof evaluateFlag !== "function") throw new Error("core entry failed");
if (typeof createKrillswitch !== "function") throw new Error("React entry failed");
if (typeof createKrillswitchEvaluator !== "function") throw new Error("server entry failed");
`,
  );
  execFileSync(process.execPath, [path.join(consumerDirectory, "smoke.mjs")], {
    cwd: consumerDirectory,
    stdio: "inherit",
  });
  writeFileSync(
    path.join(consumerDirectory, "smoke.ts"),
    `import type { EvalContext } from "@openclaw/krillswitch-core";
import { createKrillswitch } from "@openclaw/krillswitch-react";
import { createKrillswitchEvaluator } from "@openclaw/krillswitch-react/server";

const context: EvalContext = { key: "consumer" };
const flags = createKrillswitch({ souls: false });
const value: boolean = flags.useFeatureFlag("souls");
const evaluate = createKrillswitchEvaluator({ souls: false });
void [context, value, evaluate];
`,
  );
  writeFileSync(
    path.join(consumerDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        target: "ES2022",
        types: [],
      },
      include: ["smoke.ts"],
    }),
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      consumerDirectory,
    ],
    { cwd: consumerDirectory, stdio: "inherit" },
  );

  console.log(
    "SDK package verification passed: packed runtime and type entry points load.",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
