import type { AdminRole } from "../db/schema";

export type DevPersonaId = "admin" | "editor" | "viewer" | "nogrant";

export type DevPersona = {
  id: DevPersonaId;
  name: string;
  email: string;
  role: AdminRole | null;
};

export const DEV_PERSONAS: Record<DevPersonaId, DevPersona> = {
  admin: {
    id: "admin",
    name: "Dev Admin",
    email: "admin@personas.localhost",
    role: "admin",
  },
  editor: {
    id: "editor",
    name: "Dev Editor",
    email: "editor@personas.localhost",
    role: "editor",
  },
  viewer: {
    id: "viewer",
    name: "Dev Viewer",
    email: "viewer@personas.localhost",
    role: "viewer",
  },
  nogrant: {
    id: "nogrant",
    name: "Dev NoGrant",
    email: "nogrant@personas.localhost",
    role: null,
  },
};

// Local-only credential; the guard keeps the whole provider out of production.
export const DEV_PERSONA_PASSWORD = "krillswitch-dev-persona";
