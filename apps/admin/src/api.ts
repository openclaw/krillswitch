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

export type UserWithRole = {
  id: string;
  name: string;
  email: string;
  role: AdminRole | null;
};

export type EnvironmentKeyEntry = {
  environmentId: string;
  environmentKey: string;
  environmentName: string;
  evalKey: string;
};

export type Environment = { id: string; key: string; name: string };

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
};

export type FlagDetail = {
  flag: {
    id: string;
    key: string;
    name: string;
    kind: FlagKind;
    description: string | null;
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
    rules: {
      variationId: string;
      attribute: string;
      values: (string | number | boolean)[];
    }[];
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
  variations: { id?: string; value: FlagValue; name: string | null }[];
  offVariationIndex: number;
  defaultVariationIndex: number;
  targets: { variationIndex: number; contextKeys: string[] }[];
  rules: {
    variationIndex: number;
    attribute: string;
    values: (string | number | boolean)[];
  }[];
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

export const api = {
  me: () => request<Me>("/admin/me"),
  devPersonas: () =>
    request<{ personas: DevPersonaOption[] }>("/admin/dev-personas"),
  devLogin: (persona: string) => post("/admin/dev-login", { persona }),
  signOut: () => post("/api/auth/sign-out", {}),
  projects: () => request<{ projects: Project[] }>("/admin/projects"),
  projectDetail: (projectKey: string) =>
    request<ProjectDetail>(`/admin/projects/${encodeURIComponent(projectKey)}`),
  flags: (projectKey: string, environmentKey: string) =>
    request<{ flags: FlagListEntry[] }>(flagsPath(projectKey, environmentKey)),
  setFlagEnabled: (
    projectKey: string,
    environmentKey: string,
    flagKey: string,
    enabled: boolean,
  ) =>
    request<{ flag: FlagListEntry }>(
      `${flagsPath(projectKey, environmentKey)}/${encodeURIComponent(flagKey)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
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
  deleteFlag: (projectKey: string, flagKey: string) =>
    request<{ deleted: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/flags/${encodeURIComponent(flagKey)}`,
      { method: "DELETE" },
    ),
  users: () => request<{ users: UserWithRole[] }>("/admin/users"),
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
  keys: (projectKey: string) =>
    request<{ keys: EnvironmentKeyEntry[] }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/keys`,
    ),
  rotateKey: (projectKey: string, environmentKey: string) =>
    request<{ evalKey: string }>(
      `/admin/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(environmentKey)}/keys/rotate`,
      { method: "POST" },
    ),
};
