import { describe, expect, it } from "vitest";
import {
  adjacentItemId,
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldHandleListNavigation,
  shouldStopFocusedTurnOnEscape,
  tabCommand,
} from "./tabKeys";

const key_ = (partial: Parameters<typeof key>[0]) => key(partial);

function key(
  partial: Partial<
    Pick<
      KeyboardEvent,
      | "key"
      | "code"
      | "keyCode"
      | "metaKey"
      | "ctrlKey"
      | "altKey"
      | "shiftKey"
      | "isComposing"
      | "defaultPrevented"
      | "repeat"
    >
  >,
): KeyboardEvent {
  return {
    isComposing: false,
    defaultPrevented: false,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    keyCode: 0,
    ...partial,
  } as KeyboardEvent;
}

describe("tabCommand: Cydonia's pane chords", () => {
  const chord = (
    code: string,
    key: string,
    keyCode: number,
    extra: object = {},
    mac = true,
  ) =>
    tabCommand(
      key_({ code, key, keyCode, ctrlKey: true, altKey: true, ...extra }),
      mac,
    );
  it("walks panes with Control-Option-Tab on a Mac and PageDown/PageUp anywhere", () => {
    expect(chord("Tab", "Tab", 9)).toBe("next-pane");
    expect(chord("Tab", "Tab", 9, { shiftKey: true })).toBe("prev-pane");
    expect(chord("PageDown", "PageDown", 34)).toBe("next-pane");
    expect(chord("PageUp", "PageUp", 33)).toBe("prev-pane");
    // Windows keeps Ctrl+Alt+Tab; its users have PageDown and PageUp.
    expect(chord("Tab", "Tab", 9, {}, false)).toBeNull();
    expect(chord("PageDown", "PageDown", 34, {}, false)).toBe("next-pane");
    expect(chord("PageUp", "PageUp", 33, {}, false)).toBe("prev-pane");
  });
  it("matches the layout's letter, as a page's key code does", () => {
    // US: Option turns Z into Ω and W into ∑.
    expect(chord("KeyZ", "Ω", 90)).toBe("zoom-pane");
    expect(chord("KeyW", "∑", 87)).toBe("close");
    // AZERTY: the key that types Z sits where W is, and the other way round.
    expect(chord("KeyW", "Ω", 90)).toBe("zoom-pane");
    expect(chord("KeyZ", "∑", 87)).toBe("close");
    // QWERTZ: Z is where Y is; the key in Z's place types Y.
    expect(chord("KeyY", "Ω", 90)).toBe("zoom-pane");
    expect(chord("KeyZ", "¥", 89)).toBeNull();
  });
  it("leaves other chords as they were", () => {
    // ⌃⇥ still steps the focused pane's tabs.
    expect(
      tabCommand(key_({ key: "Tab", code: "Tab", keyCode: 9, ctrlKey: true })),
    ).toBe("next");
    // With Command as well it is not a pane chord.
    expect(chord("Tab", "Tab", 9, { metaKey: true })).toBeNull();
    expect(chord("KeyZ", "Ω", 90, { shiftKey: true })).toBeNull();
  });
  it("never mistakes AltGr typing for a chord off a Mac", () => {
    const altGr = {
      ...key_({
        code: "KeyZ",
        key: "ż",
        keyCode: 90,
        ctrlKey: true,
        altKey: true,
      }),
      getModifierState: (name: string) => name === "AltGraph",
    } as KeyboardEvent;
    expect(tabCommand(altGr, false)).toBeNull();
    // Left Ctrl+Alt types AltGr characters on Windows without AltGraph set.
    expect(chord("KeyZ", "ż", 90, {}, false)).toBeNull();
    expect(chord("Digit1", "|", 49, {}, false)).toBeNull();
    // A plain Ctrl+Alt+Z there is the chord.
    expect(chord("KeyZ", "z", 90, {}, false)).toBe("zoom-pane");
    // A Mac's Option may report AltGraph; there it is the chord.
    expect(tabCommand(altGr, true)).toBe("zoom-pane");
  });
});

