import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, type FlagDetail, type Me } from "../../api";
import { type Draft, fromDraft, toDraft } from "./draft";
import { AllowlistEditor, RolloutEditor, RulesEditor } from "./TargetingEditor";
import { VariationsEditor } from "./VariationsEditor";

export function FlagDetailPage({ me }: { me: Me }) {
  const { projectKey = "", environmentKey = "", flagKey = "" } = useParams();

  const detail = useQuery({
    queryKey: ["flag", projectKey, environmentKey, flagKey],
    queryFn: () => api.flagDetail(projectKey, environmentKey, flagKey),
  });

  if (detail.isPending) {
    return <p className="muted">Loading flag…</p>;
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
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateFlag>[3]) =>
      api.updateFlag(projectKey, environmentKey, flagKey, body),
    onSuccess: (updated) => {
      // Re-seed the draft from the response: new variations now carry their
      // server-assigned ids, so a second save edits instead of duplicating.
      setDraft(toDraft(updated));
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
            <span className="muted"> · {detail.flag.kind}</span>
          </p>
          {detail.flag.description && (
            <p className="muted flag-description">{detail.flag.description}</p>
          )}
        </div>
        <div className="header-actions">
          <label className="enabled-control">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={readOnly}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />
            Enabled in {environmentKey}
          </label>
          {me.role === "admin" &&
            (confirmingDelete ? (
              <span className="confirm-delete">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete flag
              </button>
            ))}
        </div>
      </header>

      {remove.isError && (
        <p role="alert">Deleting failed. Refresh and retry.</p>
      )}

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

      {!readOnly && (
        <footer className="save-bar">
          {(draftError ?? serverError) && (
            <p role="alert" className="save-error">
              {draftError ?? serverError}
            </p>
          )}
          {save.isSuccess && !draftError && (
            <p className="muted">Saved. Live within a second.</p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending}
            onClick={onSave}
          >
            Save changes
          </button>
        </footer>
      )}
    </section>
  );
}
