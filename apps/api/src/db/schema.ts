import type {
  FlagKind,
  FlagValue,
  Rollout,
  TargetingRule,
  UserTarget,
} from "@openclaw/krillswitch-core";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
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
