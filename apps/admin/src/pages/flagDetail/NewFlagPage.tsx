import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api, type FlagKind } from "../../api";
import { type Draft, fromDraft } from "./draft";
import { VariationsEditor } from "./VariationsEditor";

const KINDS: FlagKind[] = ["boolean", "string", "number", "json"];

function initialDraft(kind: FlagKind): Draft {
  const variations =
    kind === "boolean"
      ? [
          { raw: "true", name: "On" },
          { raw: "false", name: "Off" },
        ]
      : [
          { raw: "", name: "" },
          { raw: "", name: "" },
        ];
  return {
    enabled: false,
    variations,
    offIndex: variations.length - 1,
    defaultIndex: 0,
    targets: [],
    rules: [],
    rolloutEnabled: false,
    weights: variations.map(() => 0),
  };
}

export function NewFlagPage() {
  const { projectKey = "", environmentKey = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FlagKind>("boolean");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<Draft>(() => initialDraft("boolean"));
  const [draftError, setDraftError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createFlag>[1]) =>
      api.createFlag(projectKey, body),
    onSuccess: (_, body) => {
      queryClient.invalidateQueries({
        queryKey: ["flags", projectKey, environmentKey],
      });
      navigate(`/projects/${projectKey}/${environmentKey}/flags/${body.key}`);
    },
  });

  function changeKind(next: FlagKind) {
    setKind(next);
    setDraft(initialDraft(next));
  }

  function onCreate() {
    if (key.trim() === "" || name.trim() === "") {
      setDraftError("key and name are required");
      return;
    }
    const converted = fromDraft(draft, kind);
    if ("error" in converted) {
      setDraftError(converted.error);
      return;
    }
    setDraftError(null);
    create.mutate({
      key: key.trim(),
      name: name.trim(),
      kind,
      description: description.trim() === "" ? undefined : description.trim(),
      variations: converted.body.variations.map(({ value, name: vName }) => ({
        value,
        name: vName,
      })),
      defaultVariationIndex: converted.body.defaultVariationIndex,
      offVariationIndex: converted.body.offVariationIndex,
      enabled: draft.enabled,
    });
  }

  const serverError =
    create.error instanceof ApiError
      ? create.error.status === 409
        ? "A flag with this key already exists."
        : (create.error.serverMessage ?? "Creating the flag failed.")
      : create.isError
        ? "Creating the flag failed."
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
          <h1>New flag</h1>
        </div>
      </header>

      <section className="detail-section">
        <h2>Basics</h2>
        <div className="form-grid">
          <label htmlFor="new-flag-key">Key</label>
          <input
            id="new-flag-key"
            className="oc-input input-mono"
            placeholder="my-new-flag"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <label htmlFor="new-flag-name">Name</label>
          <input
            id="new-flag-name"
            className="oc-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor="new-flag-kind">Kind</label>
          <Select
            value={kind}
            onValueChange={(value) => {
              const next = KINDS.find((candidate) => candidate === value);
              if (next) {
                changeKind(next);
              }
            }}
          >
            <SelectTrigger id="new-flag-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label htmlFor="new-flag-description">Description</label>
          <input
            id="new-flag-description"
            className="oc-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <label htmlFor="new-flag-enabled">Enabled</label>
          <label className="enabled-control" id="new-flag-enabled">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />
            On in every environment immediately
          </label>
        </div>
      </section>

      <VariationsEditor
        kind={kind}
        variations={draft.variations}
        offIndex={draft.offIndex}
        defaultIndex={draft.defaultIndex}
        disabled={false}
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

      {(draftError ?? serverError) && (
        <p role="alert" className="save-error">
          {draftError ?? serverError}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="oc-action oc-action-primary"
          disabled={create.isPending}
          onClick={onCreate}
        >
          Create flag
        </button>
        <Link
          className="oc-action oc-action-ghost btn-link"
          to={`/projects/${projectKey}/${environmentKey}`}
        >
          Cancel
        </Link>
      </div>
    </section>
  );
}
