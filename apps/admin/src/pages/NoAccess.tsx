import { useQueryClient } from "@tanstack/react-query";
import { api, type Me } from "../api";

export function NoAccess({ me }: { me: Me }) {
  const queryClient = useQueryClient();

  async function signOut() {
    await api.signOut();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <span className="wordmark">krillswitch</span>
        <h1>No access</h1>
        <p className="muted">
          Signed in as {me.user.name} ({me.user.email}), but this account has no
          role grant. Ask an administrator for access.
        </p>
        <button type="button" className="btn btn-quiet" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
