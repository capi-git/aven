import { Modal } from "./Modal";

type Props = {
  title: string;
  /** What happens and what can't be undone, in one or two sentences. */
  body: string;
  confirmLabel: string;
  /** Deleting or discarding work reads as a warning. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Asks before something that can't be undone. Built on the app's solid
 * dialog sheet, so the chat behind never shows through the question.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal size="sm" title={title} description={body} onClose={onCancel}>
      <div
        className="flex justify-end gap-2 px-5 pb-4 pt-3"
        data-confirm-dialog
      >
        {/* Enter on the first focus never confirms what can't be undone. */}
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="aven-press rounded-md px-3 py-1.5 text-ui-label text-content/80 hover:bg-(--aven-control-bg)"
        >
          Cancel
        </button>
        <button
          type="button"
          data-confirm
          onClick={onConfirm}
          className={
            danger
              ? "aven-press rounded-md px-3 py-1.5 text-ui-label font-medium bg-(--aven-danger-fill) text-(--aven-danger-text) hover:bg-(--aven-danger-fill-hover)"
              : "aven-press rounded-md bg-content px-3 py-1.5 text-ui-label font-medium text-background-base hover:bg-(--aven-inverse-hover)"
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
