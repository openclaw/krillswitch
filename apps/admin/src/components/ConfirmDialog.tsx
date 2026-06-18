import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

/**
 * Confirmation modal for destructive, hard-to-undo actions (delete, revoke,
 * rotate). Built on Radix AlertDialog: focus-trapped, ESC/overlay to cancel,
 * the confirm button is the focused default. `trigger` is the button that
 * opens it; `onConfirm` runs the mutation when confirmed.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content className="modal-content">
          <AlertDialog.Title className="modal-title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="modal-desc">
            {description}
          </AlertDialog.Description>
          <div className="modal-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn btn-quiet">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
