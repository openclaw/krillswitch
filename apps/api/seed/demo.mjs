// Local-only demo seeder: fills the dev D1 with enough realistic data to see
// the UI fully populated — paginated tables, varied flag kinds, a busy change
// log. Idempotent (deterministic ids + INSERT OR IGNORE), so re-running is safe.
//
//   bun run dev        # once, to migrate + seed the base fixture
//   bun run seed:demo  # then load this demo data
//
// This is NOT the test fixture (that's seed.sql); it's purely for eyeballing.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiRoot = new URL("..", import.meta.url).pathname;
const now = Date.now();
const day = 86_400_000;
const sql = [];
const esc = (value) => String(value).replace(/'/g, "''");
const lit = (value) => (value === null ? "NULL" : `'${esc(value)}'`);
const json = (value) => `'${esc(JSON.stringify(value))}'`;

function hex(length = 12) {
  let out = "";
  while (out.length < length)
    out += Math.floor(Math.random() * 16).toString(16);
  return out.slice(0, length);
}

// --- Projects, each with development + production environments + eval keys.
//     ~10 pages worth (PAGE_SIZE 10), last page partial. Aurora stays index 0
//     and keeps the rich flag set below; the rest are generated codenames. ---
const PROJECT_CODENAMES = [
  "Aurora",
  "Borealis",
  "Cirrus",
  "Dynamo",
  "Ember",
  "Fathom",
  "Glacier",
  "Harbor",
  "Iris",
  "Juno",
  "Kestrel",
  "Lumen",
  "Mosaic",
  "Nimbus",
  "Onyx",
  "Pulsar",
  "Quasar",
  "Rivet",
  "Solstice",
  "Tempest",
  "Umbra",
  "Vertex",
  "Willow",
  "Xenon",
  "Yonder",
  "Zephyr",
  "Cobalt",
  "Drift",
  "Flux",
  "Helix",
  "Ion",
  "Mica",
  "Nova",
  "Orbit",
  "Prism",
  "Quill",
  "Relay",
  "Spruce",
  "Tidal",
  "Vapor",
];
const PROJECT_DESCS = [
  "Realtime collaboration surface for the editor.",
  "Billing, invoices, and usage metering.",
  "Public marketing site and docs.",
  "Background job and queue runner.",
  "Notifications: email, push, and in-app.",
  "Analytics ingestion and dashboards.",
  "Cold storage and archival exports.",
  "Mobile app shell and native bridges.",
  "Search and recommendations.",
  "Identity, SSO, and session management.",
  "Experiments and A/B testing platform.",
  "Design system and component playground.",
  "Admin console and internal tooling.",
  "Edge caching and CDN config.",
  "Webhook delivery and retries.",
  "Feature gating for the public API.",
  "Image processing and thumbnails.",
  "Audit logging and compliance exports.",
];
const PROJECT_COUNT = 96;
const PROJECTS = Array.from({ length: PROJECT_COUNT }, (_, i) => {
  const base = PROJECT_CODENAMES[i % PROJECT_CODENAMES.length];
  const cycle = Math.floor(i / PROJECT_CODENAMES.length);
  const name = cycle === 0 ? base : `${base} ${cycle + 1}`;
  return [name, PROJECT_DESCS[i % PROJECT_DESCS.length]];
});

const projectKeyByIndex = PROJECTS.map(
  (_, i) => `demo-${String(i + 1).padStart(2, "0")}`,
);

PROJECTS.forEach(([name, description], i) => {
  const id = `proj_demo_${String(i + 1).padStart(2, "0")}`;
  const key = projectKeyByIndex[i];
  sql.push(
    `INSERT OR IGNORE INTO projects (id, key, name, description) VALUES ('${id}', '${key}', ${lit(name)}, ${lit(description)});`,
  );
  for (const [envKey, envName] of [
    ["development", "Development"],
    ["production", "Production"],
  ]) {
    const envId = `${id}_${envKey}`;
    sql.push(
      `INSERT OR IGNORE INTO environments (id, project_id, key, name) VALUES ('${envId}', '${id}', '${envKey}', '${envName}');`,
    );
    sql.push(
      `INSERT OR IGNORE INTO eval_keys (id, environment_id, key) VALUES ('ek_${envId}', '${envId}', 'ks_${key}_${envKey}_${hex()}');`,
    );
  }
});

// --- Flags. One project (Aurora) is flag-rich to show a full table; a few
//     others get a couple so the projects list shows varied flag counts. ---
function addFlag(projectIndex, spec) {
  const projId = `proj_demo_${String(projectIndex + 1).padStart(2, "0")}`;
  const flagId = `flag_demo_${projectIndex + 1}_${spec.key.replace(/-/g, "_")}`;
  sql.push(
    `INSERT OR IGNORE INTO flags (id, project_id, key, name, kind, description) VALUES ('${flagId}', '${projId}', '${spec.key}', ${lit(spec.name)}, '${spec.kind}', ${lit(spec.description ?? null)});`,
  );
  const variationIds = spec.variations.map((variation, i) => {
    const variationId = `${flagId}_v${i}`;
    sql.push(
      `INSERT OR IGNORE INTO variations (id, flag_id, value, name, sort_order) VALUES ('${variationId}', '${flagId}', ${json(variation.value)}, ${lit(variation.name ?? null)}, ${i});`,
    );
    return variationId;
  });
  for (const envKey of ["development", "production"]) {
    const envId = `${projId}_${envKey}`;
    const enabled =
      envKey === "development"
        ? (spec.enabledDev ?? false)
        : (spec.enabledProd ?? false);
    const rollout =
      envKey === "development" && spec.rollout
        ? json(spec.rollout(variationIds))
        : "NULL";
    const rules =
      envKey === "development" && spec.rules
        ? json(spec.rules(variationIds))
        : "'[]'";
    sql.push(
      `INSERT OR IGNORE INTO flag_environments (id, flag_id, environment_id, enabled, off_variation_id, default_variation_id, targets, rules, rollout) VALUES ('fe_${flagId}_${envKey}', '${flagId}', '${envId}', ${enabled ? 1 : 0}, '${variationIds[spec.offIndex]}', '${variationIds[spec.defaultIndex]}', '[]', ${rules}, ${rollout});`,
    );
  }
}

const onOff = [
  { value: true, name: "On" },
  { value: false, name: "Off" },
];
const auroraFlags = [
  {
    key: "live-cursors",
    name: "Live cursors",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
    enabledProd: true,
    description: "Show collaborators' cursors in the editor.",
  },
  {
    key: "presence-avatars",
    name: "Presence avatars",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
  },
  {
    key: "comments-v2",
    name: "Comments v2",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
    rules: (v) => [
      { variationId: v[0], attribute: "plan", values: ["pro", "enterprise"] },
    ],
  },
  {
    key: "offline-edits",
    name: "Offline edits",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 1,
    offIndex: 1,
  },
  {
    key: "autosave-interval",
    name: "Autosave interval",
    kind: "number",
    variations: [
      { value: 5, name: "5s" },
      { value: 15, name: "15s" },
      { value: 30, name: "30s" },
    ],
    defaultIndex: 1,
    offIndex: 0,
    enabledDev: true,
  },
  {
    key: "editor-theme",
    name: "Editor theme",
    kind: "string",
    variations: [
      { value: "light", name: "Light" },
      { value: "dark", name: "Dark" },
      { value: "system", name: "System" },
    ],
    defaultIndex: 2,
    offIndex: 0,
    enabledDev: true,
    enabledProd: true,
  },
  {
    key: "toolbar-layout",
    name: "Toolbar layout",
    kind: "string",
    variations: [
      { value: "compact", name: "Compact" },
      { value: "comfortable", name: "Comfortable" },
    ],
    defaultIndex: 1,
    offIndex: 0,
    rollout: (v) => ({
      variations: [
        { variationId: v[0], weight: 30 },
        { variationId: v[1], weight: 70 },
      ],
    }),
    enabledDev: true,
  },
  {
    key: "ai-suggestions",
    name: "AI suggestions",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
  },
  {
    key: "export-pdf",
    name: "Export to PDF",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledProd: true,
  },
  {
    key: "limits",
    name: "Workspace limits",
    kind: "json",
    variations: [
      { value: { docs: 100, seats: 5 }, name: "Free" },
      { value: { docs: 10000, seats: 100 }, name: "Pro" },
    ],
    defaultIndex: 0,
    offIndex: 0,
    enabledDev: true,
  },
  {
    key: "realtime-sync",
    name: "Realtime sync",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
    enabledProd: true,
  },
  {
    key: "version-history",
    name: "Version history",
    kind: "boolean",
    variations: onOff,
    defaultIndex: 0,
    offIndex: 1,
    enabledDev: true,
  },
];
for (const spec of auroraFlags) addFlag(0, spec);
addFlag(1, {
  key: "metered-billing",
  name: "Metered billing",
  kind: "boolean",
  variations: onOff,
  defaultIndex: 0,
  offIndex: 1,
  enabledDev: true,
});
addFlag(1, {
  key: "invoice-pdf",
  name: "Invoice PDF",
  kind: "boolean",
  variations: onOff,
  defaultIndex: 0,
  offIndex: 1,
});
addFlag(4, {
  key: "digest-emails",
  name: "Digest emails",
  kind: "boolean",
  variations: onOff,
  defaultIndex: 0,
  offIndex: 1,
  enabledDev: true,
});

// Sprinkle 0-3 boolean flags across the remaining projects so the Flags
// column shows varied counts on every page, not just zeros.
for (let p = 2; p < PROJECT_COUNT; p += 1) {
  const flagCount = (p * 3 + 1) % 4;
  for (let f = 0; f < flagCount; f += 1) {
    addFlag(p, {
      key: `flag-${f + 1}`,
      name: `Flag ${f + 1}`,
      kind: "boolean",
      variations: onOff,
      defaultIndex: 0,
      offIndex: 1,
      enabledDev: (p + f) % 2 === 0,
      enabledProd: (p + f) % 3 === 0,
    });
  }
}

// --- Members: ~10 pages of a spread of roles so the table pages and shows
//     every chip. Famous names first, then generated ASCII names (unique, so
//     the derived emails stay unique too). ---
const FAMOUS_PEOPLE = [
  "Ada Lovelace",
  "Alan Turing",
  "Grace Hopper",
  "Katherine Johnson",
  "Edsger Dijkstra",
  "Barbara Liskov",
  "Donald Knuth",
  "Margaret Hamilton",
  "Tim Berners-Lee",
  "Radia Perlman",
  "Ken Thompson",
  "Karen Sparck Jones",
  "Vint Cerf",
  "Frances Allen",
  "Linus Torvalds",
  "Hedy Lamarr",
];
const GEN_FIRST = [
  "Nadia",
  "Omar",
  "Priya",
  "Quinn",
  "Ravi",
  "Sofia",
  "Theo",
  "Uma",
  "Victor",
  "Wendy",
  "Xavier",
  "Yara",
  "Zane",
  "Mateo",
  "Lena",
  "Kofi",
  "Jin",
  "Aria",
  "Bruno",
  "Celia",
  "Dario",
  "Esme",
  "Felix",
  "Gita",
];
const GEN_LAST = [
  "Nguyen",
  "Okafor",
  "Patel",
  "Rossi",
  "Sato",
  "Tanaka",
  "Ueda",
  "Vargas",
  "Walsh",
  "Xu",
  "Yamamoto",
  "Zhang",
  "Mbeki",
  "Larsson",
  "Kovac",
  "Jensen",
  "Ibrahim",
  "Haas",
  "Garcia",
  "Ferreira",
  "Eriksen",
  "Dubois",
  "Costa",
  "Brandt",
];
const MEMBER_COUNT = 94;
const PEOPLE = Array.from({ length: MEMBER_COUNT }, (_, i) => {
  if (i < FAMOUS_PEOPLE.length) return FAMOUS_PEOPLE[i];
  const j = i - FAMOUS_PEOPLE.length;
  const first = GEN_FIRST[j % GEN_FIRST.length];
  const last = GEN_LAST[Math.floor(j / GEN_FIRST.length) % GEN_LAST.length];
  return `${first} ${last}`;
});
const memberRoles = ["admin", "editor", "viewer", null];
PEOPLE.forEach((fullName, i) => {
  const id = `user_demo_${String(i + 1).padStart(2, "0")}`;
  const email = `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@openclaw.dev`;
  const created = now - (i + 1) * day;
  sql.push(
    `INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at, org_viewer) VALUES ('${id}', ${lit(fullName)}, ${lit(email)}, 1, ${created}, ${created}, 0);`,
  );
  const role = memberRoles[i % memberRoles.length];
  if (role) {
    sql.push(
      `INSERT OR IGNORE INTO role_grants (id, user_id, role, granted_by, created_at) VALUES ('grant_demo_${i + 1}', '${id}', '${role}', 'demo-seed', ${created});`,
    );
  }
});

// --- Access tokens: ~10 pages of editor/viewer, some revoked, varied
//     last-used. Base names cycle with a numeric suffix to stay unique. ---
const TOKEN_BASES = [
  "ci-deployer",
  "staging-bot",
  "release-runner",
  "qa-agent",
  "docs-sync",
  "metrics-exporter",
  "backup-job",
  "preview-builder",
  "slack-notifier",
  "pagerduty-hook",
  "audit-reader",
  "mobile-ci",
  "edge-warmer",
  "legacy-cron",
];
const TOKEN_COUNT = 98;
const TOKEN_NAMES = Array.from({ length: TOKEN_COUNT }, (_, i) => {
  const base = TOKEN_BASES[i % TOKEN_BASES.length];
  const cycle = Math.floor(i / TOKEN_BASES.length);
  return cycle === 0 ? base : `${base}-${cycle + 1}`;
});
TOKEN_NAMES.forEach((name, i) => {
  const id = `tok_demo_${String(i + 1).padStart(2, "0")}`;
  const created = now - (i + 2) * day;
  const role = i % 3 === 0 ? "viewer" : "editor";
  const lastUsed = i % 4 === 0 ? "NULL" : String(now - i * 7 * 3_600_000);
  const revoked = i % 5 === 0 && i > 0 ? String(now - i * 3_600_000) : "NULL";
  // Spread tokens across the first five members so each one's profile has
  // enough minted tokens (~20) to span multiple pages.
  const createdBy = `user_demo_${String((i % 5) + 1).padStart(2, "0")}`;
  sql.push(
    `INSERT OR IGNORE INTO access_tokens (id, name, role, token_hash, created_by, created_at, last_used_at, revoked_at) VALUES ('${id}', ${lit(name)}, '${role}', 'demohash_${hex(40)}', '${createdBy}', ${created}, ${lastUsed}, ${revoked});`,
  );
});

// --- Change log: a busy, varied history so it spans several pages. Attribute
//     entries to real demo members so their profiles show audit history. ---
const ACTORS = [
  { id: "user_demo_01", name: PEOPLE[0] },
  { id: "user_demo_03", name: PEOPLE[2] },
  { id: "user_demo_02", name: PEOPLE[1] },
  { id: "user_demo_08", name: PEOPLE[7] },
  { id: "user_demo_05", name: PEOPLE[4] },
];
const auroraFlagKeys = auroraFlags.map((f) => f.key);
const changeBuilders = [
  (i) => {
    const flag = auroraFlagKeys[i % auroraFlagKeys.length];
    const to = i % 2 === 0;
    return {
      action: "flag.toggle",
      projectKey: "demo-01",
      flagKey: flag,
      target: `demo-01/development/${flag}`,
      before: { enabled: !to },
      after: { enabled: to },
    };
  },
  (i) => {
    const flag = auroraFlagKeys[i % auroraFlagKeys.length];
    return {
      action: "flag.update",
      projectKey: "demo-01",
      flagKey: flag,
      target: `demo-01/development/${flag}`,
      before: { rules: 0 },
      after: { rules: 1 },
    };
  },
  (i) => ({
    action: "flag.create",
    projectKey: "demo-01",
    flagKey: `feature-${i}`,
    target: `demo-01/feature-${i}`,
    after: { key: `feature-${i}`, kind: "boolean" },
  }),
  (i) => ({
    action: "role.set",
    projectKey: null,
    flagKey: null,
    target: PEOPLE[i % PEOPLE.length],
    before: { role: null },
    after: { role: "editor" },
  }),
  (i) => ({
    action: "project.create",
    projectKey: projectKeyByIndex[i % projectKeyByIndex.length],
    flagKey: null,
    target: projectKeyByIndex[i % projectKeyByIndex.length],
    after: {
      key: projectKeyByIndex[i % projectKeyByIndex.length],
      name: PROJECTS[i % PROJECTS.length][0],
    },
  }),
  () => ({
    action: "environment.create",
    projectKey: "demo-01",
    flagKey: null,
    target: "demo-01/staging",
    after: { key: "staging", name: "Staging" },
  }),
  () => ({
    action: "key.rotate",
    projectKey: "demo-01",
    flagKey: null,
    target: "demo-01/production",
    before: { evalKey: `ks_demo-01_production_${hex()}` },
    after: { evalKey: `ks_demo-01_production_${hex()}` },
  }),
];
for (let i = 0; i < 146; i += 1) {
  const built = changeBuilders[i % changeBuilders.length](i);
  const id = `log_demo_${String(i + 1).padStart(4, "0")}`;
  const actor = ACTORS[i % ACTORS.length];
  const createdAt = now - i * 5 * 3_600_000 - i * 137_000;
  sql.push(
    `INSERT OR IGNORE INTO change_log (id, actor_user_id, actor_name, action, project_key, flag_key, target, before, after, created_at) VALUES ('${id}', '${actor.id}', ${lit(actor.name)}, '${built.action}', ${lit(built.projectKey)}, ${lit(built.flagKey)}, ${lit(built.target)}, ${built.before === undefined ? "NULL" : json(built.before)}, ${built.after === undefined ? "NULL" : json(built.after)}, ${createdAt});`,
  );
}

const file = join(mkdtempSync(join(tmpdir(), "ks-demo-")), "demo.sql");
writeFileSync(file, sql.join("\n"));
console.log(`Generated ${sql.length} demo statements. Applying to local D1…`);
execFileSync(
  "bunx",
  ["wrangler", "d1", "execute", "krillswitch", "--local", "--file", file],
  { cwd: apiRoot, stdio: "inherit" },
);
console.log("Demo data loaded. Refresh the admin app to see it.");
