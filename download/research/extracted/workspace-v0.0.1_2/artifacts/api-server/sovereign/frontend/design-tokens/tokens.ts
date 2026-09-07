/**
 * TFA Frontend Design Tokens — machine-readable source of truth.
 * Zero runtime dependencies in backend.
 */

import type { Oklch } from "./contrast.ts";

// ─── Primitives ───

export const cyan: Record<string, Oklch> = {
  "50":  { l: 0.97, c: 0.020, h: 225 },
  "100": { l: 0.93, c: 0.040, h: 225 },
  "200": { l: 0.86, c: 0.070, h: 224 },
  "300": { l: 0.75, c: 0.100, h: 223 },
  "400": { l: 0.65, c: 0.130, h: 222 },
  "500": { l: 0.54, c: 0.140, h: 221 }, // primary accent
  "600": { l: 0.45, c: 0.130, h: 221 },
  "700": { l: 0.37, c: 0.110, h: 221 },
  "800": { l: 0.27, c: 0.080, h: 221 },
  "900": { l: 0.19, c: 0.055, h: 221 },
  "950": { l: 0.13, c: 0.040, h: 221 },
};

// Cyan-tinted neutrals (hue ≈225°, very low chroma)
export const neutral: Record<string, Oklch> = {
  "0":  { l: 0.99, c: 0.004, h: 225 }, // canvas
  "50": { l: 0.97, c: 0.006, h: 225 },
  "100": { l: 0.93, c: 0.007, h: 225 },
  "200": { l: 0.86, c: 0.008, h: 225 },
  "300": { l: 0.75, c: 0.009, h: 225 },
  "400": { l: 0.60, c: 0.010, h: 225 },
  "500": { l: 0.45, c: 0.011, h: 225 },
  "600": { l: 0.35, c: 0.010, h: 225 },
  "700": { l: 0.25, c: 0.009, h: 225 },
  "800": { l: 0.18, c: 0.008, h: 225 },
  "900": { l: 0.12, c: 0.007, h: 225 },
  "950": { l: 0.08, c: 0.006, h: 225 },
};

// Semantic colours
export const semantic = {
  surface:          neutral["0"],
  surfaceElevated:  neutral["50"],
  borderHairline:   neutral["200"],
  text:            { l: 0.20, c: 0.01, h: 240 },
  textMuted:       neutral["400"],
  accent:           cyan["500"],
  verified:        { l: 0.62, c: 0.16, h: 150 },
  danger:          { l: 0.58, c: 0.20, h: 25 },
  approvalPending: { l: 0.72, c: 0.15, h: 75 },
};

// ─── Dark-mode L-inversion ───

/** Invert OKLCH lightness around the mid-point (0.5). Hue and chroma preserved. */
export function invertL(token: Oklch): Oklch {
  return { l: Math.max(0, Math.min(1, 1.0 - token.l)), c: token.c, h: token.h };
}

/** Build dark semantic tokens by L-inversion of light semantic tokens. */
export function buildDarkTokens(light: Record<string, Oklch>): Record<string, Oklch> {
  const dark: Record<string, Oklch> = {};
  for (const [k, v] of Object.entries(light)) {
    dark[k] = invertL(v);
  }
  return dark;
}

export const darkSemantic = buildDarkTokens(semantic);

// ─── CSS custom properties generator ───

export function toCssCustomProperties(tokens: Record<string, Oklch>, prefix = "color"): string {
  const lines: string[] = [":root {"];
  for (const [k, v] of Object.entries(tokens)) {
    const name = `--${prefix}-${kebab(k)}`;
    lines.push(`  ${name}: oklch(${v.l.toFixed(3)} ${v.c.toFixed(3)} ${v.h});`);
  }
  lines.push("}");
  return lines.join("\n");
}

function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
