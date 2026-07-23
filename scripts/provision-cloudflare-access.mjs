#!/usr/bin/env node

const dryRun = process.argv.includes("--dry-run");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const host = rootAccessAppDomain(
  process.env.KRILLSWITCH_ACCESS_HOST?.trim() || "switch.openclaw.ai",
);
if (!host) {
  throw new Error(
    "KRILLSWITCH_ACCESS_HOST must be a root hostname without a path, query, or fragment",
  );
}
const appName =
  process.env.KRILLSWITCH_ACCESS_APP_NAME?.trim() || "Krillswitch Admin";
const configuredAppId = process.env.KRILLSWITCH_ACCESS_APP_ID?.trim();
const allowedEmails = csv(process.env.KRILLSWITCH_ACCESS_ALLOWED_EMAILS);
const allowedDomains = csv(process.env.KRILLSWITCH_ACCESS_ALLOWED_DOMAINS);
const allowedGitHubOrgs = csv(
  process.env.KRILLSWITCH_ACCESS_GITHUB_ORGS ?? "openclaw",
);
const allowedGitHubTeams = parseGitHubTeams(
  process.env.KRILLSWITCH_ACCESS_GITHUB_TEAMS,
);
const allowedIdps = csv(process.env.KRILLSWITCH_ACCESS_IDP_IDS);
const serviceTokenIds = csv(process.env.KRILLSWITCH_ACCESS_SERVICE_TOKEN_IDS);
const revokeServiceTokens =
  process.env.KRILLSWITCH_ACCESS_REVOKE_SERVICE_TOKENS === "1";

