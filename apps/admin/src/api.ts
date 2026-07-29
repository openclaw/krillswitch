export type AdminRole = "admin" | "editor" | "viewer";

export type Me = {
  user: { id: string; name: string; email: string };
  role: AdminRole | null;
};

export type DevPersonaOption = {
  id: string;
  name: string;
  role: AdminRole | null;
};

export type Project = { id: string; key: string; name: string };

export type ProjectSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  flagCount: number;
  environmentCount: number;
  /** Epoch ms of the latest change-log entry for this project, or null. */
  lastChangeAt: number | null;
};

/** Project-level flag identity for filter UIs (no per-environment config). */
export type ProjectFlagKey = { key: string; name: string };

export type TokenRole = "editor" | "viewer";

export type AccessTokenEntry = {
  id: string;
  name: string;
  role: TokenRole;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type UserWithRole = {
  id: string;
  name: string;
  email: string;
  role: AdminRole | null;
};

export type Segment = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  contextKeys: string[];
  rules: { attribute: string; values: (string | number | boolean)[] }[];
  createdAt: string;
};

export type SegmentBody = {
  name: string;
  description?: string | null;
  contextKeys: string[];
  rules: { attribute: string; values: (string | number | boolean)[] }[];
};

/** One environment-day of eval traffic (day = epoch ms / 86400000). */
export type EvalStatRow = {
  projectKey: string;
  environmentKey: string;
  day: number;
  count: number;
};

export type Webhook = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastStatus: string | null;
  lastSentAt: string | null;
  createdAt: string;
};

export type ChangeLogEntry = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  projectKey: string | null;
  flagKey: string | null;
  target: string;
  before: unknown;
  after: unknown;
  comment: string | null;
  /** ISO timestamp (Date serialized over JSON). */
  createdAt: string;
};

export type EnvironmentKeyEntry = {
  environmentId: string;
  environmentKey: string;
  environmentName: string;
  evalKey: string;
};

export type Environment = {
  id: string;
  key: string;
  name: string;
  /** SDK freshness (ISO timestamp of the newest /v1/eval request). */
  lastEvalAt: string | null;
  evalCount: number;
};

export type ProjectDetail = {
  project: Project;
  environments: Environment[];
};

export type FlagKind = "boolean" | "string" | "number" | "json";

export type FlagValue =
  | string
  | number
  | boolean
  | null
  | FlagValue[]
  | { [key: string]: FlagValue };

export type FlagListEntry = {
  id: string;
  key: string;
  name: string;
  kind: FlagKind;
  description: string | null;
  enabled: boolean;
  /** Variation served while the flag is off (list rows only; the toggle
   *  response omits it, so cache updates must merge, not replace). */
  offVariation?: string | null;
  /** Latest change-log timestamp for the flag (ISO), if any. */
  lastChangedAt?: string | null;
  /** Archived flags hide from lists but keep serving evaluations. */
  archived?: boolean;
};

export type FlagDetail = {
  flag: {
    id: string;
    key: string;
    name: string;
    kind: FlagKind;
    description: string | null;
    archived: boolean;
  };
  variations: {
    id: string;
    value: FlagValue;
    name: string | null;
    sortOrder: number;
  }[];
  config: {
    enabled: boolean;
    offVariationId: string;
    defaultVariationId: string;
    targets: { variationId: string; contextKeys: string[] }[];
    rules: (
      | {
          variationId: string;
          attribute: string;
          values: (string | number | boolean)[];
        }
      | { variationId: string; segment: string }
    )[];
    rollout: { variations: { variationId: string; weight: number }[] } | null;
  };
};

export type FlagCreateBody = {
  key: string;
  name: string;
  kind: FlagKind;
  description?: string;
  variations: { value: FlagValue; name?: string | null }[];
  defaultVariationIndex: number;
  offVariationIndex: number;
  enabled: boolean;
};

