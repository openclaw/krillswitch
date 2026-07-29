import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, type FlagDetail, type Me } from "../../api";
import { ChevronDownIcon } from "../../components/brand";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CopyButton } from "../../components/CopyButton";
import { EnvBadge, isProductionEnv } from "../../components/EnvBadge";
import { GuardrailDialog } from "../../components/GuardrailDialog";
import { BlockSkeleton } from "../../components/Skeleton";
import { Switch } from "../../components/Switch";
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
    return (
      <section>
        <header className="oc-page-header">
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
  // Captured from the same object that seeds `draft`, so its row ids line up.
  const [savedDraft, setSavedDraft] = useState<Draft>(() => draft);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Optional everywhere, required by the guardrail before production saves.
  const [comment, setComment] = useState("");
  const [guardOpen, setGuardOpen] = useState(false);
  const isProduction = isProductionEnv(environmentKey);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

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
      setSavedDraft(next);
      setComment("");
      setGuardOpen(false);
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
  const draftDisabled = readOnly || save.isPending;

  function onSave() {
    const converted = fromDraft(draft, detail.flag.kind);
    if ("error" in converted) {
      setDraftError(converted.error);
      return;
    }
    setDraftError(null);
    if (isProduction) {
      // Production goes through the guardrail: confirm + required comment.
      setGuardOpen(true);
      return;
    }
    save.mutate({ ...converted.body, comment: comment.trim() || undefined });
  }

  function onConfirmProductionSave() {
    const converted = fromDraft(draft, detail.flag.kind);
    if ("error" in converted) {
      setDraftError(converted.error);
      setGuardOpen(false);
      return;
    }
    save.mutate({ ...converted.body, comment: comment.trim() || undefined });
  }

  function onDiscard() {
    setDraft(savedDraft);
    setDraftError(null);
    setComment("");
    save.reset();
  }

  const serverError =
    save.error instanceof ApiError
      ? (save.error.serverMessage ?? "Saving failed.")
      : save.isError
        ? "Saving failed."
        : null;

  return (
    <section className={`flag-editor ${isDirty ? "is-dirty" : ""}`}>
      <header className="oc-page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to={`/projects/${projectKey}/${environmentKey}`}>
              {projectKey}
            </Link>
            <span className="muted">/</span>
            <EnvBadge envKey={environmentKey} />
          </nav>
          <h1>{detail.flag.name}</h1>
          <p className="flag-meta">
            <code>{detail.flag.key}</code>
            <CopyButton value={detail.flag.key} label="flag key" />
            <span className="flag-meta-sep">·</span>
            <span className="badge-kind">{detail.flag.kind}</span>
          </p>
          {detail.flag.description && (
            <p className="muted flag-description">{detail.flag.description}</p>
          )}
        </div>
        <div className="oc-page-header-actions">
          <div className="enable-switch">
            <Switch
              checked={draft.enabled}
              disabled={draftDisabled}
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
                <button type="button" className="oc-action oc-action-secondary">
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

      {!readOnly && isDirty && (
        <>
          {(draftError ?? serverError) && (
            <p role="alert" className="save-error">
              {draftError ?? serverError}
            </p>
          )}
          <section className="save-bar" aria-label="Unsaved changes">
            <strong className="save-bar-status">Unsaved changes</strong>
            <input
              className="oc-input save-comment"
              value={comment}
              maxLength={500}
              disabled={save.isPending}
              placeholder={
                isProduction
                  ? "Comment (required for production)"
                  : "Comment for the change log (optional)"
              }
              aria-label="Change log comment"
              onChange={(event) => setComment(event.currentTarget.value)}
            />
            <div className="save-actions">
              <button
                type="button"
                className="oc-action oc-action-secondary"
                aria-label="Discard changes"
                onClick={onDiscard}
                disabled={save.isPending}
              >
                <span className="save-label-full">Discard changes</span>
                <span className="save-label-short">Discard</span>
              </button>
              <button
                type="button"
                className="oc-action oc-action-primary"
                disabled={save.isPending}
                onClick={onSave}
              >
                Save changes
              </button>
            </div>
          </section>
        </>
      )}
      {!readOnly && !isDirty && save.isSuccess && (
        <p className="muted save-ok">Saved. Live within a second.</p>
      )}
      <GuardrailDialog
        open={guardOpen}
        onOpenChange={setGuardOpen}
        environmentKey={environmentKey}
        title="Save to production?"
        description={`These changes to “${detail.flag.name}” go live for real traffic as soon as they save.`}
        confirmLabel="Save to production"
        comment={comment}
        onCommentChange={setComment}
        onConfirm={onConfirmProductionSave}
        pending={save.isPending}
      />

      <VariationsEditor
        kind={detail.flag.kind}
        variations={draft.variations}
        offIndex={draft.offIndex}
        defaultIndex={draft.defaultIndex}
        disabled={draftDisabled}
        onChange={({ variations, offIndex, defaultIndex, removedIndex }) => {
          const reindex = (index: number) =>
            removedIndex === undefined || index < removedIndex
              ? index
              : index - 1;
          setDraft({
            ...draft,
            variations,
            offIndex,
            defaultIndex,
            targets:
              removedIndex === undefined
                ? draft.targets
                : draft.targets
                    .filter((target) => target.variationIndex !== removedIndex)
                    .map((target) => ({
                      ...target,
                      variationIndex: reindex(target.variationIndex),
                    })),
            rules:
              removedIndex === undefined
                ? draft.rules
                : draft.rules
                    .filter((rule) => rule.variationIndex !== removedIndex)
                    .map((rule) => ({
                      ...rule,
                      variationIndex: reindex(rule.variationIndex),
                    })),
            weights:
              removedIndex === undefined
                ? variations.map((_, index) => draft.weights[index] ?? 0)
                : draft.weights.filter((_, index) => index !== removedIndex),
          });
        }}
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
              Checked in order: allowlist, then rules, then rollout. If nothing
              matches, the flag serves the variation selected under “When no
              rule matches.”
            </p>
            <AllowlistEditor
              targets={draft.targets}
              variations={draft.variations}
              disabled={draftDisabled}
              onChange={(targets) => setDraft({ ...draft, targets })}
            />
            <RulesEditor
              rules={draft.rules}
              variations={draft.variations}
              disabled={draftDisabled}
              onChange={(rules) => setDraft({ ...draft, rules })}
            />
            <RolloutEditor
              enabled={draft.rolloutEnabled}
              weights={draft.weights}
              variations={draft.variations}
              disabled={draftDisabled}
              onChange={({ enabled, weights }) =>
                setDraft({ ...draft, rolloutEnabled: enabled, weights })
              }
            />
          </div>
        )}
      </section>
    </section>
  );
}
