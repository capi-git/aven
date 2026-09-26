import { useSyncExternalStore } from "react";
import {
  dismissUpdateNotice,
  getUpdateNotice,
  subscribeUpdateNotice,
} from "../lib/updater";
import { Modal } from "./Modal";

/** Update results in Aven's own dialog, styled with the workspace theme. */
export function UpdateNoticeDialog() {
  const notice = useSyncExternalStore(
    subscribeUpdateNotice,
    getUpdateNotice,
    () => null,
  );
  if (!notice) return null;
  const [lead, ...rest] = notice.text.split("\n\n");
  return (
    <Modal
      title={notice.title}
      description={lead}
      onClose={dismissUpdateNotice}
      size="sm"
    >
      <div className="px-4 pb-4 pt-3">
        {rest.length ? (
          <p className="mb-4 whitespace-pre-line text-[12px] leading-relaxed text-content/70">
            {rest.join("\n\n")}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-background-base hover:opacity-90"
            autoFocus
            onClick={dismissUpdateNotice}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
