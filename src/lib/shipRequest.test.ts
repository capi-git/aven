// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestShip,
  subscribeShipRequests,
  takeShipRequest,
} from "./shipRequest";

afterEach(() => {
  takeShipRequest("/repo");
  vi.useRealTimers();
});

describe("ship requests", () => {
  it("announces a request and hands it once to the panel for that folder", () => {
    const heard = vi.fn();
    const stop = subscribeShipRequests(heard);
    requestShip("/repo/", "session-1");
    stop();
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo/", sessionId: "session-1" }),
    );
    expect(takeShipRequest("/other")).toBeNull();
    expect(takeShipRequest("/repo")).toMatchObject({ sessionId: "session-1" });
    expect(takeShipRequest("/repo")).toBeNull();
  });

  it("drops a request nobody picked up in time, and ignores home", () => {
    vi.useFakeTimers();
    requestShip("~");
    expect(takeShipRequest("~")).toBeNull();
    requestShip("/repo");
    expect(takeShipRequest("/repo", Date.now() + 60_000)).toBeNull();
    expect(takeShipRequest("/repo")).toBeNull();
  });
});
