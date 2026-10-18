import { describe, expect, it } from "vitest";
import { stanceOpening, replyStance } from "./discussionStance";

describe("replyStance", () => {
  it.each([
    "Agreed.",
    "Agreed — let's use a map instead.",
    "Agreed, and I'd add a test for the empty case.",
    "I agree with the plan as written.",
    "I fully agree; ship it.",
    "We agree on the cache key.",
    "Yes, that's the right call.",
    "Yes — do it in two commits.",
    "Yep. Go ahead.",
    "Yeah, that covers it.",
    "Good catch. The cache needs a TTL.",
    "Good catch. Instead of patching, we should rewrite the loop.",
    "Nice catch on the race.",
    "Great point about the retries.",
    "Fair point.",
    "Fair enough, let's keep the flag.",
    "That works.",
    "That works for me; I'll start with the parser.",
    "This makes sense to me.",
    "Makes sense.",
    "Sounds good — I'll take the tests.",
    "Exactly.",
    "Absolutely, the store should own it.",
    "You're right, the hook re-renders too often.",
    "You’re right about the key.",
    "That's right.",
    "Right. Let's move on.",
    "+1 to the smaller patch.",
    "LGTM.",
    "Looks good to me.",
    "No objections here.",
    "No disagreement from me on the schema.",
    "I'm on board with the split.",
    "**Agreed.** The rest follows.",
    "## Agreed\n\nThe cache stays.",
    "> Yes\n\nwe should",
    "- Agreed on all three points.",
  ])("agrees: %s", (reply) => {
    expect(replyStance(reply)).toBe("agree");
  });

  it.each([
    "Pushback: the cache hides a real bug.",
    "Push back on one thing: the TTL.",
    "I'd push back on caching at all.",
    "I would push back here.",
    "Let me push back a little.",
    "I disagree. The store should not own it.",
    "Disagree — the hook is fine.",
    "I respectfully disagree with the second step.",
    "I don't agree that we need a flag.",
    "Not quite. The key misses the locale.",
    "Not really; the cost is in parsing.",
    "Not so fast — the tests don't cover it.",
    "I'm not convinced the cache helps.",
    "I'm skeptical of the rewrite.",
    "Hold on, that changes the API.",
    "Wait, the migration runs first.",
    "No, that breaks the old clients.",
    "Nope.",
    "On the contrary, it's slower.",
    "Counterpoint: users rely on the order.",
    "I see it differently.",
    "I'd argue the opposite.",
    "I'd rather not add a dependency.",
    "Instead, let's precompute the table.",
    "Instead of a cache, precompute it.",
    "Rather than caching, memoise the parser.",
    "That won't work with streaming replies.",
    "This doesn't work for large files.",
    "Let's precompute the table instead.",
    "The plan is fine, but I'd push back on the TTL.",
    "Interesting idea; I disagree with the cost estimate though.",
    "I’d push back on that.",
  ])("pushes back: %s", (reply) => {
    expect(replyStance(reply)).toBe("pushback");
  });

  it.each([
    // Neutral.
    "Here's the plan for the cache.",
    "Let's look at the parser first.",
    "The cache key is the URL and the locale.",
    "Two things to check before we start.",
    "Good question. It depends on the size.",
    "Right now the hook runs on every render.",
    "Yesterday's run was slower.",
    "Notably, the parser is fast.",
    "No problem, I'll write it up.",
    "Hmm, let me think about it.",
    "```ts\nconst cache = new Map();\n```",
    "",
    "   ",
    // Mixed or turned: too unclear to call.
    "Yes, but the TTL is too long.",
    "Agreed, but one change: drop the flag.",
    "Agreed on the cache; I'd push back on the TTL.",
    "Good catch, though the fix is elsewhere.",
    "Fair point, however the tests disagree.",
    "Yes and no.",
    "I partly agree.",
    "Mostly agree, with one note.",
    "I don't disagree, but let's measure first.",
    "Absolutely not.",
    "Definitely not the cache.",
    "Agreed. However, the TTL must be shorter.",
  ])("stays neutral: %j", (reply) => {
    expect(replyStance(reply)).toBeNull();
  });

  it("reads only the start of a reply", () => {
    const later = `Here is the plan.\n\nIt has many parts. ${"More. ".repeat(40)}I disagree with the old one.`;
    expect(replyStance(later)).toBeNull();
    expect(replyStance("Agreed.\n\nI'd push back on the old plan later.")).toBe(
      "agree",
    );
  });
});

describe("stanceOpening", () => {
  it("is the first sentence or two in plain lower-case words", () => {
    expect(stanceOpening("**Agreed.** Ship it. Then test.")).toBe(
      "agreed. ship it.",
    );
    expect(stanceOpening("# Pushback\nThe TTL")).toBe("pushback");
    expect(stanceOpening("I’d say “yes”.")).toBe(`i'd say "yes".`);
    expect(stanceOpening("word ".repeat(100)).length).toBeLessThanOrEqual(180);
  });
});
