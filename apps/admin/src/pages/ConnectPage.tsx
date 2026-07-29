import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type Me } from "../api";
import { CopyButton } from "../components/CopyButton";
import { EnvBadge } from "../components/EnvBadge";
import { BlockSkeleton } from "../components/Skeleton";

const PLACEHOLDER_KEY = "<EVAL_KEY>";

function curlSnippet(origin: string, evalKey: string): string {
  return [
    `curl -X POST ${origin}/v1/eval \\`,
    `  -H "authorization: Bearer ${evalKey}" \\`,
    `  -H "content-type: application/json" \\`,
    `  -d '{"context":{"key":"user-123","attributes":{"role":"admin"}}}'`,
  ].join("\n");
}

function jsSnippet(origin: string, evalKey: string): string {
  return [
    `const response = await fetch("${origin}/v1/eval", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    authorization: "Bearer ${evalKey}",`,
    `    "content-type": "application/json",`,
    `  },`,
    `  body: JSON.stringify({`,
    `    context: { key: "user-123", attributes: { role: "admin" } },`,
    `  }),`,
    `});`,
    `const { flags } = await response.json();`,
    `if (flags["my-flag"]?.value) {`,
    `  // feature is on for this context`,
    `}`,
  ].join("\n");
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span className="snippet-label">{label}</span>
        <CopyButton value={code} label={`${label} snippet`} />
      </div>
      <pre className="snippet-code">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Time-to-first-flag: pick a project + environment, copy a working call.
 *  Admins get the real eval key inlined; other roles get a placeholder
 *  (keys are admin-scoped). The freshness line polls so the page flips to
 *  "connected" the moment the first request lands. */
export function ConnectPage({ me }: { me: Me }) {
  const isAdmin = me.role === "admin";
  const projects = useQuery({
    queryKey: ["project-options"],
    queryFn: () => api.projects({ limit: 100 }),
  });
  const projectList = projects.data?.projects ?? [];
  const [projectKey, setProjectKey] = useState<string>();
  const activeProject = projectKey ?? projectList[0]?.key ?? "";

  const detail = useQuery({
    queryKey: ["project", activeProject],
    queryFn: () => api.projectDetail(activeProject),
    enabled: activeProject !== "",
    // Flip to "connected" as soon as the user's first eval request lands.
    refetchInterval: 5000,
  });
  const keys = useQuery({
    queryKey: ["keys", activeProject],
    queryFn: () => api.keys(activeProject),
    enabled: isAdmin && activeProject !== "",
  });

  const environments = detail.data?.environments ?? [];
  const [environmentKey, setEnvironmentKey] = useState<string>();
  const activeEnvironment =
    environments.find((env) => env.key === environmentKey) ?? environments[0];

  const evalKey = isAdmin
    ? (keys.data?.keys.find(
        (entry) => entry.environmentKey === activeEnvironment?.key,
      )?.evalKey ?? PLACEHOLDER_KEY)
    : PLACEHOLDER_KEY;
  const origin = window.location.origin;

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <h1>Connect your app</h1>
        </div>
        <div className="oc-page-header-actions">
          <Select
            value={activeProject || undefined}
            onValueChange={(key) => {
              setProjectKey(key);
              setEnvironmentKey(undefined);
            }}
          >
            <SelectTrigger
              aria-label="Project"
              className="w-auto min-w-[160px]"
            >
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {projectList.map((project) => (
                <SelectItem key={project.key} value={project.key}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={activeEnvironment?.key}
            onValueChange={setEnvironmentKey}
          >
            <SelectTrigger
              aria-label="Environment"
              className="w-auto min-w-[160px]"
            >
              <SelectValue placeholder="Environment" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.key}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {projects.isPending && <BlockSkeleton lines={4} />}
      {projects.isSuccess && projectList.length === 0 && (
        <p className="muted">
          Create a project first — nothing to connect yet.
        </p>
      )}

      {activeEnvironment && (
        <>
          <p className="connect-status">
            <EnvBadge
              envKey={activeEnvironment.key}
              name={activeEnvironment.name}
            />
            {activeEnvironment.lastEvalAt ? (
              <span className="oc-badge oc-badge-success">
                Connected — {activeEnvironment.evalCount.toLocaleString()}{" "}
                requests
              </span>
            ) : (
              <span className="oc-badge oc-badge-neutral">
                Waiting for the first request…
              </span>
            )}
          </p>
          <section className="detail-section">
            <h2>1 · Grab the eval key</h2>
            <p className="muted section-hint">
              {isAdmin
                ? "This environment's key is inlined below."
                : "Ask an admin for this environment's eval key, then replace the placeholder below."}
            </p>
            <p className="flag-meta">
              <code>{evalKey}</code>
              {evalKey !== PLACEHOLDER_KEY && (
                <CopyButton value={evalKey} label="eval key" />
              )}
            </p>
          </section>
          <section className="detail-section">
            <h2>2 · Evaluate flags</h2>
            <p className="muted section-hint">
              One POST returns every flag for the environment, evaluated for the
              given context. Responses carry an ETag for cheap re-polls.
            </p>
            <Snippet label="curl" code={curlSnippet(origin, evalKey)} />
            <Snippet label="JavaScript" code={jsSnippet(origin, evalKey)} />
          </section>
        </>
      )}
    </section>
  );
}
