import { expect, it } from "vitest";
import { validSessionPipAction } from "./sessionPictureInPicture";

it("rejects unrelated session identities and malformed callback payloads", () => {
  const id = "session";
  expect(
    validSessionPipAction(
      { id, action: "onPaneDragStart", args: [id] },
      new Set([id]),
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id, action: "onOpenDiff", args: [null, { sessionId: "wrong" }] },
      new Set([id]),
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id, action: "onOpenFile", args: ["/a"] },
      new Set(),
    ),
  ).toBe(false);
});

it("accepts only web destinations for link actions", () => {
  const openIds = new Set(["a"]);
  expect(
    validSessionPipAction(
      { id: "a", action: "onOpenUrl", args: ["https://example.com"] },
      openIds,
    ),
  ).toBe(true);
  expect(
    validSessionPipAction(
      { id: "a", action: "onOpenUrl", args: ["file:///private"] },
      openIds,
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id: "other", action: "onOpenUrl", args: ["https://example.com"] },
      openIds,
    ),
  ).toBe(false);
});

it("lets a popped-out chat answer only its own question", () => {
  const openIds = new Set(["a"]);
  const reply = { kind: "answered", answers: { q: ["yes"] } };
  expect(
    validSessionPipAction(
      { id: "a", action: "onQuestionReply", args: ["a", 3, reply] },
      openIds,
    ),
  ).toBe(true);
  expect(
    validSessionPipAction(
      { id: "a", action: "onQuestionReply", args: ["b", 3, reply] },
      openIds,
    ),
  ).toBe(false);
  expect(
    validSessionPipAction(
      { id: "b", action: "onQuestionReply", args: ["b", 3, reply] },
      openIds,
    ),
  ).toBe(false);
});
