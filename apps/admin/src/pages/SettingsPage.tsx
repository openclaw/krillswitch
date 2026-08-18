import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type Me } from "../api";
import { RoleChip } from "../components/RoleChip";
import { Switch } from "../components/Switch";
import { THEME_ICONS, THEME_LABELS } from "../components/ThemeToggle";
import type { ThemeMode } from "../theme";
import type { ThemeControl } from "../useThemeMode";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

type SettingsTab = "profile" | "appearance" | "webhooks" | "about";

export function SettingsPage({ me, theme }: { me: Me; theme: ThemeControl }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "appearance", label: "Appearance" },
    ...(me.role === "admin"
      ? [{ id: "webhooks" as const, label: "Webhooks" }]
      : []),
    { id: "about", label: "About" },
  ];
  const requested = searchParams.get("tab");
  const tab: SettingsTab = tabs.some((entry) => entry.id === requested)
    ? (requested as SettingsTab)
    : "profile";

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`settings-tab ${tab === entry.id ? "is-active" : ""}`}
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() =>
              setSearchParams(entry.id === "profile" ? {} : { tab: entry.id }, {
                replace: true,
              })
            }
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "profile" && <ProfileSection me={me} />}
      {tab === "appearance" && <AppearanceSection theme={theme} />}
      {tab === "webhooks" && me.role === "admin" && <WebhooksSection />}
      {tab === "about" && <AboutSection />}
    </section>
  );
}

