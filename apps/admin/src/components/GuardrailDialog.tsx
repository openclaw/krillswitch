import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { EnvBadge } from "./EnvBadge";

/** Production changes get a deliberate stop: restate what is about to go
 *  live and require a change-log comment before the mutation runs. Unlike
 *  ConfirmDialog this is caller-controlled — the trigger is a save or a
 *  toggle already in flight, not a dedicated button — and confirm does not
 *  auto-close, so the dialog can stay open while the mutation is pending. */
export function GuardrailDialog({
  open,
  onOpenChange,
  environmentKey,
  title,
  description,
  confirmLabel,
  comment,
  onCommentChange,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentKey: string;
  title: string;
  description: string;
  confirmLabel: string;
  comment: string;
  onCommentChange: (comment: string) => void;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const canConfirm = comment.trim().length > 0 && !pending;
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content className="modal-content">
          <AlertDialog.Title className="modal-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="modal-desc">
            {description}
          </AlertDialog.Description>
          <p className="guardrail-env">
            <span className="muted">Environment</span>
            <EnvBadge envKey={environmentKey} />
          </p>
          <label className="oc-field guardrail-comment">
            <span className="oc-field-label">
              Reason — recorded in the change log
            </span>
            <input
              className="oc-input"
              value={comment}
              maxLength={500}
              placeholder="Why this change is safe to make now"
              onChange={(event) => onCommentChange(event.currentTarget.value)}
            />
          </label>
          <div className="modal-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="oc-action oc-action-secondary">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className="oc-action oc-action-primary btn-danger"
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
