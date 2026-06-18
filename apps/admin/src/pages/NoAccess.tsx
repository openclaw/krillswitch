import { useQueryClient } from "@tanstack/react-query";
import { api, type Me } from "../api";
import { Brandmark, LockIcon } from "../components/brand";

export function NoAccess({ me }: { me: Me }) {
  const queryClient = useQueryClient();

  async function signOut() {
    await api.signOut();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className="auth-screen">
      <div className="auth">
        <Brandmark />
        <div className="auth-card auth-card-centered">
          <span className="status-disc status-disc-danger">
            <LockIcon />
          </span>
          <h1 className="auth-title">No access</h1>
          <p className="auth-subtitle">
            This account exists, but no krillswitch role has been granted yet.
          </p>
          <div className="auth-note">
            <p className="auth-note-title">Signed in as {me.user.name}</p>
            <p className="auth-note-mono">{me.user.email}</p>
            <p className="muted">Ask an administrator to grant access.</p>
          </div>
          <div className="auth-actions">
            <button type="button" className="btn btn-primary" onClick={signOut}>
              Sign out
            </button>
            <button type="button" className="btn btn-quiet" onClick={signOut}>
              Back to persona picker
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