export type FlagUpdateBody = {
  enabled: boolean;
  /** Optional operator note stored on the audit-log entry. */
  comment?: string;
  variations: { id?: string; value: FlagValue; name: string | null }[];
  offVariationIndex: number;
  defaultVariationIndex: number;
  targets: { variationIndex: number; contextKeys: string[] }[];
  rules: (
    | {
        variationIndex: number;
        attribute: string;
        values: (string | number | boolean)[];
      }
    | { variationIndex: number; segment: string }
  )[];
  rollout: { variations: { variationIndex: number; weight: number }[] } | null;
};

export class ApiError extends Error {
  readonly status: number;
  /** Human-readable detail from the API's error body, when present. */
  readonly serverMessage: string | null;

  constructor(status: number, message: string, serverMessage: string | null) {
    super(message);
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

function flagsPath(projectKey: string, environmentKey: string): string {
  return `/admin/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(environmentKey)}/flags`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let serverMessage: string | null = null;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
      ) {
        serverMessage = body.message;
      }
    } catch {
      // Non-JSON error body; status alone will have to do.
    }
    throw new ApiError(
      response.status,
      `${path} -> ${response.status}`,
      serverMessage,
    );
  }
  return response.json() as Promise<T>;
}

function post(path: string, body: unknown): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Limit/offset paging for list endpoints. */
export type PageParams = { limit?: number; offset?: number };

