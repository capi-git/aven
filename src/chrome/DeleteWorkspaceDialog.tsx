import { useState } from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { errorText } from "../lib/errors";
import { Modal } from "./Modal";

type Props = {
  profile: WorkspaceProfile;
  onCancel: () => void;
  onDelete: (id: string) => void;
};

export function DeleteWorkspaceDialog({ profile, onCancel, onDelete }: Props) {
  const [error, setError] = useState("");
  return (
    <Modal
      size="sm"
      title={`Delete “${profile.name}”?`}
      description="Its projects and chats will stay available in Personal. Files on disk and running agents are kept."
      onClose={onCancel}
    >
      <div className="px-5 pb-4">
        <p className="text-ui-label leading-relaxed text-content/65">
          The workspace and its appearance will no longer appear in the
          workspace switcher.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-3 text-ui-label text-(--aven-danger-text)"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-ui-label text-content/80 hover:bg-(--aven-control-bg)"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-ui-label font-medium bg-(--aven-danger-fill) text-(--aven-danger-text) hover:bg-(--aven-danger-fill-hover)"
            onClick={() => {
              try {
                onDelete(profile.id);
                onCancel();
              } catch (failure) {
                setError(errorText(failure));
              }
            }}
          >
            Delete workspace
          </button>
        </div>
      </div>
    </Modal>
  );
}
