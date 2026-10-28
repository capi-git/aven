import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TAB_CSS_SPRINGS,
  TAB_FLICK_SPEED,
  TAB_LIFT_SCALE,
  TAB_SPRING,
} from "./motionTokens";
import { MOTION_MS } from "./motion";
import { springCurve, springSettleTime } from "./spring";

const css = readFileSync("src/chrome/TitleBar.css", "utf8");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A custom property's value in the first rule that sets it after `from`. */
function property(name: string, from = 0): string {
  const at = rules.indexOf(`${name}:`, from);
  if (at < 0) throw new Error(`Missing ${name}`);
  return rules
    .slice(at + name.length + 1, rules.indexOf(";", at))
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

/** The body of the first rule whose selector is exactly `selector`. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing rule ${selector}`);
  return source.slice(at, source.indexOf("}", at));
}

describe("tab motion tokens", () => {
  it("keep one spring family: no overshoot at rest, a little only from a throw", () => {
    expect(TAB_SPRING.move.damping).toBe(1);
    expect(TAB_SPRING.lift.damping).toBe(1);
    expect(TAB_SPRING.flick.damping).toBeGreaterThanOrEqual(0.8);
    expect(TAB_SPRING.flick.damping).toBeLessThan(1);
    expect(TAB_SPRING.pop.damping).toBeGreaterThanOrEqual(0.75);
    for (const [name, spring] of Object.entries(TAB_SPRING)) {
      if (name === "fade") continue;
      expect(spring.response).toBeGreaterThanOrEqual(0.15);
      expect(spring.response).toBeLessThanOrEqual(0.3);
    }
    // The fade is as quick as Aven's other fades.
    expect(TAB_SPRING.fade.damping).toBe(1);
    expect(
      Math.abs(
        springSettleTime(TAB_SPRING.fade, 0, 1, 0, 0.002) * 1000 -
          MOTION_MS.fast,
      ),
    ).toBeLessThan(20);
    expect(TAB_LIFT_SCALE).toBeGreaterThan(1);
    expect(TAB_LIFT_SCALE).toBeLessThanOrEqual(1.03);
    expect(TAB_FLICK_SPEED).toBeGreaterThan(0);
  });

  it("give CSS the same curves as the springs, and a fallback without linear()", () => {
    const supports = rules.indexOf(
      "@supports (transition-timing-function: linear(0, 1))",
    );
    expect(supports).toBeGreaterThan(0);
    for (const name of ["move", "lift"] as const) {
      const curve = springCurve(TAB_SPRING[name], { precision: 0.004 });
      expect(TAB_CSS_SPRINGS[name]).toEqual(curve);
      expect(property(`--aven-tab-spring-${name}`, supports)).toBe(
        curve.easing,
      );
      expect(property(`--aven-tab-spring-${name}-ms`)).toBe(`${curve.ms}ms`);
      expect(property(`--aven-tab-spring-${name}`)).toMatch(/^cubic-bezier\(/);
    }
  });

  it("zero their CSS durations when motion is reduced, by Aven or the system", () => {
    for (const reduced of [
      rule(
        rules,
        ':root[data-motion="reduce"],\n:root[data-motion="reduce"] .personal-shell',
      ),
      rules.slice(
        rules.indexOf("@media (prefers-reduced-motion: reduce) {\n  :root,"),
      ),
    ]) {
      expect(reduced).toMatch(/--aven-tab-spring-move-ms: 0ms;/);
      expect(reduced).toMatch(/--aven-tab-spring-lift-ms: 0ms;/);
    }
  });

  it("time every eased part of tab motion in CSS by the spring tokens", () => {
    for (const selector of [
      ".personal-shell [data-tab-opening]",
      ".personal-tab-ghost",
      ".aven-split-incoming",
      ".aven-combine > *",
    ]) {
      const body = rule(rules, selector);
      expect(body).toMatch(/var\(--aven-tab-spring-(move|lift)-ms\)/);
      expect(body).not.toMatch(/\d+ms\s+cubic-bezier|cubic-bezier\(/);
    }
    // Springs, not CSS transitions, move tab visuals.
    expect(rule(rules, ".aven-tab-motion")).not.toMatch(/transition/);
  });

  it("are the only springs and curves the tab motion code uses", () => {
    for (const file of [
      "src/lib/sortableMotion.ts",
      "src/lib/stripMorph.ts",
      "src/hooks/useSortable.ts",
      "src/hooks/useTabHighlight.ts",
      "src/hooks/useTabSlotMotion.ts",
    ]) {
      const source = readFileSync(file, "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        "",
      );
      expect(source, file).not.toMatch(/damping:\s*[\d.]/);
      expect(source, file).not.toMatch(/response:\s*[\d.]/);
      expect(source, file).not.toMatch(/cubic-bezier\(/);
    }
    // The drop preview's springs come from the tokens too.
    const stage = readFileSync("src/surfaces/WorkspaceStage.tsx", "utf8");
    const preview = stage.slice(
      stage.indexOf("// The preview's box is drawn from springs"),
      stage.indexOf("const pending = dropReveal.current;"),
    );
    expect(preview).toMatch(/TAB_SPRING\.move/);
    expect(preview).not.toMatch(/damping:|DOCK_TWEEN_MS|DOCK_EASE/);
  });
});
