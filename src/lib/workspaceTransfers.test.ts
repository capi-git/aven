// @vitest-environment happy-dom
import { it, expect } from "vitest";
import {
  recordEditorDraft,
  readEditorDraft,
  retainEditorDraft,
  discardEditorDrafts,
  rememberTerminalScreen,
  readTerminalScreen,
  releaseTerminalScreen,
} from "./workspaceTransfers";
it("confirmed final-owner discard does not resurrect cached text, including after disk changes", () => {
  const release = retainEditorDraft("discard");
  recordEditorDraft("discard", "unsaved", "disk");
  discardEditorDrafts([{ path: "discard" }]);
  release();
  expect(readEditorDraft("discard")).toBeUndefined();
});
it("preserves a dirty peer and unconfirmed transfer, releases clean final-owner records", () => {
  const a = retainEditorDraft("peer"),
    b = retainEditorDraft("peer");
  recordEditorDraft("peer", "draft", "disk");
  discardEditorDrafts([{ path: "peer" }]);
  a();
  expect(readEditorDraft("peer")?.text).toBe("draft");
  b();
  expect(readEditorDraft("peer")?.text).toBe("draft"); // transfer, not confirmed close
  const c = retainEditorDraft("peer");
  recordEditorDraft("peer", "saved", "saved");
  c();
  expect(readEditorDraft("peer")).toBeUndefined();
});
it("releases snapshots for unique closed terminal IDs", () => {
  for (let n = 0; n < 100; n++) {
    const id = `closed-${n}`;
    rememberTerminalScreen(id, "screen".repeat(1000));
    releaseTerminalScreen(id);
    expect(readTerminalScreen(id)).toBeUndefined();
  }
  rememberTerminalScreen("retained", "keep");
  expect(readTerminalScreen("retained")).toBe("keep");
});
