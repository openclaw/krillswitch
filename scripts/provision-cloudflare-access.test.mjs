import assert from "node:assert/strict";
import test from "node:test";

test("resolves reusable Access policies through the account endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "KRILLSWITCH_ACCESS_APP_ID",
    "KRILLSWITCH_ACCESS_ALLOWED_DOMAINS",
    "KRILLSWITCH_ACCESS_ALLOWED_EMAILS",
    "KRILLSWITCH_ACCESS_GITHUB_ORGS",
    "KRILLSWITCH_ACCESS_GITHUB_TEAMS",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_ID",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_NAME",
    "KRILLSWITCH_ACCESS_IDP_IDS",
    "KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS",
    "KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS",
  ];
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const calls = [];
  const app = {
    id: "app-id",
    name: "Krillswitch Admin",
    domain: "switch.openclaw.ai",
  };
  const applicationPolicy = {
    id: "policy-id",
    name: "OpenClaw admins",
    precedence: 1,
  };
  const reusablePolicy = {
    ...applicationPolicy,
    reusable: true,
    app_count: 1,
  };

  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_API_TOKEN = "x";
  process.env.KRILLSWITCH_ACCESS_APP_ID = app.id;
  process.env.KRILLSWITCH_ACCESS_ALLOWED_DOMAINS = "openclaw.ai";
  process.env.KRILLSWITCH_ACCESS_GITHUB_ORGS = "";
  delete process.env.KRILLSWITCH_ACCESS_ALLOWED_EMAILS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_TEAMS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_NAME;
  delete process.env.KRILLSWITCH_ACCESS_IDP_IDS;
  delete process.env.KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS;
  delete process.env.KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = {
      method: init.method || "GET",
      path: url.pathname,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    if (call.method === "GET" && call.path.endsWith("/access/apps")) {
      return json({ result: [app], result_info: { total_pages: 1 } });
    }
    if (call.method === "PUT" && call.path.endsWith(`/access/apps/${app.id}`)) {
      return json({ result: app });
    }
    if (
      call.method === "GET" &&
      call.path.endsWith(`/access/apps/${app.id}/policies`)
    ) {
      return json({
        result: [applicationPolicy],
        result_info: { total_pages: 1 },
      });
    }
    if (call.method === "GET" && call.path.endsWith("/access/policies")) {
      return json({
        result: [reusablePolicy],
        result_info: { total_pages: 1 },
      });
    }
    if (
      call.method === "PUT" &&
      call.path.endsWith(`/access/policies/${reusablePolicy.id}`)
    ) {
      return json({ result: { ...reusablePolicy, ...call.body } });
    }
    throw new Error(`unexpected Cloudflare request: ${call.method} ${url}`);
  };

  try {
    await import(`./provision-cloudflare-access.mjs?test=${Date.now()}`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  const update = calls.find(
    (call) =>
      call.method === "PUT" &&
      call.path.endsWith(`/access/policies/${reusablePolicy.id}`),
  );
  assert.ok(update);
  assert.equal(update.body.name, "OpenClaw admins");
  assert.equal("precedence" in update.body, false);
  assert.equal("reusable" in update.body, false);
  assert.equal("reusable" in applicationPolicy, false);
  assert.equal(
    calls.some((call) =>
      call.path.endsWith(
        `/access/apps/${app.id}/policies/${reusablePolicy.id}`,
      ),
    ),
    false,
  );
});

test("provisions GitHub organization Access policy from the app identity provider", async () => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "KRILLSWITCH_ACCESS_APP_ID",
    "KRILLSWITCH_ACCESS_ALLOWED_DOMAINS",
    "KRILLSWITCH_ACCESS_ALLOWED_EMAILS",
    "KRILLSWITCH_ACCESS_GITHUB_ORGS",
    "KRILLSWITCH_ACCESS_GITHUB_TEAMS",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_ID",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_NAME",
    "KRILLSWITCH_ACCESS_IDP_IDS",
    "KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS",
    "KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS",
  ];
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const calls = [];
  const app = {
    id: "app-id",
    name: "Krillswitch Admin",
    domain: "switch.openclaw.ai",
    allowed_idps: ["google-idp"],
  };
  const githubIdp = {
    id: "github-idp",
    name: "GitHub",
    type: "github",
  };
  const googleIdp = {
    id: "google-idp",
    name: "Google",
    type: "google",
  };
  const applicationPolicy = {
    id: "policy-id",
    name: "OpenClaw admins",
    precedence: 1,
  };

  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_API_TOKEN = "x";
  process.env.KRILLSWITCH_ACCESS_APP_ID = app.id;
  process.env.KRILLSWITCH_ACCESS_GITHUB_ORGS = "openclaw";
  process.env.KRILLSWITCH_ACCESS_ALLOWED_DOMAINS = "";
  delete process.env.KRILLSWITCH_ACCESS_ALLOWED_EMAILS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_TEAMS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_NAME;
  delete process.env.KRILLSWITCH_ACCESS_IDP_IDS;
  delete process.env.KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS;
  delete process.env.KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = {
      method: init.method || "GET",
      path: url.pathname,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    if (call.method === "GET" && call.path.endsWith("/access/apps")) {
      return json({ result: [app], result_info: { total_pages: 1 } });
    }
    if (
      call.method === "GET" &&
      call.path.endsWith("/access/identity_providers")
    ) {
      return json({
        result: [googleIdp, githubIdp],
        result_info: { total_pages: 1 },
      });
    }
    if (call.method === "PUT" && call.path.endsWith(`/access/apps/${app.id}`)) {
      return json({ result: { ...app, ...call.body } });
    }
    if (
      call.method === "GET" &&
      call.path.endsWith(`/access/apps/${app.id}/policies`)
    ) {
      return json({
        result: [applicationPolicy],
        result_info: { total_pages: 1 },
      });
    }
    if (call.method === "GET" && call.path.endsWith("/access/policies")) {
      return json({ result: [], result_info: { total_pages: 1 } });
    }
    if (
      call.method === "PUT" &&
      call.path.endsWith(
        `/access/apps/${app.id}/policies/${applicationPolicy.id}`,
      )
    ) {
      return json({ result: { ...applicationPolicy, ...call.body } });
    }
    throw new Error(`unexpected Cloudflare request: ${call.method} ${url}`);
  };

  try {
    await import(`./provision-cloudflare-access.mjs?test=${Date.now()}-github`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  const appUpdate = calls.find(
    (call) =>
      call.method === "PUT" && call.path.endsWith(`/access/apps/${app.id}`),
  );
  assert.deepEqual(appUpdate.body.allowed_idps, ["google-idp", "github-idp"]);

  const policyUpdate = calls.find(
    (call) =>
      call.method === "PUT" &&
      call.path.endsWith(
        `/access/apps/${app.id}/policies/${applicationPolicy.id}`,
      ),
  );
  assert.deepEqual(policyUpdate.body.include, [
    {
      "github-organization": {
        identity_provider_id: "github-idp",
        name: "openclaw",
      },
    },
  ]);
});

