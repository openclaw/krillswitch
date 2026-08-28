import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedRepository = "https://github.com/openclaw/krillswitch";
const expectedAuthor = "OpenClaw Team <dev@openclaw.ai>";
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

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizeRepository(value) {
  const repository = typeof value === "string" ? value : value?.url;
  return String(repository ?? "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

export function releaseVersionFromTag(tag) {
  const match = /^sdk-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error(
      `SDK release tag must match sdk-vX.Y.Z; received ${tag || "<missing>"}`,
    );
  }
  return match[1];
}

export function tarballDigests(bytes) {
  return {
    shasum: createHash("sha1").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

export function assertPublishedDistMatches(expected, actual, name, version) {
  assert(actual, `${name}@${version} is not visible in the registry`);
  assert.equal(
    actual.shasum,
    expected.shasum,
    `${name}@${version} registry shasum does not match the retained tarball`,
  );
  assert.equal(
    actual.integrity,
    expected.integrity,
    `${name}@${version} registry integrity does not match the retained tarball`,
  );
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function validateReleaseContext() {
  const tag = process.env.RELEASE_TAG ?? "";
  const releaseSha = process.env.RELEASE_SHA ?? "";
  const version = releaseVersionFromTag(tag);
  assert.match(
    releaseSha,
    /^[0-9a-f]{40}$/,
    "RELEASE_SHA must be a full commit SHA",
  );
  assert.equal(
    git(["rev-parse", "HEAD"]),
    releaseSha,
    "checked-out commit does not match RELEASE_SHA",
  );
  assert.equal(
    git(["rev-parse", `${tag}^{commit}`]),
    releaseSha,
    "release tag does not resolve to RELEASE_SHA",
  );
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", releaseSha, "origin/main"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  return { tag, releaseSha, version };
}

function validateWorkspacePackages(version) {
  const manifests = new Map();
  for (const definition of packageDefinitions) {
    const manifest = readJson(
      path.join(root, definition.directory, "package.json"),
    );
    assert.equal(manifest.name, definition.name);
    assert.equal(
      manifest.version,
      version,
      `${definition.name} must match the SDK release tag`,
    );
    assert.notEqual(
      manifest.private,
      true,
      `${definition.name} must be public`,
    );
    assert.equal(manifest.author, expectedAuthor);
    assert.equal(normalizeRepository(manifest.repository), expectedRepository);
    assert.equal(manifest.publishConfig?.access, "public");
    assert.equal(manifest.publishConfig?.provenance, true);
    manifests.set(definition.name, manifest);
  }

  const react = manifests.get("@openclaw/krillswitch-react");
  assert.equal(
    react.dependencies?.["@openclaw/krillswitch-core"],
    "workspace:*",
    "the React workspace must depend on the core workspace",
  );

  const cli = readJson(path.join(root, "packages/cli/package.json"));
  assert.equal(cli.private, true, "the CLI package must remain private");
}

function readPackedManifest(tarball) {
  return JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
}

function validateRetainedArtifacts(directory, context) {
  const packages = [];
  for (const definition of packageDefinitions) {
    const tarball = path.join(directory, definition.tarball);
    assert(existsSync(tarball), `missing retained tarball: ${tarball}`);
    const manifest = readPackedManifest(tarball);
    assert.equal(manifest.name, definition.name);
    assert.equal(manifest.version, context.version);
    assert.notEqual(manifest.private, true);
    assert.equal(manifest.author, expectedAuthor);
    assert.equal(normalizeRepository(manifest.repository), expectedRepository);
    assert.equal(manifest.publishConfig?.access, "public");
    assert.equal(manifest.publishConfig?.provenance, true);
    const digests = tarballDigests(readFileSync(tarball));
    packages.push({
      name: definition.name,
      version: context.version,
      tarball: definition.tarball,
      ...digests,
    });
  }

  const core = packages[0];
  const reactManifest = readPackedManifest(
    path.join(directory, packageDefinitions[1].tarball),
  );
  assert.equal(
    reactManifest.dependencies?.["@openclaw/krillswitch-core"],
    core.version,
    "the packed React SDK must depend on the matching core version",
  );
  return packages;
}

function prepare(directory) {
  const context = validateReleaseContext();
  validateWorkspacePackages(context.version);
  mkdirSync(directory, { recursive: true });
  const packages = validateRetainedArtifacts(directory, context);
  const metadata = {
    schemaVersion: 1,
    repository: "openclaw/krillswitch",
    ...context,
    packages,
  };
  writeFileSync(
    path.join(directory, "release-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.log(
    `Prepared retained SDK artifacts for ${context.tag} at ${context.releaseSha}.`,
  );
}

async function fetchPublishedDist(name, version) {
  const packagePath = encodeURIComponent(name);
  const response = await fetch(
    `https://registry.npmjs.org/${packagePath}?cache=${Date.now()}`,
    {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      cache: "no-store",
    },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `registry request for ${name}@${version} failed: ${response.status} ${response.statusText}`,
    );
  }
  const packument = await response.json();
  return packument.versions?.[version]?.dist ?? null;
}

function publishTarball(tarball) {
  const result = spawnSync(
    "npm",
    ["publish", tarball, "--access", "public", "--provenance"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  assert.equal(result.status, 0, `npm publish failed for ${tarball}`);
}

async function waitForRegistry(pkg, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    let published = null;
    try {
      published = await fetchPublishedDist(pkg.name, pkg.version);
    } catch (error) {
      lastError = error;
    }
    if (published) {
      assertPublishedDistMatches(pkg, published, pkg.name, pkg.version);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    `registry did not converge for ${pkg.name}@${pkg.version}${
      lastError ? `: ${lastError.message}` : ""
    }`,
  );
}

async function publish(directory) {
  const context = validateReleaseContext();
  validateWorkspacePackages(context.version);
  const metadata = readJson(path.join(directory, "release-metadata.json"));
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.repository, "openclaw/krillswitch");
  assert.equal(metadata.tag, context.tag);
  assert.equal(metadata.releaseSha, context.releaseSha);
  assert.equal(metadata.version, context.version);

  const exactPackages = validateRetainedArtifacts(directory, context);
  assert.deepEqual(metadata.packages, exactPackages);

  for (const pkg of exactPackages) {
    const published = await fetchPublishedDist(pkg.name, pkg.version);
    if (published) {
      assertPublishedDistMatches(pkg, published, pkg.name, pkg.version);
      console.log(
        `${pkg.name}@${pkg.version} already matches the retained tarball.`,
      );
    } else {
      publishTarball(path.join(directory, pkg.tarball));
    }
    await waitForRegistry(pkg);
    console.log(`${pkg.name}@${pkg.version} verified in the registry.`);
  }
}

async function main() {
  const [command, rawDirectory = "release-artifacts"] = process.argv.slice(2);
  const directory = path.resolve(root, rawDirectory);
  if (command === "prepare") {
    prepare(directory);
    return;
  }
  if (command === "publish") {
    await publish(directory);
    return;
  }
  throw new Error(
    "usage: sdk-release.mjs <prepare|publish> [artifact-directory]",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
