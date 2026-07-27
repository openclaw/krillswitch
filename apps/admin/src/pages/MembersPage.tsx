import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, type Me } from "../api";
import { Pagination } from "../components/Pagination";
import { RoleChip } from "../components/RoleChip";
import { TableSkeleton } from "../components/Skeleton";
import { TableFrame } from "../components/TableFrame";

const PAGE_SIZE = 10;

export function MembersPage({ me }: { me: Me }) {
  const [page, setPage] = useState(1);
  const members = useQuery({
    queryKey: ["users", page],
    queryFn: () =>
      api.users({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const users = members.data?.users ?? [];
  const total = members.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section>
      <header className="oc-page-header">
        <h1>Members</h1>
      </header>
      <p className="section-hint">Roles apply across every project.</p>

      {members.isPending && (
        <TableSkeleton
          columns={3}
          rows={PAGE_SIZE}
          frameClassName="table-frame-access"
        />
      )}
      {members.isError && <p role="alert">Failed to load members.</p>}
      {members.isSuccess && (
        <>
          <TableFrame className="table-frame-access">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="th-role">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="row-link">
                    <td>
                      <Link
                        className="table-link row-stretch"
                        to={`/access/members/${encodeURIComponent(user.id)}`}
                        aria-label={`View ${user.name}`}
                      >
                        {user.name}
                      </Link>
                      {user.id === me.user.id && (
                        <span className="muted"> (you)</span>
                      )}
                    </td>
                    <td>
                      <code>{user.email}</code>
                    </td>
                    <td className="td-role">
                      <RoleChip role={user.role} />
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
