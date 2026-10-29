import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  addStripPane,
  applyStripView,
  combineStripTabs,
  detachStripTab,
  entryKey,
  focusStripTab,
  healWorkspaceStrip,
  insertStripPane,
  joinStripSplit,
  resolveWorkspaceStrip,
  separateStripSpace,
  stripProblems,
  stripView,
  viewMembers,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import {
  closeWorkspaceViews,
  splitWorkspaceView,
  toggleWorkspaceExpansion,
  type WorkspaceView,
} from "./workspaceViews";
import { railSide } from "./paneRails";

/** A small seeded generator, so a failure names a case that repeats. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}
type Random = ReturnType<typeof random>;

const UNIVERSE = Array.from({ length: 12 }, (_, i) => `t${i}`);

function someIds(r: Random): string[] {
  return UNIVERSE.filter(() => r.chance(0.6));
}

/** A layout tree over some ids, with now and then a stray or broken part. */
function tree(r: Random, ids: string[], depth = 0): LayoutNode {
  if (depth > 2 || ids.length < 2 || r.chance(0.3)) {
    const node: LayoutNode = leaf(r.chance(0.9) ? r.pick(ids) : "ghost");
    return r.chance(0.15) ? { ...node, rail: r.pick([0.3, 7, -1, NaN]) } : node;
  }
  const count = 2 + r.int(2);
  const children = Array.from({ length: count }, () => tree(r, ids, depth + 1));
  return {
    type: "split",
    id: `s${depth}-${r.int(1000)}`,
    dir: r.chance(0.5) ? "right" : "down",
    children,
    sizes: children.map(() => (r.chance(0.1) ? NaN : r.next())),
    ...(r.chance(0.1) ? { rail: 0.4 } : {}),
  };
}

function view(r: Random, ids: string[]): WorkspaceView {
  const pool = ids.length ? ids : ["ghost"];
  const layout = r.chance(0.05) ? null : tree(r, pool);
  const owners = layout ? leafIds(layout) : [];
  const groups: Record<string, string[]> = {};
  for (const owner of owners)
    groups[owner] = [owner, ...pool.filter(() => r.chance(0.2))];
  const base: WorkspaceView = {
    layout,
    focusedId: r.pick([...pool, "ghost"]),
    order: pool.filter(() => r.chance(0.7)),
    groups,
  };
  if (r.chance(0.15))
    return {
      ...base,
      hiddenGroups: { [r.pick(pool)]: pool.filter(() => r.chance(0.3)) },
      restoreView: {
        layout: tree(r, pool),
        focusedId: r.pick(pool),
        order: pool,
        groups: {},
      },
    };
  return base;
}

/** A stored strip as it might be read back: tabs twice, tabs long closed. */
function storedStrip(r: Random): WorkspaceStrip {
  const entries: StripEntry[] = [];
  const count = r.int(7);
  for (let i = 0; i < count; i++) {
    if (r.chance(0.55)) entries.push({ kind: "item", id: r.pick(UNIVERSE) });
    else
      entries.push({
        kind: "space",
        id: `space${i}`,
        view: view(
          r,
          UNIVERSE.filter(() => r.chance(0.4)),
        ),
      });
  }
  const keys = entries.map(entryKey);
  return { entries, front: r.chance(0.8) && keys.length ? r.pick(keys) : "x" };
}

const flat = (ids: string[]) => (): WorkspaceView => ({
  layout: ids[0] ? leaf(ids[0]) : null,
  focusedId: ids[0] ?? "",
  order: ids,
  groups: ids[0] ? { [ids[0]]: ids } : {},
});

describe("a restored strip never loses a tab", () => {
  it("holds every open tab exactly once, whatever was stored (fuzzed)", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const r = random(seed);
      const stored = JSON.parse(JSON.stringify(storedStrip(r)));
      const ids = someIds(r);
      const healed = healWorkspaceStrip(stored, ids);
      expect(stripProblems(healed, ids), `seed ${seed}`).toEqual([]);
      // Reading it back again changes nothing.
      expect(
        healWorkspaceStrip(JSON.parse(JSON.stringify(healed)), ids),
      ).toEqual(healed);
    }
  });

  it("puts a tab the stored strip lost on the strip, not inside the split in front", () => {
    const stored: WorkspaceStrip = {
      entries: [
        {
          kind: "space",
          id: "s",
          view: {
            layout: {
              type: "split",
              id: "row",
              dir: "right",
              sizes: [0.5, 0.5],
              children: [leaf("chat"), leaf("page")],
            },
            focusedId: "chat",
            order: ["chat", "page"],
            groups: { chat: ["chat"], page: ["page"] },
          },
        },
      ],
      front: "aven-space:s",
    };
    const healed = healWorkspaceStrip(stored, ["chat", "page", "lost"]);
    expect(healed.entries.map(entryKey)).toEqual(["aven-space:s", "lost"]);
    expect(healed.front).toBe("aven-space:s");
  });

  it("keeps the first place of a tab held twice, and drops tabs no longer open", () => {
    const healed = healWorkspaceStrip(
      {
        entries: [
          { kind: "item", id: "a" },
          { kind: "item", id: "gone" },
          { kind: "item", id: "a" },
          { kind: "item", id: "b" },
        ],
        front: "gone",
      },
      ["a", "b"],
    );
    expect(healed).toEqual({
      entries: [
        { kind: "item", id: "a" },
        { kind: "item", id: "b" },
      ],
      front: "a",
    });
  });

  it("names what is wrong with a strip", () => {
    expect(
      stripProblems(
        {
          entries: [
            { kind: "item", id: "a" },
            { kind: "item", id: "a" },
          ],
          front: "z",
        },
        ["a", "b"],
      ),
    ).toEqual([
      "a held 2 times",
      "b held 0 times",
      "front z is not on the strip",
    ]);
  });
});

