import { describe, expect, it } from "vitest";
import {
  AGENT_REUSE_LIMIT_MS,
  agentOpensProblem,
  agentOpensSummary,
  agentOpensTimings,
  agentOpensTooSlow,
  readAgentOpens,
  type AgentOpenReport,
} from "./devSmokePages";

const LOADING =
  "Your page is still loading. Take a snapshot again in a moment to read the new page.";

/** Six opens that built on one page, as the stand-in lists them. */
const built = (ms = [120, 340, 260, 250, 160, 240]): AgentOpenReport[] =>
  ["-", "reloaded", "navigated", "navigated", "-", "navigated"].map(
    (reused, index) => ({
      id: index < 4 ? "page-a" : "page-b",
      reused: reused === "-" ? null : reused,
      ms: ms[index],
    }),
  );

describe("the agent pages step", () => {
  it("passes opens that built on one page, with what each took", () => {
    const text = `AVEN_SMOKE_OK AVEN_PAGES ${JSON.stringify(built())}`;
    const { opens, failure } = readAgentOpens(text);
    expect(failure).toBeUndefined();
    expect(agentOpensProblem(opens)).toBeNull();
    expect(agentOpensSummary(opens)).toBe(
      "one page reloaded and navigated, a second only for another path (-, reloaded, navigated, navigated, -, navigated) in 120, 340, 260, 250, 160, 240 ms",
    );
    expect(agentOpensTooSlow(built())).toBeNull();
    // An open handed back before its page arrived still built on it.
    const slow = built();
    slow[1] = { ...slow[1], ms: 6100, note: LOADING };
    expect(agentOpensProblem(slow)).toBeNull();
    expect(agentOpensSummary(slow)).toMatch(
      / in 120, 6100, .* ms; 1 still loading when handed back$/,
    );
  });

  it("fails reuses of the local page that wait out their limits", () => {
    // The 0.1.158 trial run: every reuse waited its full 2 s, stopped the
    // load, then waited 4 s more for a page that never loaded.
    const stalled = built([108, 6335, 6331, 6297, 229, 6199]).map((open) =>
      open.reused ? { ...open, note: LOADING } : open,
    );
    expect(agentOpensProblem(stalled)).toBeNull();
    expect(agentOpensTooSlow(stalled)).toBe(
      `Reusing the check's local page must hand back its loaded page within ${AGENT_REUSE_LIMIT_MS} ms, but open 2 (reloaded) took 6335 ms and handed back still loading; open 3 (navigated) took 6331 ms and handed back still loading; open 4 (navigated) took 6297 ms and handed back still loading; open 6 (navigated) took 6199 ms and handed back still loading (1. - 108 ms, 2. reloaded 6335 ms (still loading), 3. navigated 6331 ms (still loading), 4. navigated 6297 ms (still loading), 5. - 229 ms, 6. navigated 6199 ms (still loading))`,
    );
  });

  it("allows the limit, and times only the opens that reuse the page", () => {
    // New pages hand back once they exist; only reuses wait for a load.
    const edge = built([2400, AGENT_REUSE_LIMIT_MS, 900, 40, 3000, 700]);
    expect(agentOpensTooSlow(edge)).toBeNull();
    const over = built([120, AGENT_REUSE_LIMIT_MS + 1, 900, 40, 160, 700]);
    expect(agentOpensTooSlow(over)).toMatch(
      /but open 2 \(reloaded\) took 1501 ms \(1\. - 120 ms, /,
    );
    // Quick, but handed back before the page arrived: it never loaded.
    const early = built();
    early[3] = { ...early[3], note: LOADING };
    expect(agentOpensTooSlow(early)).toMatch(
      /but open 4 \(navigated\) took 250 ms and handed back still loading \(/,
    );
    // A reuse with no time is not a pass.
    const untimed = built();
    delete untimed[2].ms;
    expect(agentOpensTooSlow(untimed)).toMatch(
      /but open 3 \(navigated\) took an unknown time \(/,
    );
  });

  it("names each open's time when an open failed or got no answer", () => {
    const text = `AVEN_SMOKE_OK AVEN_PAGES FAILED open 3 got no answer in 20 s ${JSON.stringify(
      [...built().slice(0, 2), { ms: 20004 }],
    )}`;
    const { opens, failure } = readAgentOpens(text);
    expect(opens).toHaveLength(3);
    expect(failure).toBe(
      "The stand-in's opens failed: open 3 got no answer in 20 s (1. - 120 ms, 2. reloaded 340 ms, 3. no answer 20004 ms)",
    );
    expect(
      readAgentOpens(
        "AVEN_SMOKE_OK AVEN_PAGES FAILED no scoped connection in this process []",
      ).failure,
    ).toBe(
      "The stand-in's opens failed: no scoped connection in this process (none answered)",
    );
  });

  it("fails on no list, an unreadable one, or opens that made copies", () => {
    expect(readAgentOpens("").failure).toBe("The stand-in reported: nothing");
    expect(readAgentOpens("AVEN_SMOKE_OK").failure).toBe(
      "The stand-in reported: AVEN_SMOKE_OK",
    );
    expect(readAgentOpens("AVEN_SMOKE_OK AVEN_PAGES [{").failure).toBe(
      "The stand-in reported: AVEN_SMOKE_OK AVEN_PAGES [{",
    );
    const copies = built();
    copies[2] = { ...copies[2], id: "page-c", reused: null };
    expect(agentOpensProblem(copies)).toMatch(
      /^The opens returned .*"page-c".* \(1\. - 120 ms, 2\. reloaded 340 ms, 3\. - 260 ms, /,
    );
    expect(agentOpensProblem(built().slice(0, 5))).not.toBeNull();
  });

  it("marks a note that is not about loading by its first words", () => {
    expect(
      agentOpensTimings([
        {
          id: "page-z",
          ms: 90,
          note: "The user has been using your earlier page, so it was left as it is and this opened a new page. Use this id.",
        },
      ]),
    ).toBe(
      "1. - 90 ms (note: The user has been using your earlier page, so it was left as)",
    );
  });
});
