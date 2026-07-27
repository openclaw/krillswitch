import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AdminRole,
  ApiError,
  api,
  type Me,
  type UserWithRole,
} from "../api";
import { actionLabel } from "../changeLogActions";
import { EmptyState } from "../components/EmptyState";
import { Pagination } from "../components/Pagination";
import { BlockSkeleton, TableSkeleton } from "../components/Skeleton";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 10;

const ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: "none",
    label: "no access",
    description: "Signed in, but sees nothing",
  },
  { value: "viewer", label: "viewer", description: "Read-only" },
  { value: "editor", label: "editor", description: "Create and change flags" },
  {
    value: "admin",
    label: "admin",
    description: "Everything, plus members, projects, and keys",
  },
];

function parseRole(value: string): AdminRole | null {
  return value === "admin" || value === "editor" || value === "viewer"
    ? value
    : null;
}

function formatDate(timestamp: number | null): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : "never";
}

function formatWhen(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemberProfilePage({ me }: { me: Me }) {
  const { userId = "" } = useParams();
  const memberQuery = useQuery({
    queryKey: ["user", userId],
    queryFn: () => api.user(userId),
  });
  const member = memberQuery.data?.user;

  return (
    <section>
      <header className="oc-page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/access/members">Members</Link>
          </nav>
          <h1>{member ? member.name : "Member"}</h1>
        </div>
      </header>

      {memberQuery.isPending && <BlockSkeleton lines={3} />}
      {memberQuery.isError && <p role="alert">That member no longer exists.</p>}
      {member && (
        <>
          <RoleSection member={member} me={me} userId={userId} />
          <MintedTokensSection userId={userId} />
          <AuditHistorySection userId={userId} />
        </>
      )}
    </section>
  );
}

function RoleSection({
  member,
  me,
  userId,
}: {
  member: UserWithRole;
  me: Me;
  userId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<string | null>(null);
  const current = role ?? member.role ?? "none";
  const isDirty = current !== (member.role ?? "none");

  const save = useMutation({
    mutationFn: () => api.setUserRole(userId, parseRole(current)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user", userId] });
      if (userId === me.user.id) {
        queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      navigate("/access/members");
    },
  });

  const errorMessage =
    save.error instanceof ApiError
      ? (save.error.serverMessage ?? "Changing the role failed.")
      : save.isError
        ? "Changing the role failed."
        : null;

  return (
    <section className="detail-section">
      <h2>Role</h2>
      <div className="profile-role">
        <div className="field">
          <span className="field-label">Email</span>
          <span className="field-value">
            <code>{member.email}</code>
            {member.id === me.user.id && <span className="muted"> (you)</span>}
          </span>
        </div>
        <div className="field">
          <label htmlFor="member-role">Role</label>
          <Select value={current} onValueChange={setRole}>
            <SelectTrigger id="member-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  description={option.description}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {errorMessage && (
          <p role="alert" className="save-error">
            {errorMessage}
          </p>
        )}
        {isDirty && (
          <div>
            <button
              type="button"
              className="oc-action oc-action-primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              Save role
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MintedTokensSection({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const tokensQuery = useQuery({
    queryKey: ["user-tokens", userId, page],
    queryFn: () =>
      api.userTokens(userId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const tokens = tokensQuery.data?.tokens ?? [];
  const total = tokensQuery.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section className="detail-section">
      <h2>Minted tokens</h2>
      <p className="section-hint">Access tokens this member created.</p>
      {tokensQuery.isPending && (
        <TableSkeleton
          columns={5}
          rows={5}
          frameClassName="table-frame-tokens"
        />
      )}
      {tokensQuery.isError && <p role="alert">Failed to load tokens.</p>}
      {tokensQuery.isSuccess && tokens.length === 0 && (
        <EmptyState
          title="No tokens minted"
          description="Tokens this member mints will appear here."
        />
      )}
      {tokensQuery.isSuccess && tokens.length > 0 && (
        <>
          <TableFrame className="table-frame-tokens">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr
                    key={token.id}
                    className={token.revokedAt ? "is-revoked" : ""}
                  >
                    <td>{token.name}</td>
                    <td className="muted">{token.role}</td>
                    <td className="muted">{formatDate(token.createdAt)}</td>
                    <td className="muted">{formatDate(token.lastUsedAt)}</td>
                    <td className="muted">
                      {token.revokedAt ? "revoked" : "active"}
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

function AuditHistorySection({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const logQuery = useQuery({
    queryKey: ["user-changelog", userId, page],
    queryFn: () =>
      api.userChangeLog(userId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const entries = logQuery.data?.entries ?? [];
  const total = logQuery.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section className="detail-section">
      <h2>Audit history</h2>
      <p className="section-hint">Changes this member has made.</p>
      {logQuery.isPending && (
        <TableSkeleton
          columns={3}
          rows={5}
          frameClassName="table-frame-audit"
        />
      )}
      {logQuery.isError && <p role="alert">Failed to load history.</p>}
      {logQuery.isSuccess && entries.length === 0 && (
        <EmptyState
          title="No activity yet"
          description="Flag, project, and role changes this member makes are recorded here."
        />
      )}
      {logQuery.isSuccess && entries.length > 0 && (
        <>
          <TableFrame className="table-frame-audit">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="row-link">
                    <td className="td-when muted">
                      <Link
                        className="row-link-plain row-stretch"
                        to={`/changelog/${encodeURIComponent(entry.id)}`}
                        aria-label={`View details: ${actionLabel(entry.action)} on ${entry.target}`}
                      >
                        {formatWhen(entry.createdAt)}
                      </Link>
                    </td>
                    <td className="td-action">{actionLabel(entry.action)}</td>
                    <td>
                      <code title={entry.target}>{entry.target}</code>
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
