import type {
  FlagKind,
  FlagValue,
  JsonValue,
  Rollout,
  TargetingRule,
  UserTarget,
} from "@openclaw/krillswitch-core";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./authSchema";

export type AdminRole = "admin" | "editor" | "viewer";

// Service-wide role per user (PRD: no per-project scoping yet). Keyed on the
// better-auth user id so the identity provider can change without re-keying.
export const roleGrants = sqliteTable("role_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  role: text("role").$type<AdminRole>().notNull(),
  grantedBy: text("granted_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// CLI/agent access tokens. Role is editor or viewer only — never admin, so a
// leaked token can't manage grants/projects/keys. Only the SHA-256 hash is
// stored; the plaintext is shown once at mint.
export type TokenRole = Extract<AdminRole, "editor" | "viewer">;

export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").$type<TokenRole>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("access_tokens_hash").on(table.tokenHash)],
);

export type ChangeAction =
  | "flag.toggle"
  | "flag.update"
  | "flag.create"
  | "flag.archive"
  | "flag.restore"
  | "flag.delete"
  | "role.set"
  | "project.create"
  | "environment.create"
  | "environment.delete"
  | "key.rotate"
  | "token.mint"
  | "token.revoke";

// Append-only audit trail; rows are written in the same D1 batch as the
// mutation they describe and are never updated or deleted (retention is an
// open PRD question — keep forever for now).
export const changeLog = sqliteTable(
  "change_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").$type<ChangeAction>().notNull(),
    projectKey: text("project_key"),
    flagKey: text("flag_key"),
    target: text("target").notNull(),
    before: text("before", { mode: "json" }).$type<JsonValue>(),
    after: text("after", { mode: "json" }).$type<JsonValue>(),
    // Optional operator-supplied intent ("why"), captured at save time.
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("change_log_created").on(table.createdAt),
    index("change_log_flag").on(table.flagKey),
  ],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
});

export const environments = sqliteTable(
  "environments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("environments_project_key").on(table.projectId, table.key),
  ],
);

export const evalKeys = sqliteTable("eval_keys", {
  id: text("id").primaryKey(),
  environmentId: text("environment_id")
    .notNull()
    .references(() => environments.id),
  key: text("key").notNull().unique(),
});

export const flags = sqliteTable(
  "flags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<FlagKind>().notNull(),
    description: text("description"),
    // Archived flags hide from admin lists but keep serving evaluations, so
    // archiving is always safe; deletion is the destructive step.
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [uniqueIndex("flags_project_key").on(table.projectId, table.key)],
);

export const variations = sqliteTable("variations", {
  id: text("id").primaryKey(),
  flagId: text("flag_id")
    .notNull()
    .references(() => flags.id),
  value: text("value", { mode: "json" }).$type<FlagValue>().notNull(),
  name: text("name"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const flagEnvironments = sqliteTable(
  "flag_environments",
  {
    id: text("id").primaryKey(),
    flagId: text("flag_id")
      .notNull()
      .references(() => flags.id),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    offVariationId: text("off_variation_id").notNull(),
    defaultVariationId: text("default_variation_id").notNull(),
    targets: text("targets", { mode: "json" })
      .$type<UserTarget[]>()
      .notNull()
      .default([]),
    rules: text("rules", { mode: "json" })
      .$type<TargetingRule[]>()
      .notNull()
      .default([]),
    rollout: text("rollout", { mode: "json" }).$type<Rollout>(),
  },
  (table) => [
    uniqueIndex("flag_environments_flag_environment").on(
      table.flagId,
      table.environmentId,
    ),
  ],
);
