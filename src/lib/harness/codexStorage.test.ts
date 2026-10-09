import { describe, expect, it } from "vitest";
import { assertCodexStorage } from "./codexStorage";

describe("effective Codex history isolation", () => {
  it("accepts private state and equivalent Windows path representations", () => {
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "/aven/codex-home" } },
        "/aven/codex-home/",
      ),
    ).not.toThrow();
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "C:\\Users\\Jack\\Aven\\codex-home" } },
        "//?/c:/users/jack/aven/codex-home",
      ),
    ).not.toThrow();
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "\\\\server\\share\\codex-home" } },
        "//?/UNC/server/share/codex-home",
      ),
    ).not.toThrow();
  });

  it.each([
    undefined,
    {},
    { config: {} },
    { config: { sqlite_home: "/shared/.codex" } },
    { config: { sqlite_home: "/AVEN/codex-home" } },
    { config: { sqlite_home: "/aven\\codex-home" } },
  ])("rejects unverifiable or externally overridden state: %j", (response) => {
    expect(() => assertCodexStorage(response, "/aven/codex-home")).toThrow(
      "No chat was started",
    );
  });

  it.each(["keyring", "auto"])(
    "rejects effective auth routing that could select a different account: %s",
    (mode) => {
      expect(() =>
        assertCodexStorage(
          {
            config: {
              sqlite_home: "/aven/codex-home",
              cli_auth_credentials_store: mode,
            },
          },
          "/aven/codex-home",
        ),
      ).toThrow("login and history are unchanged");
    },
  );
});
