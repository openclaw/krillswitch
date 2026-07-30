import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { type AccessTokenEntry, api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { TableSkeleton } from "../components/Skeleton";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 10;

function formatWhen(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : "never";
}

export function TokensPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const tokensQuery = useQuery({
    queryKey: ["tokens", page],
    queryFn: () =>
      api.tokens({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const tokens = tokensQuery.data?.tokens ?? [];
  const total = tokensQuery.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <section>
      <header className="oc-page-header">
        <div className="oc-page-header-content">
          <h1 className="oc-page-header-title">Access tokens</h1>
          <p className="oc-page-header-description">
            Role-scoped tokens for the CLI and agents. Editor or viewer only,
            never admin.
          </p>
        </div>
        <div className="oc-page-header-actions">
          <Link
            className="oc-action oc-action-primary btn-link"
            to="/access/tokens/new"
          >
            Mint token
          </Link>
        </div>
      </header>

      {revoke.isError && (
        <p role="alert" className="save-error">
          Revoking the token failed.
        </p>
      )}
      {tokensQuery.isPending && (
        <TableSkeleton
          columns={5}
          rows={PAGE_SIZE}
          frameClassName="oc-table-wrap-tokens"
        />
      )}
      {tokensQuery.isError && <p role="alert">Failed to load tokens.</p>}
      {tokensQuery.isSuccess && tokens.length === 0 && (
        <EmptyState
          title="No tokens yet"
          description="Mint one to give the CLI or an agent scoped, revocable access."
        />
      )}
      {tokensQuery.isSuccess && tokens.length > 0 && (
        <>
          <TableFrame className="oc-table-wrap-tokens">
            <table className="oc-table">
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
                {tokens.map((token: AccessTokenEntry) => (
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
                        <ConfirmDialog
                          title={`Revoke “${token.name}”?`}
                          description="Any CLI or agent using this token loses access immediately. This can't be undone."
                          confirmLabel="Revoke token"
                          pending={revoke.isPending}
                          onConfirm={() => revoke.mutate(token.id)}
                          trigger={
                            <button
                              type="button"
                              className="oc-action oc-action-secondary"
                              aria-label={`Revoke ${token.name}`}
                            >
                              Revoke
                            </button>
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </section>
  );
}
