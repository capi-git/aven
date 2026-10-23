import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOutputTail,
  devServerStopsWatched,
  plainTerminalText,
  stoppedByUser,
  subscribeDevServerStops,
  type DevServerStop,
} from "./devServerStops";
import { resetDevPreviews, watchTerminalOutput } from "./devPreviews";

const PROJECT = "/Users/me/site";
const VITE = "  ➜  Local:   http://localhost:5173/\n";

beforeEach(() => resetDevPreviews());
afterEach(() => resetDevPreviews());

describe("dev server stops", () => {
  it("tells a stop you made from one the server made", () => {
    expect(stoppedByUser("ready\n^C\n", "exited")).toBe(true);
    expect(stoppedByUser("ready\n", "closed")).toBe(true);
    expect(
      stoppedByUser(
        "TypeError: x is undefined\n    at a.js:1\nnpm ERR! code ELIFECYCLE\n",
        "output",
      ),
    ).toBe(false);
    // An old Ctrl+C far above the crash is not this stop.
    expect(
      stoppedByUser("^C\nrestarted\nok\nok\nok\nError: boom\n", "exited"),
    ).toBe(false);
    expect(plainTerminalText("\u001b[31mred\u001b[0m  \r\nnext")).toBe(
      "red\nnext",
    );
    const tail = createOutputTail(5);
    tail.push("abc");
    tail.push("defg");
    expect(tail.text()).toBe("cdefg");
  });

  it("reports a terminal's server crashing, with its last output, only while heard", () => {
    const stops: DevServerStop[] = [];
    const watch = watchTerminalOutput({
      id: "t1",
      project: PROJECT,
      cwd: PROJECT,
      placement: "terminal",
    });
    // Nobody listens: nothing kept, nothing reported.
    expect(devServerStopsWatched()).toBe(false);
    watch.foreground("npm");
    watch.push(VITE);
    watch.foreground(null);
    expect(stops).toHaveLength(0);

    const stop = subscribeDevServerStops((item) => stops.push(item));
    watch.foreground("npm");
    watch.push(VITE);
    watch.push("TypeError: Cannot read properties of undefined\n");
    watch.foreground(null);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      project: PROJECT,
      label: "localhost:5173",
      port: 5173,
      reason: "exited",
      byUser: false,
      sourceId: "terminal:t1",
    });
    expect(stops[0].output).toContain("TypeError: Cannot read properties");
    // A server you stop with Ctrl+C says so.
    watch.foreground("npm");
    watch.push(VITE);
    watch.push("^C\n");
    expect(stops).toHaveLength(2);
    expect(stops[1]).toMatchObject({ reason: "output", byUser: true });
    // A stop with no running server reports nothing.
    watch.stopped();
    expect(stops).toHaveLength(2);
    stop();
    expect(devServerStopsWatched()).toBe(false);
  });
});
