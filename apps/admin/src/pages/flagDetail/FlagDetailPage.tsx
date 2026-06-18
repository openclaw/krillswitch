import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, type FlagDetail, type Me } from "../../api";
import { ChevronDownIcon } from "../../components/brand";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { BlockSkeleton } from "../../components/Skeleton";
import { Switch } from "../../components/Switch";
import { type Draft, fromDraft, toDraft, variationLabel } from "./draft";
import { AllowlistEditor, RolloutEditor, RulesEditor } from "./TargetingEditor";
import { VariationsEditor } from "./VariationsEditor";

export function FlagDetailPage({ me }: { me: Me }) {
  const { projectKey = "", environmentKey = "", flagKey = "" } = useParams();

  const detail = useQuery({
    queryKey: ["flag", projectKey, environmentKey, flagKey],
    queryFn: () => api.flagDetail(projectKey, environmentKey, flagKey),
  });

  if (detail.isPending) {
    return (
      <section>
        <header className="page-header">
          <h1>Flag</h1>
        </header>
        <BlockSkeleton lines={5} />
      </section>
    );
  }
  if (detail.isError) {
    return <p role="alert">Failed to load this flag.</p>;
  }

  return (
    <FlagDetailEditor
      // Remount when navigating to a different flag so the draft resets.
      key={`${projectKey}/${environmentKey}/${flagKey}`}
      me={me}
      detail={detail.data}
      projectKey={projectKey}
      environmentKey={environmentKey}
    />
  );
}

