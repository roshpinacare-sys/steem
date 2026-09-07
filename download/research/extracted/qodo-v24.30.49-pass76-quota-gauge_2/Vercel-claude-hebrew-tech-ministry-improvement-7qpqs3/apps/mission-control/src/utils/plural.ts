/**
 * plural — correct singular/plural rendering so the UI never says "1 events".
 * `plural(1, "run")` → "1 run"; `plural(2, "run")` → "2 runs";
 * irregulars via the third arg: `plural(1, "entry", "entries")`.
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm ?? singular + "s"}`;
}

/** Just the noun, correctly inflected (when the count is rendered separately). */
export function pluralWord(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : pluralForm ?? singular + "s";
}