describe("moves on the strip never lose a tab (fuzzed)", () => {
  /** One random thing a person (or a closing tab) does to the strip. */
  function step(r: Random, strip: WorkspaceStrip, ids: string[]) {
    const keys = strip.entries.map(entryKey);
    const tab = r.pick(ids.length ? ids : ["none"]);
    const key = r.pick(keys.length ? keys : ["none"]);
    const spaces = keys.filter((entry) => entry.startsWith("aven-space:"));
    switch (r.int(11)) {
      case 0:
        return { strip: combineStripTabs(strip, r.pick(ids), tab), ids };
      case 1:
        return spaces.length
          ? { strip: addStripPane(strip, r.pick(spaces), tab), ids }
          : { strip, ids };
      case 2: {
        if (!spaces.length) return { strip, ids };
        const at = r.pick(spaces);
        const entry = strip.entries.find((e) => entryKey(e) === at);
        const panes =
          entry?.kind === "space" && entry.view.layout
            ? leafIds(entry.view.layout)
            : [tab];
        return {
          strip: insertStripPane(
            strip,
            at,
            tab,
            r.pick(panes),
            r.chance(0.5) ? "before" : "after",
          ),
          ids,
        };
      }
      case 3:
        return {
          strip: detachStripTab(strip, tab, r.chance(0.5) ? key : null),
          ids,
        };
      case 4:
        return { strip: separateStripSpace(strip, key), ids };
      case 5:
        return spaces.length
          ? { strip: joinStripSplit(strip, r.pick(spaces), tab), ids }
          : { strip, ids };
      case 6:
        return { strip: focusStripTab(strip, tab), ids };
      case 7: {
        // Split the view in front.
        const front = stripView(strip);
        return {
          strip: applyStripView(
            strip,
            splitWorkspaceView(
              front,
              tab,
              r.pick(["left", "right", "up", "down"]),
              r.pick(ids),
            ),
          ),
          ids,
        };
      }
      case 8: {
        // Close some tabs.
        const closing = ids.filter(() => r.chance(0.2));
        const front = stripView(strip);
        const next = ids.filter((id) => !closing.includes(id));
        return {
          strip: applyStripView(
            strip,
            closeWorkspaceViews(front, closing, front.focusedId),
          ),
          ids: next,
        };
      }
      case 9: {
        // A new tab opens; or a pane is expanded or collapsed.
        if (r.chance(0.5)) {
          const fresh = UNIVERSE.find((id) => !ids.includes(id));
          return { strip, ids: fresh ? [...ids, fresh] : ids };
        }
        const front = stripView(strip);
        return {
          strip: applyStripView(
            strip,
            toggleWorkspaceExpansion(front, front.focusedId),
          ),
          ids,
        };
      }
      default: {
        const front = stripView(strip);
        const layout = front.layout;
        if (!layout || layout.type !== "split") return { strip, ids };
        return {
          strip: applyStripView(strip, {
            ...front,
            layout: railSide(
              layout,
              layout.id,
              0,
              r.chance(0.5) ? "before" : "after",
            ),
          }),
          ids,
        };
      }
    }
  }

  it("holds every open tab exactly once after each step and each restart", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = random(seed * 7919);
      let ids = someIds(r);
      let strip = resolveWorkspaceStrip(
        undefined,
        ids,
        ids[0] ?? "",
        flat(ids),
      );
      for (let move = 0; move < 25; move++) {
        const next = step(r, strip, ids);
        ids = next.ids;
        // What the workspace reads back after each change, as on a restart.
        strip = resolveWorkspaceStrip(
          JSON.parse(JSON.stringify(next.strip)),
          ids,
          "",
          flat(ids),
        );
        expect(stripProblems(strip, ids), `seed ${seed}, move ${move}`).toEqual(
          [],
        );
        for (const entry of strip.entries)
          if (entry.kind === "space")
            expect(viewMembers(entry.view).length).toBeGreaterThan(1);
      }
    }
  });
});
