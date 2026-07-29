import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, type Me, type Segment, type SegmentBody } from "../api";
import { UsersIcon } from "../components/brand";
import { EmptyState } from "../components/EmptyState";
import { BlockSkeleton } from "../components/Skeleton";

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** "true"/"false" and numerics compare as their typed values in rules. */
function coerceValue(entry: string): string | number | boolean {
  if (entry === "true") return true;
  if (entry === "false") return false;
  const numeric = Number(entry);
  if (entry.trim() !== "" && Number.isFinite(numeric)) return numeric;
  return entry;
}

type RuleDraft = { attribute: string; valuesRaw: string };

type EditorState = {
  name: string;
  keysRaw: string;
  rules: RuleDraft[];
};

function toEditor(segment: Segment): EditorState {
  return {
    name: segment.name,
    keysRaw: segment.contextKeys.join(", "),
    rules: segment.rules.map((rule) => ({
      attribute: rule.attribute,
      valuesRaw: rule.values.map(String).join(", "),
    })),
  };
}

function toBody(state: EditorState): SegmentBody | { error: string } {
  if (state.name.trim() === "") {
    return { error: "a segment needs a name" };
  }
  const rules: SegmentBody["rules"] = [];
  for (const rule of state.rules) {
    if (rule.attribute.trim() === "") {
      return { error: "a rule is missing its attribute name" };
    }
    const values = splitList(rule.valuesRaw).map(coerceValue);
    if (values.length === 0) {
      return { error: "a rule has no values to match" };
    }
    rules.push({ attribute: rule.attribute.trim(), values });
  }
  return {
    name: state.name.trim(),
    contextKeys: splitList(state.keysRaw),
    rules,
  };
}

export function SegmentsPage({ me }: { me: Me }) {
  const { projectKey = "" } = useParams();
  const canEdit = me.role === "editor" || me.role === "admin";
  const segments = useQuery({
    queryKey: ["segments", projectKey],
    queryFn: () => api.segments(projectKey),
  });

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <Link
            className="oc-page-header-kicker"
            to={`/projects/${projectKey}`}
          >
            {projectKey}
          </Link>
          <h1>Segments</h1>
        </div>
      </header>
      <p className="muted section-hint">
        Reusable audiences: pinned user keys plus attribute rules. Reference a
        segment from any flag's targeting rules; membership changes apply to
        every referencing flag at once.
      </p>
      {segments.isPending && <BlockSkeleton lines={4} />}
      {segments.isError && <p role="alert">Failed to load segments.</p>}
      {segments.isSuccess && segments.data.segments.length === 0 && (
        <EmptyState
          icon={<UsersIcon className="empty-state-glyph" />}
          title="No segments yet"
          description="Define an audience once — beta testers, internal staff, a customer tier — and target it from any flag."
        />
      )}
      {segments.isSuccess &&
        segments.data.segments.map((segment) => (
          <SegmentCard
            key={segment.id}
            projectKey={projectKey}
            segment={segment}
            canEdit={canEdit}
          />
        ))}
      {canEdit && <NewSegmentForm projectKey={projectKey} />}
    </section>
  );
}

