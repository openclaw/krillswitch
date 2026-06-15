import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AccessTokenEntry, ApiError, api, type TokenRole } from "../api";

function formatWhen(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : "—";
}

export function AccessTokensSection() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: api.tokens });

  const [name, setName] = useState("");
  const [role, setRole] = useState<TokenRole>("editor");
  // The plaintext is returned once at mint; hold it until the admin dismisses.
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const mint = useMutation({
    mutationFn: () => api.mintToken(name.trim(), role),
    onSuccess: ({ token }) => {
      setFreshToken(token);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const mintError =
    mint.error instanceof ApiError
      ? (mint.error.serverMessage ?? "Minting the token failed.")
      : mint.isError
        ? "Minting the token failed."
        : null;

  return (
    <section className="detail-section">
      <h2>Access tokens</h2>
      <p className="muted section-hint">
        Role-scoped tokens for the CLI and agents. Editor or viewer only — never
        admin. Shown once at mint; store it somewhere safe.
      </p>

      {freshToken && (
        <div className="token-reveal" role="status">
          <span className="muted">New token (copy it now):</span>
          <code className="token-plaintext">{freshToken}</code>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setFreshToken(null)}
          >
            Done
          </button>
        </div>
      )}

      <div className="inline-create">
        <input
          className="input"
          aria-label="New token name"
          placeholder="name (e.g. ci-deployer)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="input"
          aria-label="New token role"
          value={role}
          onChange={(event) =>
            setRole(event.target.value === "viewer" ? "viewer" : "editor")
          }
        >
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          disabled={mint.isPending || name.trim() === ""}
          onClick={() => mint.mutate()}
        >
          Mint token
        </button>
        {mintError && (
          <p role="alert" className="save-error">
            {mintError}
          </p>
        )}
      </div>

      {tokens.isPending && <p className="muted">Loading tokens…</p>}
      {tokens.isError && <p role="alert">Failed to load tokens.</p>}
      {tokens.isSuccess && tokens.data.tokens.length === 0 && (
        <p className="muted">No tokens yet.</p>
      )}
      {tokens.isSuccess && tokens.data.tokens.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Created</th>
              <th>Last used</th>
              <th className="th-remove" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tokens.data.tokens.map((token: AccessTokenEntry) => (
              <tr
                key={token.id}
                className={token.revokedAt ? "is-revoked" : ""}
              >
                <td>{token.name}</td>
                <td className="muted">{token.role}</td>
                <td className="muted">{formatWhen(token.createdAt)}</td>
                <td className="muted">{formatWhen(token.lastUsedAt)}</td>
                <td className="td-remove">
                  {token.revokedAt ? (
                    <span className="muted">revoked</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      aria-label={`Revoke ${token.name}`}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(token.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
