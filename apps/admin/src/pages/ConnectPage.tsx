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

const RESPONSE_SHAPE = [
  `{`,
  `  "flags": {`,
  `    "my-flag": {`,
  `      "value": true,`,
  `      "variationId": "var_…",`,
  `      "reason": { "kind": "rule", "attribute": "role" }`,
  `    }`,
  `  }`,
  `}`,
].join("\n");

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

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="step-card">
      <span className="step-num" aria-hidden="true">
        {number}
      </span>
      <div className="step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </li>
  );
}

/** Time-to-first-flag: pick a project + environment, copy a working call.
 *  Admins get the real eval key inlined; other roles get a placeholder
 *  (keys are admin-scoped). The status step polls so the page flips to
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
            <SelectTrigger aria-label="Project" className="w-auto">
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
            <SelectTrigger aria-label="Environment" className="w-auto">
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
        <ol className="step-list">
          <Step number={1} title="Grab the eval key">
            <p className="muted step-hint">
              Each environment has one public flag-set key.{" "}
              {isAdmin
                ? "This environment's key is inlined below and in the snippets."
                : "Keys are admin-scoped — ask an admin for it, then replace the placeholder."}
            </p>
            <p className="flag-meta">
              <EnvBadge
                envKey={activeEnvironment.key}
                name={activeEnvironment.name}
              />
              <code>{evalKey}</code>
              {evalKey !== PLACEHOLDER_KEY && (
                <CopyButton value={evalKey} label="eval key" />
              )}
            </p>
          </Step>

          <Step number={2} title="Call the eval endpoint">
            <p className="muted step-hint">
              One POST returns every flag in the environment, evaluated for the
              context you send. Run either snippet as-is.
            </p>
            <Snippet label="curl" code={curlSnippet(origin, evalKey)} />
            <Snippet label="JavaScript" code={jsSnippet(origin, evalKey)} />
          </Step>

          <Step number={3} title="Watch it connect">
            {activeEnvironment.lastEvalAt ? (
              <p className="connect-status">
                <span className="oc-badge oc-badge-success">Connected</span>
                <span className="muted">
                  {activeEnvironment.evalCount.toLocaleString()} request
                  {activeEnvironment.evalCount === 1 ? "" : "s"} from{" "}
                  {activeEnvironment.name} so far.
                </span>
              </p>
            ) : (
              <p className="connect-status">
                <span className="pulse-dot" aria-hidden="true" />
                <span className="muted">
                  Waiting for the first request — this updates by itself the
                  moment your snippet runs.
                </span>
              </p>
            )}
            <details className="connect-docs">
              <summary>Response shape and caching notes</summary>
              <Snippet label="Response" code={RESPONSE_SHAPE} />
              <ul className="connect-notes">
                <li>
                  <code>reason.kind</code> tells you why a value was served:
                  <code>off</code>, <code>target</code>, <code>rule</code>,{" "}
                  <code>segment</code>, <code>rollout</code>, or{" "}
                  <code>default</code>.
                </li>
                <li>
                  Responses carry an <code>ETag</code>; send{" "}
                  <code>if-none-match</code> on re-polls and a <code>304</code>{" "}
                  means nothing changed.
                </li>
                <li>
                  Bodies are personalized per context and marked{" "}
                  <code>private, no-store</code> — never cache them in a shared
                  cache.
                </li>
                <li>
                  <code>context.key</code> identifies the user (stable rollout
                  bucketing); <code>attributes</code> are what rules and
                  segments match on.
                </li>
              </ul>
            </details>
          </Step>
        </ol>
      )}
    </section>
  );
}
