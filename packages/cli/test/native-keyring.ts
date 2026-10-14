import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../src/config";
import { systemCredentialStore } from "../src/credentials";

// Run explicitly on disposable native CI runners, never as part of unit tests.
// Every store operation addresses this run's unique service and test account.
const [, , mode, version, operation, service, directory] = process.argv;
const account = "https://keyring-compat.example";
const require = createRequire(import.meta.url);

async function child() {
  assert.ok(
    service && directory && version && operation,
    "missing proof inputs",
  );
  const legacyRoot = process.env.KEYRING_V1_ROOT;
  assert.ok(legacyRoot, "KEYRING_V1_ROOT must name the isolated v1 install");
  const keyring =
    version === "v1"
      ? createRequire(join(legacyRoot, "package.json"))("@napi-rs/keyring")
      : require("@napi-rs/keyring");
  const entry = new keyring.AsyncEntry(service, account);
  const ref = { kind: "keyring" as const, service, account };
  const env = { KRILLSWITCH_CONFIG: join(directory, "config.json") };
  const options = { baseUrl: undefined, token: undefined };
  switch (operation) {
    case "write-v1":
      await entry.setPassword("native-fixture-v1");
      break;
    case "read-v1":
      assert.equal(await entry.getPassword(), "native-fixture-v1");
      assert.equal(
        await systemCredentialStore.getToken(ref),
        "native-fixture-v1",
      );
      if (process.platform === "linux") {
        // Confirm the default path used persistent Secret Service, not its
        // kernel-memory fallback, without changing the CLI's selection.
        const persistent = new keyring.AsyncEntry(service, account, {
          linux: { store: "secret-service" },
        });
        assert.equal(await persistent.getPassword(), "native-fixture-v1");
      }
      break;
    case "write-v2":
      await systemCredentialStore.setToken(ref, "native-fixture-v2");
      break;
    case "read-v2":
      assert.equal(await entry.getPassword(), "native-fixture-v2");
      break;
    case "missing":
      assert.ok((await entry.getPassword()) == null);
      break;
    case "invalid-secret":
      // Real native bytes that cannot decode as a password exercise the v2
      // error contract without locking or inspecting another user's store.
      await entry.setSecret(Buffer.from([0xff]));
      break;
    case "legacy-error":
      assert.ok((await entry.getPassword()) == null);
      break;
    case "required-error":
      await assert.rejects(entry.getPassword());
      await assert.rejects(
        resolveConfig(options, env),
        /could not read the access token in OS secure storage/,
      );
      break;
    case "overrides":
      assert.equal(
        (await resolveConfig({ ...options, token: "flag-fixture" }, env)).token,
        "flag-fixture",
      );
      assert.equal(
        (
          await resolveConfig(options, {
            ...env,
            KRILLSWITCH_TOKEN: "env-fixture",
          })
        ).token,
        "env-fixture",
      );
      assert.equal(
        (
          await resolveConfig(
            { ...options, token: "" },
            { ...env, KRILLSWITCH_TOKEN: "env-fixture" },
          )
        ).token,
        "",
      );
      break;
    case "delete":
      assert.equal(typeof (await entry.deleteCredential()), "boolean");
      break;
    default:
      throw new Error("unknown native proof operation");
  }
}

function run(version: string, operation: string, service: string, dir: string) {
  const result = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      "--child",
      version,
      operation,
      service,
      dir,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(
    result.status,
    0,
    `${version} ${operation} failed: ${result.error?.message ?? result.stderr}`,
  );
  console.log(`PASS ${process.platform} ${version} ${operation}`);
}

if (mode === "--child") {
  await child();
} else {
  const dir = mkdtempSync(join(tmpdir(), "krillswitch-native-keyring-"));
  const service = `krillswitch-native-test-${randomUUID()}`;
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      tokenRef: { kind: "keyring", service, account },
      token: "legacy-fixture-must-not-hide-errors",
    }),
  );
  try {
    run("v1", "missing", service, dir);
    run("v2", "missing", service, dir);
    run("v1", "write-v1", service, dir);
    run("v2", "read-v1", service, dir);
    run("v2", "write-v2", service, dir);
    run("v1", "read-v2", service, dir);
    run("v2", "invalid-secret", service, dir);
    run("v1", "legacy-error", service, dir);
    run("v2", "required-error", service, dir);
    run("v2", "overrides", service, dir);
  } finally {
    // Delete only the credential created above, including after a failed check.
    run("v2", "delete", service, dir);
    rmSync(dir, { recursive: true, force: true });
  }
  run("v2", "missing", service, dir);
}