if (
  allowedEmails.length === 0 &&
  allowedDomains.length === 0 &&
  allowedGitHubOrgs.length === 0 &&
  allowedGitHubTeams.length === 0
) {
  throw new Error(
    "set KRILLSWITCH_ACCESS_GITHUB_ORGS, KRILLSWITCH_ACCESS_ALLOWED_EMAILS, or KRILLSWITCH_ACCESS_ALLOWED_DOMAINS",
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

const servicePolicy = {
  name: "Krillswitch automation",
  decision: "non_identity",
  precedence: 2,
  include: serviceTokenIds.map((tokenId) => ({
    service_token: { token_id: tokenId },
  })),
};

if (dryRun) {
  const githubIdpId =
    needsGitHubIdentityProvider() &&
    !process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID
      ? "<github-identity-provider-id>"
      : process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID?.trim();
  const appPayload = buildAppPayload(
    appIdentityProviderIds(undefined, githubIdpId),
  );
  const humanPolicy = buildHumanPolicy(githubIdpId);
  printPlan({ app: appPayload, humanPolicy, created: false, updated: false });
  process.exit(0);
}

const apps = await cfAll(`/accounts/${accountId}/access/apps`);
const existing = resolveExistingApp(apps);
const githubIdpId = await resolveGitHubIdentityProviderId(existing);
const humanPolicy = buildHumanPolicy(githubIdpId);
const managedAppPayload = buildAppPayload(
  appIdentityProviderIds(existing, githubIdpId),
);
const app = existing
  ? await cf("PUT", `/accounts/${accountId}/access/apps/${existing.id}`, {
      ...managedAppPayload,
      id: existing.id,
    })
  : await cf("POST", `/accounts/${accountId}/access/apps`, managedAppPayload);
const policies = await cfAll(
  `/accounts/${accountId}/access/apps/${app.id}/policies`,
);
const reusablePolicies = await cfAll(`/accounts/${accountId}/access/policies`);
await upsertPolicy(app.id, policies, humanPolicy, reusablePolicies);
await reconcileServiceTokenPolicy(
  app.id,
  policies,
  servicePolicy,
  reusablePolicies,
);

printPlan({ app, humanPolicy, created: !existing, updated: Boolean(existing) });

function buildAppPayload(identityProviderIds) {
  const idps = unique(identityProviderIds);
  return {
    name: appName,
    type: "self_hosted",
    domain: host,
    session_duration: "24h",
    app_launcher_visible: false,
    ...(idps.length > 0 ? { allowed_idps: idps } : {}),
  };
}

function buildHumanPolicy(githubIdentityProviderId) {
  return {
    name: "OpenClaw admins",
    decision: "allow",
    precedence: 1,
    include: [
      ...allowedEmails.map((email) => ({ email: { email } })),
      ...allowedDomains.map((domain) => ({ email_domain: { domain } })),
      ...githubPolicyRules(githubIdentityProviderId),
    ],
  };
}

function githubPolicyRules(identityProviderId) {
  if (!needsGitHubIdentityProvider()) {
    return [];
  }
  if (!identityProviderId) {
    throw new Error(
      "set KRILLSWITCH_ACCESS_GITHUB_IDP_ID or configure exactly one GitHub Access identity provider",
    );
  }

  if (allowedGitHubTeams.length > 0) {
    return allowedGitHubTeams.map(({ org, team }) => ({
      github_organization: {
        identity_provider_id: identityProviderId,
        name: org,
        team,
      },
    }));
  }

  return allowedGitHubOrgs.map((org) => ({
    github_organization: {
      identity_provider_id: identityProviderId,
      name: org,
    },
  }));
}

function appIdentityProviderIds(existing, githubIdentityProviderId) {
  if (allowedIdps.length > 0 || githubIdentityProviderId) {
    return unique([...allowedIdps, githubIdentityProviderId].filter(Boolean));
  }
  return Array.isArray(existing?.allowed_idps) ? existing.allowed_idps : [];
}

async function resolveGitHubIdentityProviderId(existing) {
  if (!needsGitHubIdentityProvider()) {
    return undefined;
  }

  const configured = process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_ID?.trim();
  if (configured) {
    return configured;
  }

  const candidates =
    allowedIdps.length > 0 ? allowedIdps : existing?.allowed_idps;
  if (Array.isArray(candidates) && candidates.length === 1) {
    return candidates[0];
  }

  const providers = await cfAll(
    `/accounts/${accountId}/access/identity_providers`,
  );
  const preferredName =
    process.env.KRILLSWITCH_ACCESS_GITHUB_IDP_NAME?.trim() || "GitHub";
  const githubProviders = providers.filter(
    (provider) => provider.type === "github",
  );
  const namedProviders = githubProviders.filter(
    (provider) => provider.name === preferredName,
  );
  const matches = namedProviders.length > 0 ? namedProviders : githubProviders;
  if (matches.length === 1) {
    return matches[0].id;
  }

  const visibleProviders =
    githubProviders
      .map((provider) => `${provider.name || "(unnamed)"}:${provider.id}`)
      .join(", ") || "none";
  throw new Error(
    `could not resolve the GitHub Access identity provider. Set KRILLSWITCH_ACCESS_GITHUB_IDP_ID. GitHub providers: ${visibleProviders}`,
  );
}

function needsGitHubIdentityProvider() {
  return allowedGitHubOrgs.length > 0 || allowedGitHubTeams.length > 0;
}

async function upsertPolicy(appId, policies, policy, reusablePolicies) {
  const existingPolicy = policies.find((entry) => entry.name === policy.name);
  if (existingPolicy) {
    const reusable = isReusablePolicy(existingPolicy, reusablePolicies);
    const payload = reusable
      ? {
          name: policy.name,
          decision: policy.decision,
          include: policy.include,
        }
      : { ...policy, id: existingPolicy.id };
    await cf(
      "PUT",
      accessPolicyPath(appId, existingPolicy, reusablePolicies),
      payload,
    );
    return;
  }
  await cf(
    "POST",
    `/accounts/${accountId}/access/apps/${appId}/policies`,
    policy,
  );
}

async function reconcileServiceTokenPolicy(
  appId,
  policies,
  policy,
  reusablePolicies,
) {
  const existingPolicy = policies.find((entry) => entry.name === policy.name);
  if (policy.include.length > 0) {
    await upsertPolicy(appId, policies, policy, reusablePolicies);
    return;
  }
  if (revokeServiceTokens && existingPolicy) {
    if (isReusablePolicy(existingPolicy, reusablePolicies)) {
      throw new Error(
        `refusing to revoke reusable Access policy ${existingPolicy.id}; detach it from the application in Cloudflare first`,
      );
    }
    await cf(
      "DELETE",
      `/accounts/${accountId}/access/apps/${appId}/policies/${existingPolicy.id}`,
    );
  }
}

function accessPolicyPath(appId, policy, reusablePolicies) {
  return isReusablePolicy(policy, reusablePolicies)
    ? `/accounts/${accountId}/access/policies/${policy.id}`
    : `/accounts/${accountId}/access/apps/${appId}/policies/${policy.id}`;
}

function isReusablePolicy(policy, reusablePolicies) {
  return reusablePolicies.some((entry) => entry.id === policy.id);
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

function parseGitHubTeams(value) {
  return csv(value).map((entry) => {
    const slash = entry.indexOf("/");
    if (slash > 0) {
      return {
        org: entry.slice(0, slash).trim(),
        team: entry.slice(slash + 1).trim(),
      };
    }
    if (allowedGitHubOrgs.length === 1) {
      return { org: allowedGitHubOrgs[0], team: entry };
    }
    throw new Error(
      "KRILLSWITCH_ACCESS_GITHUB_TEAMS entries must be org/team when KRILLSWITCH_ACCESS_GITHUB_ORGS does not contain exactly one org",
    );
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveExistingApp(apps) {
  if (configuredAppId) {
    const app = apps.find((candidate) => candidate.id === configuredAppId);
    if (!app) {
      throw new Error(
        `Cloudflare Access app ${configuredAppId} was not found in this account`,
      );
    }
    if (app.name !== appName || rootAccessAppDomain(app.domain) !== host) {
      throw new Error(
        `Cloudflare Access app ${configuredAppId} does not match the configured name and root hostname`,
      );
    }
    return app;
  }

  const matches = apps.filter(
    (app) => app.name === appName || rootAccessAppDomain(app.domain) === host,
  );
  const exactMatches = matches.filter(
    (app) => app.name === appName && rootAccessAppDomain(app.domain) === host,
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1 && exactMatches.length === 1) {
    return exactMatches[0];
  }

  const ids = matches
    .map((app) => `${app.id} (${app.name} / ${app.domain})`)
    .join(", ");
  throw new Error(
    `refusing ambiguous Cloudflare Access app discovery: ${ids}. Set KRILLSWITCH_ACCESS_APP_ID to the intended app id.`,
  );
}

function rootAccessAppDomain(domain) {
  if (typeof domain !== "string") {
    return undefined;
  }
  try {
    const url = new URL(domain.includes("://") ? domain : `https://${domain}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function printPlan({ app, humanPolicy, created, updated }) {
  console.log("Cloudflare Access plan:");
  console.log(`host=${host}`);
  console.log(`app=${app.name}${app.id ? ` (${app.id})` : ""}`);
  console.log(`created=${created}`);
  console.log(`updated=${updated}`);
  console.log(`human-policy=${humanPolicy.name}`);
  console.log(`github-orgs=${allowedGitHubOrgs.join(",") || "(none)"}`);
  console.log(
    `github-teams=${
      allowedGitHubTeams.map(({ org, team }) => `${org}/${team}`).join(",") ||
      "(none)"
    }`,
  );
  console.log(`email-domains=${allowedDomains.join(",") || "(none)"}`);
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