function ProfileSection({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  async function signOut() {
    await api.signOut().catch(() => {});
    if (me.signOutUrl) {
      window.location.href = me.signOutUrl;
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }
  return (
    <section className="detail-section">
      <h2>Profile</h2>
      <p className="muted section-hint">
        Accounts and roles are managed by an admin under Members.
      </p>
      <div className="settings-fields">
        <div className="oc-field">
          <span className="oc-field-label">Name</span>
          <span className="field-value">{me.user.name}</span>
        </div>
        <div className="oc-field">
          <span className="oc-field-label">Email</span>
          <span className="field-value">{me.user.email}</span>
        </div>
        <div className="oc-field">
          <span className="oc-field-label">Role</span>
          <span className="field-value">
            <RoleChip role={me.role} />
          </span>
        </div>
      </div>
      <div className="segment-actions">
        <button
          type="button"
          className="oc-action oc-action-secondary"
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

function AppearanceSection({ theme }: { theme: ThemeControl }) {
  return (
    <section className="detail-section">
      <h2>Appearance</h2>
      <p className="muted section-hint">
        Applies to this browser only. The control in the sidebar cycles the same
        setting.
      </p>
      <fieldset className="theme-picker">
        <legend className="visually-hidden">Color theme</legend>
        {THEME_MODES.map((mode) => (
          <label
            key={mode}
            className={`theme-picker-option ${theme.mode === mode ? "is-active" : ""}`}
          >
            <input
              type="radio"
              name="theme-mode"
              className="visually-hidden"
              checked={theme.mode === mode}
              onChange={() => theme.setMode(mode)}
            />
            <span className="oc-theme-toggle-icon">{THEME_ICONS[mode]}</span>
            {THEME_LABELS[mode]}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function AboutSection() {
  return (
    <section className="detail-section">
      <h2>About</h2>
      <p className="muted">
        KrillSwitch is an{" "}
        <a href="https://openclaw.ai" rel="noreferrer">
          OpenClaw Foundation
        </a>{" "}
        project — open-source feature flags for agents and apps. Styled with{" "}
        <a href="https://carapace.design" rel="noreferrer">
          Carapace
        </a>
        .
      </p>
      <p className="muted">
        Getting started? <Link to="/connect">Connect your app</Link> walks
        through the eval endpoint; admins mint CI credentials under{" "}
        <Link to="/access/tokens">Access tokens</Link>.
      </p>
    </section>
  );
}

function formatDelivery(webhook: {
  lastStatus: string | null;
  lastSentAt: string | null;
}): string {
  if (!webhook.lastStatus) {
    return webhook.lastSentAt ? "Waiting to deliver" : "No deliveries yet";
  }
  if (!webhook.lastSentAt) return "No deliveries yet";
  const when = new Date(webhook.lastSentAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${webhook.lastStatus === "ok" ? "Delivered" : `Failed (${webhook.lastStatus})`} · ${when}`;
}

function isHttpsWebhookUrl(raw: string): boolean {
  return /^https:\/\/\S+$/.test(raw.trim());
}

/** Admin-only: every change-log entry is POSTed as JSON to each enabled
 *  URL after the mutation that produced it. */
function WebhooksSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const webhooks = useQuery({ queryKey: ["webhooks"], queryFn: api.webhooks });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["webhooks"] });

  const create = useMutation({
    mutationFn: () => api.createWebhook({ name, url }),
    onSuccess: () => {
      setName("");
      setUrl("");
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api.setWebhookEnabled(input.id, input.enabled),
    onSuccess: invalidate,
  });
  const replaceUrl = useMutation({
    mutationFn: (input: { id: string; url: string }) =>
      api.setWebhookUrl(input.id, input.url),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: invalidate,
  });

  const canCreate = name.trim() !== "" && isHttpsWebhookUrl(url);

  return (
    <section className="detail-section">
      <h2>Webhooks</h2>
      <p className="muted section-hint">
        Every change-log entry is POSTed as JSON to each enabled HTTPS URL,
        right after the change lands. Delivery is notify-only. Replace URL keeps
        queued rows. Remove deletes the hook; adding a new one starts from later
        changes only.
      </p>
      {webhooks.isError && <p role="alert">Failed to load webhooks.</p>}
      {webhooks.isSuccess && webhooks.data.webhooks.length > 0 && (
        <ul className="webhook-list">
          {webhooks.data.webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              busy={
                toggle.isPending || replaceUrl.isPending || remove.isPending
              }
              onToggle={(enabled) => toggle.mutate({ id: webhook.id, enabled })}
              onReplaceUrl={(next) =>
                replaceUrl.mutate({ id: webhook.id, url: next })
              }
              onRemove={() => remove.mutate(webhook.id)}
              replaceError={
                replaceUrl.isError && replaceUrl.variables?.id === webhook.id
              }
            />
          ))}
        </ul>
      )}
      <form
        className="webhook-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) create.mutate();
        }}
      >
        <input
          className="oc-input webhook-name-input"
          placeholder="Name (e.g. Ops notify)"
          aria-label="Webhook name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="oc-input webhook-url-input"
          placeholder="https://example.com/hooks/krillswitch"
          aria-label="Webhook URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="submit"
          className="oc-action oc-action-secondary"
          disabled={!canCreate || create.isPending}
        >
          Add webhook
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="save-error">
          Adding the webhook failed. Check the URL and try again.
        </p>
      )}
    </section>
  );
}

function WebhookRow({
  webhook,
  busy,
  onToggle,
  onReplaceUrl,
  onRemove,
  replaceError,
}: {
  webhook: {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    lastStatus: string | null;
    lastSentAt: string | null;
  };
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onReplaceUrl: (url: string) => void;
  onRemove: () => void;
  replaceError: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(webhook.url);
  const blocked = webhook.lastStatus === "blocked";
  const canSave = isHttpsWebhookUrl(draft) && draft.trim() !== webhook.url;

  useEffect(() => {
    setDraft(webhook.url);
    setEditing(false);
  }, [webhook.url]);

  return (
    <li className="webhook-row">
      <div className="webhook-copy">
        <strong>{webhook.name}</strong>
        {editing ? (
          <form
            className="webhook-replace-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSave) {
                return;
              }
              onReplaceUrl(draft.trim());
            }}
          >
            <input
              className="oc-input webhook-url-input"
              aria-label={`Replacement URL for ${webhook.name}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="oc-action oc-action-secondary"
              disabled={!canSave || busy}
            >
              Save URL
            </button>
            <button
              type="button"
              className="oc-action oc-action-ghost"
              disabled={busy}
              onClick={() => {
                setDraft(webhook.url);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <code className="webhook-url">{webhook.url}</code>
        )}
        <span className="muted webhook-status">{formatDelivery(webhook)}</span>
        {blocked && !editing && (
          <span className="muted webhook-recover">
            Destination blocked. Replace the URL to keep queued deliveries.
          </span>
        )}
        {replaceError && (
          <p role="alert" className="save-error">
            Replacing the URL failed. Use a public HTTPS address.
          </p>
        )}
      </div>
      <Switch
        checked={webhook.enabled}
        disabled={busy}
        ariaLabel={`${webhook.name} enabled`}
        onChange={onToggle}
      />
      {!editing && (
        <button
          type="button"
          className="oc-action oc-action-ghost"
          disabled={busy}
          onClick={() => {
            setDraft(webhook.url);
            setEditing(true);
          }}
        >
          Replace URL
        </button>
      )}
      <button
        type="button"
        className="oc-action oc-action-ghost danger-ghost"
        disabled={busy}
        onClick={onRemove}
      >
        Remove
      </button>
    </li>
  );
}