function FlagDetailEditor({
  me,
  detail,
  projectKey,
  environmentKey,
}: {
  me: Me;
  detail: FlagDetail;
  projectKey: string;
  environmentKey: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const flagKey = detail.flag.key;
  const readOnly = me.role === "viewer";

  const [draft, setDraft] = useState<Draft>(() => toDraft(detail));
  // Snapshot of the last-saved draft (captured from the same object that seeds
  // `draft`, so its row ids line up). Drives the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(draft),
  );
  const [draftError, setDraftError] = useState<string | null>(null);

  const isDirty = JSON.stringify(draft) !== savedSnapshot;

  // Targeting is collapsed by default unless the flag already has some.
  const [targetingOpen, setTargetingOpen] = useState(
    () => draft.targets.length + draft.rules.length > 0 || draft.rolloutEnabled,
  );
  const targetingParts: string[] = [];
  if (draft.targets.length > 0) {
    targetingParts.push(`${draft.targets.length} allowlisted`);
  }
  if (draft.rules.length > 0) {
    targetingParts.push(
      `${draft.rules.length} rule${draft.rules.length > 1 ? "s" : ""}`,
    );
  }
  if (draft.rolloutEnabled) {
    targetingParts.push("rollout");
  }
  const targetingSummary =
    targetingParts.length > 0 ? targetingParts.join(" · ") : "none set";

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateFlag>[3]) =>
      api.updateFlag(projectKey, environmentKey, flagKey, body),
    onSuccess: (updated) => {
      // Re-seed the draft from the response: new variations now carry their
      // server-assigned ids, so a second save edits instead of duplicating.
      const next = toDraft(updated);
      setDraft(next);
      setSavedSnapshot(JSON.stringify(next));
      queryClient.setQueryData(
        ["flag", projectKey, environmentKey, flagKey],
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: ["flags", projectKey, environmentKey],
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteFlag(projectKey, flagKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["flags", projectKey, environmentKey],
      });
      navigate(`/projects/${projectKey}/${environmentKey}`);
    },
  });

  function onSave() {
    const converted = fromDraft(draft, detail.flag.kind);
    if ("error" in converted) {
      setDraftError(converted.error);
      return;
    }
    setDraftError(null);
    save.mutate(converted.body);
  }

  const serverError =
    save.error instanceof ApiError
      ? (save.error.serverMessage ?? "Saving failed.")
      : save.isError
        ? "Saving failed."
        : null;

  return (
    <section>
      <header className="page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to={`/projects/${projectKey}/${environmentKey}`}>
              {projectKey}
            </Link>
            <span className="muted"> / {environmentKey}</span>
          </nav>
          <h1>{detail.flag.name}</h1>
          <p className="flag-meta">
            <code>{detail.flag.key}</code>
            <span className="flag-meta-sep">·</span>
            <span className="badge-kind">{detail.flag.kind}</span>
          </p>
          {detail.flag.description && (
            <p className="muted flag-description">{detail.flag.description}</p>
          )}
        </div>
        <div className="header-actions">
          <div className="enable-switch">
            <Switch
              checked={draft.enabled}
              disabled={readOnly}
              ariaLabel={`Flag enabled in ${environmentKey}`}
              onChange={(next) => setDraft({ ...draft, enabled: next })}
              onLabel={`Enabled in ${environmentKey}`}
              offLabel={`Disabled in ${environmentKey}`}
            />
          </div>
          {me.role === "admin" && (
            <ConfirmDialog
              title={`Delete “${detail.flag.name}”?`}
              description="This removes the flag and its targeting from every environment. Clients evaluating it fall back to their own default. This can't be undone."
              confirmLabel="Delete flag"
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
              trigger={
                <button type="button" className="btn btn-quiet">
                  Delete flag
                </button>
              }
            />
          )}
        </div>
      </header>

      {remove.isError && (
        <p role="alert">Deleting failed. Refresh and retry.</p>
      )}

      <StatePanel draft={draft} environmentKey={environmentKey} />

      <VariationsEditor
        kind={detail.flag.kind}
        variations={draft.variations}
        offIndex={draft.offIndex}
        defaultIndex={draft.defaultIndex}
        disabled={readOnly}
        onChange={({ variations, offIndex, defaultIndex }) =>
          setDraft({
            ...draft,
            variations,
            offIndex,
            defaultIndex,
            weights: variations.map((_, index) => draft.weights[index] ?? 0),
          })
        }
      />

      <section className="detail-section">
        <button
          type="button"
          className="disclosure"
          aria-expanded={targetingOpen}
          onClick={() => setTargetingOpen((open) => !open)}
        >
          <ChevronDownIcon
            className={`disclosure-chevron ${targetingOpen ? "is-open" : ""}`}
          />
          <span className="disclosure-title">Targeting</span>
          <span className="disclosure-meta">{targetingSummary}</span>
        </button>
        {targetingOpen && (
          <div className="disclosure-body">
            <p className="section-hint">
              Checked in order — allowlist, then rules, then rollout. Anyone not
              matched gets the default.
            </p>
            <AllowlistEditor
              targets={draft.targets}
              variations={draft.variations}
              disabled={readOnly}
              onChange={(targets) => setDraft({ ...draft, targets })}
            />
            <RulesEditor
              rules={draft.rules}
              variations={draft.variations}
              disabled={readOnly}
              onChange={(rules) => setDraft({ ...draft, rules })}
            />
            <RolloutEditor
              enabled={draft.rolloutEnabled}
              weights={draft.weights}
              variations={draft.variations}
              disabled={readOnly}
              onChange={({ enabled, weights }) =>
                setDraft({ ...draft, rolloutEnabled: enabled, weights })
              }
            />
          </div>
        )}
      </section>

      {!readOnly && isDirty && (
        <>
          {(draftError ?? serverError) && (
            <p role="alert" className="save-error">
              {draftError ?? serverError}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.isPending}
              onClick={onSave}
            >
              Save changes
            </button>
          </div>
        </>
      )}
      {!readOnly && !isDirty && save.isSuccess && (
        <p className="muted save-ok">Saved. Live within a second.</p>
      )}
    </section>
  );
}

function labelAt(draft: Draft, index: number): string {
  const variation = draft.variations[index];
  return variation ? variationLabel(variation, index) : "—";
}

/** Plain-language summary of what the flag serves right now in this env. */
function StatePanel({
  draft,
  environmentKey,
}: {
  draft: Draft;
  environmentKey: string;
}) {
  const hasTargeting =
    draft.targets.length + draft.rules.length > 0 || draft.rolloutEnabled;
  return (
    <div className={`flag-state ${draft.enabled ? "is-on" : "is-off"}`}>
      <span className="flag-state-dot" aria-hidden="true" />
      <p className="flag-state-text">
        {!draft.enabled ? (
          <>
            Off in <strong>{environmentKey}</strong> — every request gets{" "}
            <span className="badge-soft">{labelAt(draft, draft.offIndex)}</span>
            .
          </>
        ) : hasTargeting ? (
          <>
            Matched users get their target; everyone else in{" "}
            <strong>{environmentKey}</strong> gets{" "}
            <span className="badge-soft">
              {labelAt(draft, draft.defaultIndex)}
            </span>
            .
          </>
        ) : (
          <>
            Everyone in <strong>{environmentKey}</strong> gets{" "}
            <span className="badge-soft">
              {labelAt(draft, draft.defaultIndex)}
            </span>
            .
          </>
        )}
      </p>
    </div>
  );
}