describe("tabCommand", () => {
  it("reopens the latest closed tab with Cmd/Ctrl+Shift+T", () => {
    expect(tabCommand(key({ key: "T", metaKey: true, shiftKey: true }))).toBe(
      "reopen",
    );
    expect(tabCommand(key({ key: "t", ctrlKey: true, shiftKey: true }))).toBe(
      "reopen",
    );
    expect(
      tabCommand(
        key({ key: "T", metaKey: true, shiftKey: true, repeat: true }),
      ),
    ).toBeNull();
    expect(
      tabCommand(
        key({ key: "T", metaKey: true, shiftKey: true, altKey: true }),
      ),
    ).toBeNull();
    expect(
      tabCommand(
        key({ key: "T", metaKey: true, shiftKey: true, isComposing: true }),
      ),
    ).toBeNull();
  });
  it("archives with Cmd+Shift+A or Ctrl+Shift+A", () => {
    expect(tabCommand(key({ key: "A", metaKey: true, shiftKey: true }))).toBe(
      "archive-session",
    );
    expect(tabCommand(key({ key: "a", ctrlKey: true, shiftKey: true }))).toBe(
      "archive-session",
    );
  });

  it.each([
    {},
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { metaKey: true, shiftKey: true, altKey: true },
    { metaKey: true, shiftKey: true, isComposing: true },
    { metaKey: true, shiftKey: true, repeat: true },
  ])("leaves other A key events alone (%j)", (modifiers) => {
    expect(tabCommand(key({ key: "a", ...modifiers }))).toBeNull();
  });

  it("opens a terminal pane with cmd-backtick", () => {
    expect(
      tabCommand(key({ key: "`", code: "Backquote", metaKey: true })),
    ).toBe("new-terminal");
  });

  it("opens a terminal workspace tab with shift-cmd-backtick", () => {
    expect(
      tabCommand(
        key({ key: "~", code: "Backquote", metaKey: true, shiftKey: true }),
      ),
    ).toBe("new-terminal-tab");
  });

  it("keeps existing tab chrome bindings", () => {
    expect(tabCommand(key({ key: "t", metaKey: true }))).toBe("new");
    expect(tabCommand(key({ key: "t", metaKey: true, altKey: true }))).toBe(
      "close-others",
    );
    expect(tabCommand(key({ key: "t", ctrlKey: true, altKey: true }))).toBe(
      "close-others",
    );
    expect(tabCommand(key({ key: "d", metaKey: true }))).toBe("split-right");
    expect(tabCommand(key({ key: "j", metaKey: true }))).toBe(
      "toggle-terminal",
    );
  });

  it("walks tab visit history with cmd-brackets", () => {
    expect(
      tabCommand(key({ key: "[", code: "BracketLeft", metaKey: true })),
    ).toBe("back");
    expect(
      tabCommand(key({ key: "]", code: "BracketRight", metaKey: true })),
    ).toBe("forward");
  });

  it("keeps shift-cmd-brackets as adjacent tab cycle", () => {
    expect(
      tabCommand(
        key({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
      ),
    ).toBe("prev");
    expect(
      tabCommand(
        key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
      ),
    ).toBe("next");
  });

  it("uses shift-mod arrows for session and project navigation", () => {
    expect(
      tabCommand(key({ key: "ArrowUp", metaKey: true, shiftKey: true })),
    ).toBe("prev-session");
    expect(
      tabCommand(key({ key: "ArrowDown", metaKey: true, shiftKey: true })),
    ).toBe("next-session");
    expect(
      tabCommand(key({ key: "ArrowLeft", metaKey: true, shiftKey: true })),
    ).toBe("prev-project");
    expect(
      tabCommand(key({ key: "ArrowRight", metaKey: true, shiftKey: true })),
    ).toBe("next-project");
  });

  it("cycles ordered item ids and wraps at both ends", () => {
    expect(adjacentItemId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(adjacentItemId(["a", "b", "c"], "c", 1)).toBe("a");
    expect(adjacentItemId(["a", "b", "c"], "a", -1)).toBe("c");
    expect(adjacentItemId(["a", "b", "c"], "missing", 1)).toBe("a");
    expect(adjacentItemId(["a", "b", "c"], "missing", -1)).toBe("c");
    expect(adjacentItemId([], "a", 1)).toBeNull();
  });

  it("allows navigation from an empty composer", () => {
    expect(
      shouldHandleListNavigation({
        blockedTarget: true,
        emptyComposerTarget: true,
        surfaceOpen: false,
      }),
    ).toBe(true);
  });

  it("blocks list navigation while another text or app surface owns focus", () => {
    expect(
      shouldHandleListNavigation({
        blockedTarget: false,
        emptyComposerTarget: false,
        surfaceOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldHandleListNavigation({
        blockedTarget: true,
        emptyComposerTarget: false,
        surfaceOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldHandleListNavigation({
        blockedTarget: false,
        emptyComposerTarget: false,
        surfaceOpen: true,
      }),
    ).toBe(false);
    expect(
      shouldHandleListNavigation({
        blockedTarget: true,
        emptyComposerTarget: true,
        surfaceOpen: true,
      }),
    ).toBe(false);
  });
});

describe("shouldStopFocusedTurnOnEscape", () => {
  const escape = (partial: Partial<KeyboardEvent> = {}) =>
    key({ key: "Escape", ...partial });

  it("stops a busy focused agent turn on plain Escape", () => {
    expect(
      shouldStopFocusedTurnOnEscape(escape(), {
        inTerminal: false,
        focusedSessionBusy: true,
      }),
    ).toBe(true);
  });

  it("does not steal Escape that another surface already handled", () => {
    expect(
      shouldStopFocusedTurnOnEscape(escape({ defaultPrevented: true }), {
        inTerminal: false,
        focusedSessionBusy: true,
      }),
    ).toBe(false);
  });

  it("leaves terminal Escape and idle sessions alone", () => {
    expect(
      shouldStopFocusedTurnOnEscape(escape(), {
        inTerminal: true,
        focusedSessionBusy: true,
      }),
    ).toBe(false);
    expect(
      shouldStopFocusedTurnOnEscape(escape(), {
        inTerminal: false,
        focusedSessionBusy: false,
      }),
    ).toBe(false);
  });

  it("ignores modified, composing, or repeated Escape", () => {
    for (const partial of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { isComposing: true },
      { repeat: true },
    ]) {
      expect(
        shouldStopFocusedTurnOnEscape(escape(partial), {
          inTerminal: false,
          focusedSessionBusy: true,
        }),
      ).toBe(false);
    }
  });
});

describe("focusedBusyAgentSessionId", () => {
  const tabs = [{ id: "tab-a", focusedId: "session-a" }];
  const sessions = [{ id: "session-a", busy: true }];

  it("returns only the busy agent session in the exact active tab", () => {
    expect(focusedBusyAgentSessionId("tab-a", tabs, sessions, false)).toBe(
      "session-a",
    );
    expect(
      focusedBusyAgentSessionId("missing", tabs, sessions, false),
    ).toBeNull();
  });

  it("does not stop through diff, terminal-dock, editor, or idle focus", () => {
    expect(
      focusedBusyAgentSessionId(
        "tab-a",
        [{ ...tabs[0], diffFocused: true }],
        sessions,
        false,
      ),
    ).toBeNull();
    expect(focusedBusyAgentSessionId("tab-a", tabs, sessions, true)).toBeNull();
    expect(
      focusedBusyAgentSessionId(
        "tab-a",
        [{ id: "tab-a", focusedId: "editor-pane" }],
        sessions,
        false,
      ),
    ).toBeNull();
    expect(
      focusedBusyAgentSessionId(
        "tab-a",
        tabs,
        [{ id: "session-a", busy: false }],
        false,
      ),
    ).toBeNull();
  });
});

describe("deferUnhandledEscape", () => {
  const escape = (partial: Partial<KeyboardEvent> = {}) =>
    key({ key: "Escape", ...partial });

  it("runs after the keydown dispatch when Escape stays unhandled", () => {
    let deferred: (() => void) | undefined;
    let stopped = false;
    deferUnhandledEscape(
      escape(),
      () => {
        stopped = true;
      },
      (callback) => {
        deferred = callback;
      },
    );
    expect(stopped).toBe(false);
    deferred?.();
    expect(stopped).toBe(true);
  });

  it("yields to a later same-dispatch Escape handler", () => {
    let deferred: (() => void) | undefined;
    let stopped = false;
    const event = escape() as KeyboardEvent & { defaultPrevented: boolean };
    deferUnhandledEscape(
      event,
      () => {
        stopped = true;
      },
      (callback) => {
        deferred = callback;
      },
    );
    Object.defineProperty(event, "defaultPrevented", { value: true });
    deferred?.();
    expect(stopped).toBe(false);
  });

  it("does not schedule an already-handled or repeated Escape", () => {
    let scheduled = 0;
    const defer = () => {
      scheduled += 1;
    };
    deferUnhandledEscape(escape({ defaultPrevented: true }), () => {}, defer);
    deferUnhandledEscape(escape({ repeat: true }), () => {}, defer);
    expect(scheduled).toBe(0);
  });
});
