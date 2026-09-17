// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADD_TO_CHAT_EVENT,
  acknowledgeQuoteRequest,
  appendSelectionQuote,
  consumeQuoteRequest,
  isMarkdownBlockquotePosition,
  requestAddToChat,
  type AddToChatRequest,
  type QuoteRequest,
} from "./quoteDraft";
import type { Attachment } from "./session";

const screenshot: Attachment = {
  id: "browser-selection",
  name: "selection.png",
  kind: "image",
  mimeType: "image/png",
  size: 3,
  data: "YWJj",
};

describe("requestAddToChat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("dispatches image-only requests without adding text", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    requestAddToChat(" \r\n ", "plain", [screenshot]);
    expect(dispatch).toHaveBeenCalledOnce();
    const event = dispatch.mock.calls[0][0] as CustomEvent<AddToChatRequest>;
    expect(event.type).toBe(ADD_TO_CHAT_EVENT);
    expect(event.detail).toEqual({
      text: "",
      mode: "plain",
      attachments: [screenshot],
    });
  });

  it("ignores an entirely empty request and keeps text-only quoting compatible", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    requestAddToChat(" \n ", "plain", []);
    expect(dispatch).not.toHaveBeenCalled();
    requestAddToChat(" selected\r\ntext ");
    const event = dispatch.mock.calls[0][0] as CustomEvent<AddToChatRequest>;
    expect(event.detail).toEqual({ text: "selected\ntext", mode: "quote" });
  });
});

describe("appendSelectionQuote", () => {
  it("formats a multiline selection and leaves room for a reply", () => {
    expect(appendSelectionQuote("", " line one\r\nline two ")).toBe(
      "> line one\n> line two\n\n",
    );
  });

  it("preserves intentional blank lines inside a quote", () => {
    expect(appendSelectionQuote("", "one\n\ntwo")).toBe("> one\n>\n> two\n\n");
  });

  it.each([
    ["draft", "draft\n\n> quote\n\n"],
    ["draft\n", "draft\n\n> quote\n\n"],
    ["draft\n\n", "draft\n\n> quote\n\n"],
  ])("separates an existing draft %#", (draft, expected) => {
    expect(appendSelectionQuote(draft, "quote")).toBe(expected);
  });

  it("ignores whitespace-only selections", () => {
    expect(appendSelectionQuote("draft", "  \n ")).toBe("draft");
  });
});

describe("isMarkdownBlockquotePosition", () => {
  it("recognizes tokens after nested quote markers", () => {
    const text = "plain /one\n> /two\n  >> @file";
    expect(isMarkdownBlockquotePosition(text, text.indexOf("/one"))).toBe(
      false,
    );
    expect(isMarkdownBlockquotePosition(text, text.indexOf("/two"))).toBe(true);
    expect(isMarkdownBlockquotePosition(text, text.indexOf("@file"))).toBe(
      true,
    );
  });
});

describe("consumeQuoteRequest", () => {
  const request: QuoteRequest = { id: 1, text: "selected" };

  it("consumes a request once", () => {
    expect(consumeQuoteRequest("draft", null, request)).toEqual({
      draft: "draft\n\n> selected\n\n",
      consumedId: 1,
      changed: true,
    });
    expect(consumeQuoteRequest("draft", 1, request)).toEqual({
      draft: "draft",
      consumedId: 1,
      changed: false,
    });
  });

  it("accepts a new id even when the text is identical", () => {
    expect(
      consumeQuoteRequest("", 1, { id: 2, text: "selected" }),
    ).toMatchObject({ consumedId: 2, changed: true });
  });

  it("inserts plain text without quoting", () => {
    expect(
      consumeQuoteRequest("draft", null, {
        id: 3,
        text: "Note: Auth\n\nUse a cookie.",
        mode: "plain",
      }),
    ).toEqual({
      draft: "draft\n\nNote: Auth\n\nUse a cookie.\n\n",
      consumedId: 3,
      changed: true,
    });
  });

  it("acknowledges an attachment-only request without changing the draft", () => {
    expect(
      consumeQuoteRequest("Keep my draft", null, {
        id: 4,
        text: "",
        mode: "plain",
        attachments: [screenshot],
      }),
    ).toEqual({ draft: "Keep my draft", consumedId: 4, changed: false });
  });

  it("ignores a delayed request older than the one already consumed", () => {
    expect(consumeQuoteRequest("Current draft", 5, request)).toEqual({
      draft: "Current draft",
      consumedId: 5,
      changed: false,
    });
  });
});

describe("acknowledgeQuoteRequest", () => {
  it("clears only the request that was acknowledged", () => {
    const current: QuoteRequest = { id: 2, text: "newer" };
    expect(acknowledgeQuoteRequest(current, 2)).toBeUndefined();
    expect(acknowledgeQuoteRequest(current, 1)).toBe(current);
  });
});
