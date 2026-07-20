import assert from "node:assert/strict";
import test from "node:test";

const envNames = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "KRILLSWITCH_ACCESS_APP_ID",
];

test("deletes only the configured Krillswitch Access application", async () => {
  const calls = await runWithCloudflareMock(async (call, app) => {
    if (call.method === "GET") return json(app);
    if (call.method === "DELETE") return json({ id: app.id });
    throw new Error(`unexpected request: ${call.method} ${call.path}`);
  });

  assert.deepEqual(
    calls.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "GET",
        path: "/client/v4/accounts/account-id/access/apps/app-id",
      },
      {
        method: "DELETE",
        path: "/client/v4/accounts/account-id/access/apps/app-id",
      },
    ],
  );
});

test("succeeds when the Access application is already absent", async () => {
  const calls = await runWithCloudflareMock(async (call) => {
    if (call.method === "GET") {
      return new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ message: "not found" }],
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected request: ${call.method} ${call.path}`);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "GET");
});

test("refuses to delete an application with a different hostname", async () => {
  await assert.rejects(
    runWithCloudflareMock(async (call, app) => {
      if (call.method === "GET") {
        return json({ ...app, domain: "unrelated.openclaw.ai" });
      }
      throw new Error(`unexpected request: ${call.method} ${call.path}`);
    }),
    /refusing to delete Cloudflare Access app/,
  );
});

async function runWithCloudflareMock(respond) {
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const calls = [];
  const app = {
    id: "app-id",
    name: "Krillswitch Admin",
    domain: "switch.openclaw.ai",
  };

  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.KRILLSWITCH_ACCESS_APP_ID = app.id;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = { method: init.method || "GET", path: url.pathname };
    calls.push(call);
    return respond(call, app);
  };

  try {
    await import(`./remove-cloudflare-access.mjs?test=${crypto.randomUUID()}`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  return calls;
}

function json(result) {
  return new Response(JSON.stringify({ success: true, result, errors: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
