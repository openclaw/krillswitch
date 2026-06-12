import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { api, type Me } from "./api";
import { RoleChip } from "./components/RoleChip";

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const queryClient = useQueryClient();

  async function signOut() {
    await api.signOut();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">krillswitch</span>
        <div className="identity">
          <span className="identity-name">{me.user.name}</span>
          <RoleChip role={me.role} />
          <button type="button" className="btn btn-quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <div className="body">
        <nav className="rail" aria-label="Main">
          <NavLink to="/" end className="rail-link">
            Projects
          </NavLink>
          <NavLink to="/changelog" className="rail-link">
            Change log
          </NavLink>
          {me.role === "admin" && (
            <>
              <div className="rail-group">Administration</div>
              <NavLink to="/access" className="rail-link">
                Access
              </NavLink>
            </>
          )}
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
