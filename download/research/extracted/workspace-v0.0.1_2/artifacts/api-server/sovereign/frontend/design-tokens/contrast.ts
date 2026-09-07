/**
 * OKLCH → relative-luminance (Y) and WCAG contrast gate.
 * Zero dependencies; pure math.
 */

export interface Oklch {
  l: number; // 0..1
  c: number; // chroma, >= 0
  h: number; // hue in degrees 0..360
}

const DEG2RAD = Math.PI / 180;

const _lumCache = new Map<string, number>();
function cacheKey(o: Oklch): string {
  return `${o.l.toFixed(4)}|${o.c.toFixed(4)}|${o.h.toFixed(2)}`;
}

/** Convert OKLCH → CIE XYZ (D65) → relative luminance Y. Memoised; compute once per colour. */
export function luminanceFromOklch(o: Oklch): number {
  const k = cacheKey(o);
  const cached = _lumCache.get(k);
  if (cached !== undefined) return cached;

  const hr = o.h * DEG2RAD;
  const a = o.c * Math.cos(hr);
  const b = o.c * Math.sin(hr);

  // OKLab → linear LMS
  const lc1 = o.l + 0.3963377774 * a + 0.2158037573 * b;
  const lc2 = o.l - 0.1055613458 * a - 0.0638541728 * b;
  const lc3 = o.l - 0.0894841775 * a - 1.2914855480 * b;

  const lms1 = lc1 * lc1 * lc1;
  const lms2 = lc2 * lc2 * lc2;
  const lms3 = lc3 * lc3 * lc3;

  // LMS → XYZ(D65)
  const y =
    -0.0405801784237345 * lms1 +
    1.1122568696168821 * lms2 +
    -0.0716766786656241 * lms3;

  const v = Math.max(0, y);
  _lumCache.set(k, v);
  return v;
}

/** Validate that an OKLCH token is in-range. */
export function isValidOklch(o: Oklch): boolean {
  return (
    Number.isFinite(o.l) && o.l >= 0 && o.l <= 1 &&
    Number.isFinite(o.c) && o.c >= 0 &&
    Number.isFinite(o.h)
  );
}

/** WCAG 2.1 contrast ratio between two luminances. */
export function contrastRatio(y1: number, y2: number): number {
  const lighter = Math.max(y1, y2);
  const darker = Math.min(y1, y2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check AA compliance (4.5:1 for normal text; 3:1 for large/UI). */
export function meetsAA(
  foreground: Oklch,
  background: Oklch,
  minRatio: number = 4.5
): boolean {
  const yFg = luminanceFromOklch(foreground);
  const yBg = luminanceFromOklch(background);
  return contrastRatio(yFg, yBg) >= minRatio;
}