function SegmentEditorFields({
  state,
  disabled,
  onChange,
}: {
  state: EditorState;
  disabled: boolean;
  onChange: (state: EditorState) => void;
}) {
  return (
    <>
      <label className="oc-field">
        <span className="oc-field-label">Name</span>
        <input
          className="oc-input"
          value={state.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...state, name: event.target.value })}
        />
      </label>
      <label className="oc-field">
        <span className="oc-field-label">Pinned user keys</span>
        <input
          className="oc-input input-mono"
          placeholder="user keys, comma separated"
          value={state.keysRaw}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...state, keysRaw: event.target.value })
          }
        />
      </label>
      {state.rules.map((rule, index) => (
        <div
          className="targeting-row"
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
          key={index}
        >
          <span className="targeting-arrow muted">if</span>
          <input
            className="oc-input input-mono targeting-attribute"
            placeholder="attribute"
            aria-label={`Segment rule ${index + 1} attribute`}
            value={rule.attribute}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...state,
                rules: state.rules.map((row, position) =>
                  position === index
                    ? { ...row, attribute: event.target.value }
                    : row,
                ),
              })
            }
          />
          <span className="targeting-arrow muted">in</span>
          <input
            className="oc-input input-mono targeting-values"
            placeholder="values, comma separated"
            aria-label={`Segment rule ${index + 1} values`}
            value={rule.valuesRaw}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...state,
                rules: state.rules.map((row, position) =>
                  position === index
                    ? { ...row, valuesRaw: event.target.value }
                    : row,
                ),
              })
            }
          />
          {!disabled && (
            <button
              type="button"
              className="oc-action oc-action-secondary"
              aria-label={`Remove segment rule ${index + 1}`}
              onClick={() =>
                onChange({
                  ...state,
                  rules: state.rules.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="oc-action oc-action-secondary"
          onClick={() =>
            onChange({
              ...state,
              rules: [...state.rules, { attribute: "", valuesRaw: "" }],
            })
          }
        >
          Add rule
        </button>
      )}
    </>
  );
}

function SegmentCard({
  projectKey,
  segment,
  canEdit,
}: {
  projectKey: string;
  segment: Segment;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<EditorState>(() => toEditor(segment));
  const [error, setError] = useState<string | null>(null);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["segments", projectKey] });

  const save = useMutation({
    mutationFn: (body: SegmentBody) =>
      api.updateSegment(projectKey, segment.key, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSegment(projectKey, segment.key),
    onSuccess: invalidate,
  });

  function onSave() {
    const body = toBody(state);
    if ("error" in body) {
      setError(body.error);
      return;
    }
    setError(null);
    save.mutate(body);
  }

  return (
    <details className="detail-section segment-card">
      <summary className="segment-summary">
        <strong>{segment.name}</strong>
        <code>{segment.key}</code>
        <span className="muted">
          {segment.contextKeys.length} pinned · {segment.rules.length} rule
          {segment.rules.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="segment-body">
        <SegmentEditorFields
          state={state}
          disabled={!canEdit || save.isPending}
          onChange={setState}
        />
        {error && (
          <p role="alert" className="save-error">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="segment-actions">
            <button
              type="button"
              className="oc-action oc-action-ghost danger-ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete segment
            </button>
            <button
              type="button"
              className="oc-action oc-action-primary"
              disabled={save.isPending}
              onClick={onSave}
            >
              Save segment
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

function NewSegmentForm({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [state, setState] = useState<EditorState>({
    name: "",
    keysRaw: "",
    rules: [],
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: SegmentBody & { key: string }) =>
      api.createSegment(projectKey, body),
    onSuccess: () => {
      setKey("");
      setState({ name: "", keysRaw: "", rules: [] });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["segments", projectKey] });
    },
  });

  function onCreate() {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(key)) {
      setError("keys are lowercase alphanumerics plus . _ -");
      return;
    }
    const body = toBody(state);
    if ("error" in body) {
      setError(body.error);
      return;
    }
    setError(null);
    create.mutate({ ...body, key });
  }

  return (
    <section className="detail-section">
      <h2>New segment</h2>
      <label className="oc-field">
        <span className="oc-field-label">Key</span>
        <input
          className="oc-input input-mono"
          placeholder="beta-testers"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <SegmentEditorFields state={state} disabled={false} onChange={setState} />
      {error && (
        <p role="alert" className="save-error">
          {error}
        </p>
      )}
      {create.isError && (
        <p role="alert" className="save-error">
          Creating the segment failed — the key may already exist.
        </p>
      )}
      <div className="segment-actions">
        <button
          type="button"
          className="oc-action oc-action-primary"
          disabled={create.isPending}
          onClick={onCreate}
        >
          Create segment
        </button>
      </div>
    </section>
  );
}
