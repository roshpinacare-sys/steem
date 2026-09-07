const MAX_PATTERN_LENGTH = 160;

/**
 * Conservative regex gate for policy-as-data. It rejects constructs commonly
 * associated with catastrophic backtracking or hidden control flow. The policy
 * language is intentionally less expressive than JavaScript RegExp.
 */
export function compileSafeRegex(pattern: string): RegExp | undefined {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return undefined;
  if (/\\[1-9]/.test(pattern)) return undefined; // backreferences
  if (/\(\?[=!<]/.test(pattern)) return undefined; // lookarounds
  if (/\(\?<[A-Za-z]/.test(pattern)) return undefined; // named captures
  if (/\([^)]*[+*][^)]*\)\s*(?:[+*]|\{\d)/.test(pattern)) return undefined; // nested quantifiers
  if (/([+*?]|\{\d+(?:,\d*)?\})\s*([+*?]|\{)/.test(pattern)) return undefined;
  if ((pattern.match(/\.\*/g) ?? []).length > 1) return undefined;
  try {
    return new RegExp(pattern, "u");
  } catch {
    return undefined;
  }
}

export function isSafeRegex(pattern: string): boolean {
  return compileSafeRegex(pattern) !== undefined;
}
