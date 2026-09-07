/**
 * tests/frontend/design-tokens.test.ts
 *
 * HAPPY     tokens exist, primitives cover full ramp, semantic tokens are valid OKLCH,
 *           dark-mode L-inversion is symmetric, and contrast passes WCAG AA.
 * EDGE      boundary values (lightest/darkest) and L-inversion round-trip.
 * FAIL-CLOSED invalid OKLCH rejected; insufficient contrast caught; missing tokens detected.
 */
import "../_flush.mjs";
import { test, assert, eq } from "../_harness.mjs";
import {
  cyan,
  neutral,
  semantic,
  darkSemantic,
  invertL,
  buildDarkTokens,
  toCssCustomProperties,
} from "../../frontend/design-tokens/index.ts";
import {
  luminanceFromOklch,
  contrastRatio,
  meetsAA,
  isValidOklch,
  type Oklch,
} from "../../frontend/design-tokens/index.ts";

// ─── Helpers ───

function assertValid(token: Oklch, label: string) {
  assert(isValidOklch(token), `${label} is valid OKLCH`);
}

function assertContrastAA(fg: Oklch, bg: Oklch, label: string, min = 4.5) {
  const ok = meetsAA(fg, bg, min);
  assert(ok, `${label} contrast ${contrastRatio(luminanceFromOklch(fg), luminanceFromOklch(bg)).toFixed(2)}:1 >= ${min}:1`);
}

// ─── Happy path ───

test("primitive cyan ramp covers 50–950", () => {
  const keys = Object.keys(cyan).sort((a, b) => +a - +b);
  eq(keys.length, 11);
  eq(keys[0], "50");
  eq(keys[keys.length - 1], "950");
  for (const k of keys) {
    assertValid(cyan[k], `cyan-${k}`);
  }
});

test("primitive neutrals cover 0–950", () => {
  const keys = Object.keys(neutral).sort((a, b) => +a - +b);
  eq(keys.length, 12);
  eq(keys[0], "0");
  eq(keys[keys.length - 1], "950");
  for (const k of keys) {
    assertValid(neutral[k], `neutral-${k}`);
  }
});

test("semantic tokens are valid OKLCH", () => {
  for (const [k, v] of Object.entries(semantic)) {
    assertValid(v, `semantic.${k}`);
  }
});

test("dark semantic tokens are valid OKLCH", () => {
  for (const [k, v] of Object.entries(darkSemantic)) {
    assertValid(v, `darkSemantic.${k}`);
  }
});

test("text on surface passes WCAG AA (4.5:1)", () => {
  assertContrastAA(semantic.text, semantic.surface, "text on surface");
});

test("accent on surface passes AA for UI (3:1)", () => {
  assertContrastAA(semantic.accent, semantic.surface, "accent on surface", 3);
});

test("danger on surface passes AA for UI (3:1)", () => {
  assertContrastAA(semantic.danger, semantic.surface, "danger on surface", 3);
});

test("verified on surface passes AA for UI (3:1)", () => {
  assertContrastAA(semantic.verified, semantic.surface, "verified on surface", 3);
});

test("dark text on dark surface passes AA", () => {
  assertContrastAA(darkSemantic.text, darkSemantic.surface, "dark text on dark surface");
});

test("CSS custom properties output is well-formed", () => {
  const css = toCssCustomProperties(semantic, "color");
  assert(css.startsWith(":root {"), "css starts with :root");
  assert(css.includes("--color-text:"), "css contains --color-text");
  assert(css.includes("oklch("), "css contains oklch()");
  assert(css.endsWith("}"), "css ends with brace");
});

// ─── Edge cases ───

test("L-inversion symmetry: invert(invert(token)) ≈ token", () => {
  const t = semantic.text;
  const roundTrip = invertL(invertL(t));
  eq(roundTrip.l.toFixed(2), t.l.toFixed(2), "L round-trip");
  eq(roundTrip.c, t.c, "C preserved");
  eq(roundTrip.h, t.h, "H preserved");
});

test("dark tokens are built by L-inversion of light tokens", () => {
  for (const [k, light] of Object.entries(semantic)) {
    const dark = darkSemantic[k];
    const expectedL = Math.max(0, Math.min(1, 1.0 - light.l));
    eq(dark.l.toFixed(3), expectedL.toFixed(3), `dark ${k} L inverted`);
    eq(dark.c, light.c, `dark ${k} C preserved`);
    eq(dark.h, light.h, `dark ${k} H preserved`);
  }
});

test("boundary primitives have plausible luminance ordering", () => {
  const y50 = luminanceFromOklch(cyan["50"]);
  const y950 = luminanceFromOklch(cyan["950"]);
  assert(y50 > y950, "cyan-50 is lighter than cyan-950");
});

test("neutral canvas is lighter than neutral-950", () => {
  const yCanvas = luminanceFromOklch(neutral["0"]);
  const y950 = luminanceFromOklch(neutral["950"]);
  assert(yCanvas > y950, "canvas lighter than neutral-950");
});

// ─── Fail-closed ───

test("invalid OKLCH with negative chroma is rejected", () => {
  const bad: Oklch = { l: 0.5, c: -0.1, h: 0 };
  eq(isValidOklch(bad), false, "negative chroma invalid");
});

test("invalid OKLCH with L > 1 is rejected", () => {
  const bad: Oklch = { l: 1.5, c: 0.1, h: 0 };
  eq(isValidOklch(bad), false, "L > 1 invalid");
});

test("invalid OKLCH with NaN is rejected", () => {
  const bad: Oklch = { l: NaN, c: 0.1, h: 0 };
  eq(isValidOklch(bad), false, "NaN L invalid");
});

test("contrast gate fails for nearly-identical colours", () => {
  const a: Oklch = { l: 0.5, c: 0.05, h: 225 };
  const b: Oklch = { l: 0.51, c: 0.05, h: 225 };
  const ok = meetsAA(a, b);
  eq(ok, false, "near-identical colours fail AA");
});

test("contrast gate fails for identical colours", () => {
  const a: Oklch = { l: 0.5, c: 0.05, h: 225 };
  eq(meetsAA(a, a), false, "identical colours fail AA");
});

test("missing semantic token is detected", () => {
  const hasAccent = "accent" in semantic;
  assert(hasAccent, "semantic.accent must exist");
});
