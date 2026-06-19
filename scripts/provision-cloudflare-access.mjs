#!/usr/bin/env node

const dryRun = process.argv.includes("--dry-run");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const host =
  process.env.KRILLSWITCH_ACCESS_HOST?.trim() || "switch.openclaw.ai";
const appName =
  process.env.KRILLSWITCH_ACCESS_APP_NAME?.trim() || "Krillswitch Admin";
const allowedEmails = csv(process.env.KRILLSWITCH_ACCESS_ALLOWED_EMAILS);
const allowedDomains = csv(
  process.env.KRILLSWITCH_ACCESS_ALLOWED_DOMAINS || "openclaw.ai",
);
const allowedIdps = csv(process.env.KRILLSWITCH_ACCESS_IDP_IDS);
const serviceTokenIds = csv(process.env.KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS);
const revokeServiceTokens =
  process.env.KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS === "1";

if (allowedEmails.length === 0 && allowedDomains.length === 0) {
  throw new Error(
    "set KRILLSWITCH_ACCESS_ALLOWED_EMAILS or KRILLSWITCH_ACCESS_ALLOWED_DOMAINS",
  );
}
if (revokeServiceTokens && serviceTokenIds.length > 0) {
  throw new Error(
    "set service-token ids to empty before revoking the automation policy",
  );
}
if (!dryRun && !token) {
  throw new Error("CLOUDFLARE_API_TOKEN is required unless --dry-run is set");
}

const appPayload = {
  name: appName,
  type: "self_hosted",
  domain: host,
  session_duration: "24h",
  app_launcher_visible: false,
  ...(allowedIdps.length > 0 ? { allowed_idps: allowedIdps } : {}),
};
const humanPolicy = {
  name: "OpenClaw admins",
  decision: "allow",
  precedence: 1,
  include: [
    ...allowedEmails.map((email) => ({ email: { email } })),
    ...allowedDomains.map((domain) => ({ email_domain: { domain } })),
  ],
};
const servicePolicy = {
  name: "Krillswitch automation",
  decision: "non_identity",
  precedence: 2,
  include: serviceTokenIds.map((tokenId) => ({
    service_token: { token_id: tokenId },
  })),
};

if (dryRun) {
  printPlan({ app: appPayload, created: false, updated: false });
  process.exit(0);
}

const apps = await cfAll(`/accounts/${accountId}/access/apps`);
const existing = apps.find(
  (app) =>
    app.name === appName ||
    app.domain === host ||
    app.domain === `https://${host}`,
);
const preservedIdps =
  allowedIdps.length === 0 && Array.isArray(existing?.allowed_idps)
    ? { allowed_idps: existing.allowed_idps }
    : {};
const app = existing
  ? await cf("PUT", `/accounts/${accountId}/access/apps/${existing.id}`, {
      ...appPayload,
      ...preservedIdps,
      id: existing.id,
    })
  : await cf("POST", `/accounts/${accountId}/access/apps`, appPayload);
const policies = await cfAll(
  `/accounts/${accountId}/access/apps/${app.id}/policies`,
);
await upsertPolicy(app.id, policies, humanPolicy);
await reconcileServiceTokenPolicy(app.id, policies, servicePolicy);

printPlan({ app, created: !existing, updated: Boolean(existing) });

async function upsertPolicy(appId, policies, policy) {
  const existingPolicy = policies.find((entry) => entry.name === policy.name);
  if (existingPolicy) {
    await cf(
      "PUT",
      `/accounts/${accountId}/access/apps/${appId}/policies/${existingPolicy.id}`,
      { ...policy, id: existingPolicy.id },
    );
    return;
  }
  await cf(
    "POST",
    `/accounts/${accountId}/access/apps/${appId}/policies`,
    policy,
  );
}

async function reconcileServiceTokenPolicy(appId, policies, policy) {
  const existingPolicy = policies.find((entry) => entry.name === policy.name);
  if (policy.include.length > 0) {
    await upsertPolicy(appId, policies, policy);
    return;
  }
  if (revokeServiceTokens && existingPolicy) {
    await cf(
      "DELETE",
      `/accounts/${accountId}/access/apps/${appId}/policies/${existingPolicy.id}`,
    );
  }
}

async function cf(method, path, body) {
  const payload = await cfPayload(method, path, body);
  return payload.result;
}

async function cfAll(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await cfPayload(
      "GET",
      `${path}${separator}per_page=100&page=${page}`,
    );
    const pageItems = asArray(payload.result);
    items.push(...pageItems);
    const totalPages = Number(payload.result_info?.total_pages);
    if (
      pageItems.length === 0 ||
      (Number.isFinite(totalPages) && page >= totalPages) ||
      (!Number.isFinite(totalPages) && pageItems.length < 100)
    ) {
      return items;
    }
  }
}

async function cfPayload(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const details = asArray(payload?.errors)
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    const scopeHint = path.includes("/access/")
      ? " A Zero Trust Access application/policy write token is required."
      : "";
    throw new Error(
      `Cloudflare ${method} ${path} failed (${response.status})${details ? `: ${details}` : ""}.${scopeHint}`,
    );
  }
  return payload;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function csv(value) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function printPlan({ app, created, updated }) {
  console.log("Cloudflare Access plan:");
  console.log(`host=${host}`);
  console.log(`app=${app.name}${app.id ? ` (${app.id})` : ""}`);
  console.log(`created=${created}`);
  console.log(`updated=${updated}`);
  console.log(`human-policy=${humanPolicy.name}`);
  console.log(
    `service-policy=${
      servicePolicy.include.length > 0
        ? servicePolicy.name
        : revokeServiceTokens
          ? "removed"
          : "preserved"
    }`,
  );
  console.log("");
  console.log("CLI service-token environment:");
  console.log("KRILLSWITCH_CF_ACCESS_CLIENT_ID=<service token client id>");
  console.log(
    "KRILLSWITCH_CF_ACCESS_CLIENT_SECRET=<service token client secret>",
  );
}
