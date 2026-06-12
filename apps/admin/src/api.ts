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

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new ApiError(response.status, `${path} -> ${response.status}`);
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
};