test("keeps unrestricted Access app identity providers unrestricted", async () => {
  const originalFetch = globalThis.fetch;
  const envNames = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "KRILLSWITCH_ACCESS_APP_ID",
    "KRILLSWITCH_ACCESS_ALLOWED_DOMAINS",
    "KRILLSWITCH_ACCESS_ALLOWED_EMAILS",
    "KRILLSWITCH_ACCESS_GITHUB_ORGS",
    "KRILLSWITCH_ACCESS_GITHUB_TEAMS",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_ID",
    "KRILLSWITCH_ACCESS_GITHUB_IDP_NAME",
    "KRILLSWITCH_ACCESS_IDP_IDS",
    "KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS",
    "KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS",
  ];
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const calls = [];
  const app = {
    id: "app-id",
    name: "Krillswitch Admin",
    domain: "switch.openclaw.ai",
  };
  const githubIdp = {
    id: "github-idp",
    name: "GitHub",
    type: "github",
  };

  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_API_TOKEN = "x";
  process.env.KRILLSWITCH_ACCESS_APP_ID = app.id;
  process.env.KRILLSWITCH_ACCESS_GITHUB_ORGS = "openclaw";
  process.env.KRILLSWITCH_ACCESS_ALLOWED_DOMAINS = "";
  delete process.env.KRILLSWITCH_ACCESS_ALLOWED_EMAILS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_TEAMS;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID;
  delete process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_NAME;
  delete process.env.KRILLSWITCH_ACCESS_IDP_IDS;
  delete process.env.KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS;
  delete process.env.KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = {
      method: init.method || "GET",
      path: url.pathname,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    if (call.method === "GET" && call.path.endsWith("/access/apps")) {
      return json({ result: [app], result_info: { total_pages: 1 } });
    }
    if (
      call.method === "GET" &&
      call.path.endsWith("/access/identity_providers")
    ) {
      return json({ result: [githubIdp], result_info: { total_pages: 1 } });
    }
    if (call.method === "PUT" && call.path.endsWith(`/access/apps/${app.id}`)) {
      return json({ result: { ...app, ...call.body } });
    }
    if (
      call.method === "GET" &&
      call.path.endsWith(`/access/apps/${app.id}/policies`)
    ) {
      return json({ result: [], result_info: { total_pages: 1 } });
    }
    if (call.method === "GET" && call.path.endsWith("/access/policies")) {
      return json({ result: [], result_info: { total_pages: 1 } });
    }
    if (
      call.method === "POST" &&
      call.path.endsWith(`/access/apps/${app.id}/policies`)
    ) {
      return json({ result: call.body });
    }
    throw new Error(`unexpected Cloudflare request: ${call.method} ${url}`);
  };

  try {
    await import(
      `./provision-cloudflare-access.mjs?test=${Date.now()}-unrestricted`
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  const appUpdate = calls.find(
    (call) =>
      call.method === "PUT" && call.path.endsWith(`/access/apps/${app.id}`),
  );
  assert.equal("allowed_idps" in appUpdate.body, false);
});

test("rejects empty GitHub team components", async () => {
  const envNames = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "KRILLSWITCH_ACCESS_GITHUB_ORGS",
    "KRILLSWITCH_ACCESS_GITHUB_TEAMS",
  ];
  const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );

  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_API_TOKEN = "x";
  process.env.KRILLSWITCH_ACCESS_GITHUB_ORGS = "openclaw";
  process.env.KRILLSWITCH_ACCESS_GITHUB_TEAMS = "openclaw/";

  try {
    await assert.rejects(
      import(`./provision-cloudflare-access.mjs?test=${Date.now()}-empty-team`),
      /non-empty org and team/,
    );
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

function json({ result, result_info }) {
  return new Response(
    JSON.stringify({ success: true, result, result_info, errors: [] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}
