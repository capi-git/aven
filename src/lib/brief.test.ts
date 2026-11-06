import { describe, expect, it, vi } from "vitest";
import {
  BRIEF_SYSTEM_PROMPT,
  briefPrompt,
  cleanBrief,
  partialBrief,
  tidyIntoBrief,
  type BriefDeps,
} from "./brief";

vi.mock("./errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./errors")>()),
  logError: vi.fn(),
}));

const RAMBLE =
  "so um I want like a mic button in the message box and uh the words should show up as I talk and then when I stop I can send it";
const BRIEF = `Goal: Add a mic button to the message box.

Details:
- Words appear as I talk.

Done when:
- I can speak, stop and send.`;

function deps(
  reply: string | Error,
  model = true,
): BriefDeps & {
  generate: ReturnType<typeof vi.fn>;
} {
  return {
    model: async () =>
      model ? { harness: "claude", label: "Claude Haiku 4.5" } : null,
    generate: vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  };
}

describe("tidying spoken words into a brief", () => {
  it("asks the cheap model with the brief's rules and the words as said", async () => {
    const fake = deps(BRIEF);
    const result = await tidyIntoBrief(RAMBLE, { deps: fake });
    expect(result).toEqual({
      ok: true,
      brief: BRIEF,
      model: "Claude Haiku 4.5",
    });
    expect(fake.generate).toHaveBeenCalledTimes(1);
    const [, input] = fake.generate.mock.calls[0];
    expect(input.system).toBe(BRIEF_SYSTEM_PROMPT);
    expect(input.prompt).toContain(RAMBLE);
  });

  it("asks for the goal, the details said and what done looks like, and nothing invented", () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/^Goal:/m);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/^Details:/m);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/^Done when:/m);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(briefPrompt(`  ${RAMBLE}\n`)).toBe(
      `What they said:\n\n"""\n${RAMBLE}\n"""`,
    );
  });

  it("says so when no provider can tidy", async () => {
    const fake = deps(BRIEF, false);
    expect(await tidyIntoBrief(RAMBLE, { deps: fake })).toEqual({
      ok: false,
      error: "Tidying needs Claude Code or Codex.",
    });
    expect(fake.generate).not.toHaveBeenCalled();
  });

  it("refuses an empty reply or a failure in a few words", async () => {
    expect(await tidyIntoBrief(RAMBLE, { deps: deps("  \n") })).toEqual({
      ok: false,
      error: "Couldn't tidy that. Try again.",
    });
    expect(
      await tidyIntoBrief(RAMBLE, { deps: deps(new Error("Timed out.")) }),
    ).toEqual({
      ok: false,
      error: "Couldn't tidy: Timed out.",
    });
  });

  it("has nothing to tidy without words", async () => {
    const fake = deps(BRIEF);
    expect((await tidyIntoBrief("   ", { deps: fake })).ok).toBe(false);
    expect(fake.generate).not.toHaveBeenCalled();
  });
});

describe("a brief while it's written", () => {
  it("asks for a quick answer and passes on the brief as it arrives", async () => {
    const fake = deps(BRIEF);
    fake.generate.mockImplementation(
      async (
        _model: unknown,
        _input: unknown,
        options: { onText?: (text: string) => void },
      ) => {
        options.onText?.("```text\nGoal: Add");
        options.onText?.("```text\n" + BRIEF);
        return "```text\n" + BRIEF + "\n```";
      },
    );
    const seen: string[] = [];
    const result = await tidyIntoBrief(RAMBLE, {
      deps: fake,
      onText: (text) => seen.push(text),
    });
    expect(result).toMatchObject({ ok: true, brief: BRIEF });
    expect(fake.generate.mock.calls[0][2]).toMatchObject({ quick: true });
    expect(seen).toEqual(["Goal: Add", BRIEF]);
  });

  it("shows nothing for an opening fence on its own", () => {
    expect(partialBrief("```")).toBe("");
    expect(partialBrief("```markdown\n")).toBe("");
    expect(partialBrief('"""\nGoal: x')).toBe("Goal: x");
    expect(partialBrief("Goal: x")).toBe("Goal: x");
  });
});

describe("the model's reply", () => {
  it("loses a code fence or quotes around the brief", () => {
    expect(cleanBrief("```text\n" + BRIEF + "\n```")).toBe(BRIEF);
    expect(cleanBrief('"""\n' + BRIEF + '\n"""')).toBe(BRIEF);
  });

  it("keeps one blank line between sections", () => {
    expect(cleanBrief("Goal: x\n\n\n\nDetails:\n- y\n")).toBe(
      "Goal: x\n\nDetails:\n- y",
    );
  });
});