function pageSuffix(page?: PageParams, base = ""): string {
  const params = new URLSearchParams(base);
  if (page?.limit !== undefined) params.set("limit", String(page.limit));
  if (page?.offset !== undefined) params.set("offset", String(page.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type AuthProviders = { github: boolean; devPersonas: boolean };

export const api = {
  me: () => request<Me>("/admin/me"),
  authProviders: () => request<AuthProviders>("/admin/auth-providers"),
  /** Returns the GitHub authorize URL to navigate to. */
  signInWithGitHub: () =>
    request<{ url: string }>("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/" }),
    }),
  devPersonas: () =>
    request<{ personas: DevPersonaOption[] }>("/admin/dev-personas"),
  devLogin: (persona: string) => post("/admin/dev-login", { persona }),
  signOut: () => post("/api/auth/sign-out", {}),
  projects: (page?: PageParams) =>
    request<{ projects: ProjectSummary[]; total: number }>(
      `/admin/projects${pageSuffix(page)}`,
    ),
  projectDetail: (projectKey: string) =>
    request<ProjectDetail>(`/admin/projects/${encodeURIComponent(projectKey)}`),
  projectFlagKeys: (projectKey: string) =>
    request<{ flags: ProjectFlagKey[] }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/flags`,
    ),
  flags: (projectKey: string, environmentKey: string) =>
    request<{ flags: FlagListEntry[] }>(flagsPath(projectKey, environmentKey)),
  setFlagEnabled: (
    projectKey: string,
    environmentKey: string,
    flagKey: string,
    enabled: boolean,
    comment?: string,
  ) =>
    request<{ flag: FlagListEntry }>(
      `${flagsPath(projectKey, environmentKey)}/${encodeURIComponent(flagKey)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(comment ? { enabled, comment } : { enabled }),
      },
    ),
  flagDetail: (projectKey: string, environmentKey: string, flagKey: string) =>
    request<FlagDetail>(
      `${flagsPath(projectKey, environmentKey)}/${encodeURIComponent(flagKey)}`,
    ),
  updateFlag: (
    projectKey: string,
    environmentKey: string,
    flagKey: string,
    body: FlagUpdateBody,
  ) =>
    request<FlagDetail>(
      `${flagsPath(projectKey, environmentKey)}/${encodeURIComponent(flagKey)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  createFlag: (projectKey: string, body: FlagCreateBody) =>
    request<{ created: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/flags`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  setFlagArchived: (projectKey: string, flagKey: string, archived: boolean) =>
    request<{ archived: boolean }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/flags/${encodeURIComponent(flagKey)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      },
    ),
  deleteFlag: (projectKey: string, flagKey: string) =>
    request<{ deleted: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/flags/${encodeURIComponent(flagKey)}`,
      { method: "DELETE" },
    ),
  changeLog: (
    filter: { flagKey?: string; projectKey?: string },
    page?: PageParams,
  ) => {
    const params = new URLSearchParams();
    if (filter.flagKey) params.set("flagKey", filter.flagKey);
    if (filter.projectKey) params.set("projectKey", filter.projectKey);
    return request<{ entries: ChangeLogEntry[]; total: number }>(
      `/admin/changelog${pageSuffix(page, params.toString())}`,
    );
  },
  changeLogEntry: (id: string) =>
    request<{ entry: ChangeLogEntry }>(
      `/admin/changelog/${encodeURIComponent(id)}`,
    ),
  segments: (projectKey: string) =>
    request<{ segments: Segment[] }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/segments`,
    ),
  createSegment: (projectKey: string, body: SegmentBody & { key: string }) =>
    request<{ created: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/segments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  updateSegment: (projectKey: string, segmentKey: string, body: SegmentBody) =>
    request<{ updated: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/segments/${encodeURIComponent(segmentKey)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  deleteSegment: (projectKey: string, segmentKey: string) =>
    request<{ deleted: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/segments/${encodeURIComponent(segmentKey)}`,
      { method: "DELETE" },
    ),
  evalStats: () => request<{ stats: EvalStatRow[] }>("/admin/eval-stats"),
  webhooks: () => request<{ webhooks: Webhook[] }>("/admin/webhooks"),
  createWebhook: (body: { name: string; url: string }) =>
    request<{ created: string }>("/admin/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  setWebhookEnabled: (id: string, enabled: boolean) =>
    request<{ enabled: boolean }>(`/admin/webhooks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  deleteWebhook: (id: string) =>
    request<{ deleted: string }>(`/admin/webhooks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  users: (page?: PageParams) =>
    request<{ users: UserWithRole[]; total: number }>(
      `/admin/users${pageSuffix(page)}`,
    ),
  user: (userId: string) =>
    request<{ user: UserWithRole }>(
      `/admin/users/${encodeURIComponent(userId)}`,
    ),
  userTokens: (userId: string, page?: PageParams) =>
    request<{ tokens: AccessTokenEntry[]; total: number }>(
      `/admin/users/${encodeURIComponent(userId)}/tokens${pageSuffix(page)}`,
    ),
  userChangeLog: (userId: string, page?: PageParams) =>
    request<{ entries: ChangeLogEntry[]; total: number }>(
      `/admin/users/${encodeURIComponent(userId)}/changelog${pageSuffix(page)}`,
    ),
  setUserRole: (userId: string, role: AdminRole | null) =>
    request<{ userId: string; role: AdminRole | null }>(
      `/admin/users/${encodeURIComponent(userId)}/role`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      },
    ),
  createProject: (key: string, name: string) =>
    request<{ created: string }>("/admin/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, name }),
    }),
  createEnvironment: (projectKey: string, key: string, name: string) =>
    request<{ created: string; evalKey: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/environments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, name }),
      },
    ),
  deleteEnvironment: (projectKey: string, environmentKey: string) =>
    request<{ deleted: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(environmentKey)}`,
      { method: "DELETE" },
    ),
  keys: (projectKey: string) =>
    request<{ keys: EnvironmentKeyEntry[] }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/keys`,
    ),
  rotateKey: (projectKey: string, environmentKey: string) =>
    request<{ evalKey: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(environmentKey)}/keys/rotate`,
      { method: "POST" },
    ),
  tokens: (page?: PageParams) =>
    request<{ tokens: AccessTokenEntry[]; total: number }>(
      `/admin/tokens${pageSuffix(page)}`,
    ),
  mintToken: (name: string, role: TokenRole) =>
    request<{ id: string; token: string }>("/admin/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role }),
    }),
  revokeToken: (id: string) =>
    request<{ revoked: string }>(
      `/admin/tokens/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    ),
};
