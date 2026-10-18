import { describe, expect, it } from "vitest";
import {
  commandLabel,
  controlCommandLabel,
  toolDisplayLabel,
} from "./commandLabel";
import { shellPath } from "./orchestration";

const CLI =
  "/Users/jack/Developer/.worktrees/Aven/appearance-simplify/target/debug/aven";

describe("a lead's calls to Aven's control CLI", () => {
  it("read as plain words, however the program is named", () => {
    expect(
      commandLabel(
        `A='${CLI}'; "$A" control wait --json '{"timeoutSeconds":120}'`,
      ),
    ).toBe("Waiting for the agents");
    expect(commandLabel(`${shellPath(CLI)} control list`)).toBe(
      "Checking on the agents",
    );
    expect(
      commandLabel(
        `'/Applications/Aven Dev.app/Contents/MacOS/Aven Dev' control get --json '{"taskId":"t1"}'`,
      ),
    ).toBe("Checking on an agent");
    expect(commandLabel(`\${AVEN} control delegate --input -`)).toBe(
      "Handing a task to an agent",
    );
    expect(commandLabel(`${CLI} control --help`)).toBe(
      "Reading how to direct the agents",
    );
    expect(commandLabel(`${CLI} control review --json '{}'`)).toBe(
      "Reviewing an agent's work",
    );
    expect(commandLabel(`${CLI} control finish`)).toBe("Finishing the run");
    // Two calls in one command: the last says what it waits on.
    expect(
      commandLabel(`"$A" control list && "$A" control wait --json '{}'`),
    ).toBe("Waiting for the agents");
  });

  it("are told from other programs' control commands", () => {
    expect(controlCommandLabel("launchctl control list")).toBeNull();
    expect(controlCommandLabel("git log --oneline")).toBeNull();
  });
});

describe("any other command as a label", () => {
  it("drops leading settings and shortens absolute paths", () => {
    expect(commandLabel("FOO=1 BAR='a b' npm test")).toBe("npm test");
    expect(
      commandLabel("export PATH=/usr/local/bin:$PATH && npm run build"),
    ).toBe("npm run build");
    expect(commandLabel("cd /Users/jack/Projects/site && npm run dev")).toBe(
      "cd site && npm run dev",
    );
    expect(commandLabel("cat '/Users/jack/My Notes/todo.md'")).toBe(
      "cat todo.md",
    );
    expect(commandLabel("node --config=/etc/app/config.json server.js")).toBe(
      "node --config=config.json server.js",
    );
  });

  it("leaves short paths, addresses and plain commands alone", () => {
    expect(commandLabel("ls /tmp")).toBe("ls /tmp");
    expect(commandLabel("curl http://localhost:5173/api/items")).toBe(
      "curl http://localhost:5173/api/items",
    );
    expect(commandLabel("npm test -- src/app.test.ts")).toBe(
      "npm test -- src/app.test.ts",
    );
    expect(commandLabel("FOO=1")).toBe("FOO=1");
    expect(commandLabel("  ")).toBe("");
  });

  it("applies to shell rows only", () => {
    expect(
      toolDisplayLabel({
        kind: "execute",
        title: `A='${CLI}'; "$A" control wait --json '{}'`,
      }),
    ).toBe("Waiting for the agents");
    expect(toolDisplayLabel({ kind: "execute", title: "CI=1 npm test" })).toBe(
      "npm test",
    );
    expect(
      toolDisplayLabel({ kind: "read", title: "Read", path: "src/app.ts" }),
    ).toBe("Read src/app.ts");
  });
});
