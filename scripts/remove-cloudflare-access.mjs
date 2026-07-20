#!/usr/bin/env node

const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const token = required("CLOUDFLARE_API_TOKEN");
const appId = required("KRILLSWITCH_ACCESS_APP_ID");
const expectedName = "Krillswitch Admin";
const expectedHost = "switch.openclaw.ai";

const path = `/accounts/${accountId}/access/apps/${appId}`;
const app = await cf("GET", path, { allowNotFound: true });
if (!app) {
  console.log(`Cloudflare Access app ${appId} is already absent`);
} else {
  if (
    app.id !== appId ||
    app.name !== expectedName ||
    rootAccessAppDomain(app.domain) !== expectedHost
  ) {
    throw new Error(
      `refusing to delete Cloudflare Access app ${appId}: expected ${expectedName} at ${expectedHost}`,
    );
  }

  await cf("DELETE", path);
  console.log(`Deleted Cloudflare Access app ${appId} from ${expectedHost}`);
}

async function cf(method, requestPath, options = {}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4${requestPath}`,
    {
      method,
      headers: { authorization: `Bearer ${token}` },
    },
  );
  const payload = await response.json().catch(() => null);
  if (response.status === 404 && options.allowNotFound) {
    return null;
  }
  if (!response.ok || payload?.success === false) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ")
      : "";
    throw new Error(
      `Cloudflare ${method} ${requestPath} failed (${response.status})${details ? `: ${details}` : ""}. A Zero Trust Access application write token is required.`,
    );
  }
  return payload?.result;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
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
