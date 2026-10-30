// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crewFenceView } from "../lib/crewFences";
import {
  getCrew,
  queuedCards,
  resetCrewsCache,
  updateCrew,
} from "../lib/crews";
import {
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "../lib/featureCards";
import { memoryStorage } from "../lib/devSmoke";
import { resetProjectBotsCache } from "../lib/projectBots";
import { AgentMarkdown } from "./AgentMarkdown";

/*
 * A crew's fenced blocks never show as raw JSON in a chat: each is a
 * compact card in Aven's words, with the bot's words as quoted text.
 */

const fenced = (name: string, body: unknown) =>
  `Here's what I found.\n\n\`\`\`${name}\n${JSON.stringify(body)}\n\`\`\`\n`;

const IDEAS = fenced("aven-ideas", {
  ideas: [
    { title: "Timer screen", why: "The core of Pom", size: "small" },
    { title: "Pause and resume", size: "medium" },
    { title: "Haptics on finish", size: "small" },
  ],
});

describe("a crew block's card", () => {
  it("reads each kind of block in Aven's words", () => {
    expect(
      crewFenceView(
        "aven-ideas",
        JSON.stringify({ ideas: [{ title: "Timer", size: "small" }] }),
      ),
    ).toEqual({
      kind: "ideas",
      label: "1 idea",
      items: [{ title: "Timer", detail: "small" }],
    });
    expect(
      crewFenceView(
        "aven-verdict",
        JSON.stringify({
          pass: false,
          summary: "Not yet.",
          mustFix: [{ text: "Contrast", where: "a.css" }, { text: "Reload" }],
        }),
      ),
    ).toMatchObject({ label: "2 must-fix", line: "Not yet." });
    expect(
      crewFenceView(
        "aven-handoff",
        JSON.stringify({ summary: "Built it", ran: [] }),
      ),
    ).toMatchObject({ label: "Handed over", line: "Built it" });
    expect(
      crewFenceView(
        "aven-goal",
        JSON.stringify({ met: true, summary: "All done" }),
      ),
    ).toMatchObject({ label: "Goal met", line: "All done" });
    expect(crewFenceView("aven-ideas", "{not json")).toBeNull();
  });

  it("never shows a crew block as raw JSON in a chat", () => {
    for (const text of [
      IDEAS,
      fenced("aven-verdict", {
        pass: true,
        summary: "Looks right.",
        mustFix: [],
      }),
      fenced("aven-handoff", {
        summary: "Built the timer.",
        howToCheck: ["Open it"],
      }),
      fenced("aven-tasks", { tasks: [{ title: "Timer screen" }], goal: "Pom" }),
      fenced("aven-goal", { met: false, next: [{ title: "Timer screen" }] }),
      "```aven-ideas\n{broken",
    ]) {
      const markup = renderToStaticMarkup(
        createElement(AgentMarkdown, { text }),
      );
      expect(markup).not.toContain("&quot;");
      expect(markup).not.toContain("markdown-code-shell");
      expect(markup).toContain("data-crew-fence");
    }
    const ideas = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: IDEAS }),
    );
    expect(ideas).toContain("3 ideas");
    expect(ideas).toContain("Timer screen");
    expect(ideas).toContain("small · The core of Pom");
  });

  it("shows a quiet line while a crew block is still being written", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: '```aven-ideas\n{"ideas": [{"title": "Tim',
        streaming: true,
      }),
    );
    expect(markup).toContain("Writing a note for the crew…");
    expect(markup).not.toContain("Tim");
  });
});

describe("Give to crew from an ideas block", () => {
  const PROJECT = "/Users/me/pom";
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", memoryStorage());
    resetProjectBotsCache();
    resetCrewsCache();
    setFeatureCardBackend(memoryFeatureCardBackend());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setFeatureCardBackend(null);
    vi.unstubAllGlobals();
    resetCrewsCache();
  });

  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (item) => item.textContent === name,
    );

  it("gives one idea, or all of them, to the crew while it's on", async () => {
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text: IDEAS, cwd: PROJECT })),
    );
    const firstGive = container.querySelector<HTMLButtonElement>(
      ".crew-fence-items button",
    )!;
    await act(async () => firstGive.click());
    await act(async () => {
      for (let n = 0; n < 5; n += 1) await new Promise((r) => setTimeout(r, 0));
    });
    expect(queuedCards(getCrew(PROJECT)!).map((card) => card.title)).toEqual([
      "Timer screen",
    ]);
    expect(featureBoardState(PROJECT).cards[0]).toMatchObject({
      title: "Timer screen",
      column: "building",
    });
    await act(async () => button("Give all to crew")!.click());
    await act(async () => {
      for (let n = 0; n < 10; n += 1)
        await new Promise((r) => setTimeout(r, 0));
    });
    expect(queuedCards(getCrew(PROJECT)!).map((card) => card.title)).toEqual([
      "Timer screen",
      "Pause and resume",
      "Haptics on finish",
    ]);
  });

  it("offers no buttons while the crew is off", async () => {
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text: IDEAS, cwd: PROJECT })),
    );
    expect(container.querySelector(".crew-fence")).not.toBeNull();
    expect(container.querySelector(".crew-fence button")).toBeNull();
  });
});
