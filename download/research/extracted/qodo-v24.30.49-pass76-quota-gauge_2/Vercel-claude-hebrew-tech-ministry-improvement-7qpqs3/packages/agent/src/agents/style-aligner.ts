import type { GitHubClient } from "../services/github-client.js";
import type { Telemetry } from "../services/telemetry.js";

export interface StyleRules {
  eslintRules: string[];
  tsconfigRules: string[];
}

/**
 * Fetches the repository's eslint.config.js and tsconfig.json and extracts
 * strict rules that the Coder must honor. The extracted rules are injected
 * into the Coder's system prompt.
 */
export async function fetchStyleRules(
  gh: GitHubClient,
  telemetry?: Telemetry,
): Promise<StyleRules> {
  const eslintRules: string[] = [];
  const tsconfigRules: string[] = [];

  try {
    const eslintContent = await gh.getFileAtRef("eslint.config.js", "HEAD");
    if (eslintContent) {
      const strict = extractQuotedRules(eslintContent, ["no-explicit-any", "no-console", "no-unsafe-call", "prefer-const"]);
      eslintRules.push(...strict);
    }
  } catch (e: unknown) {
    await telemetry?.decision("style-aligner", "eslint-fetch-failed", { error: e instanceof Error ? e.message : String(e) });
  }

  try {
    const tsconfigContent = await gh.getFileAtRef("tsconfig.json", "HEAD");
    if (tsconfigContent) {
      const parsed = JSON.parse(tsconfigContent) as { compilerOptions?: Record<string, unknown> };
      const opts = parsed.compilerOptions || {};
      if (opts.strict === true) tsconfigRules.push("strict: true");
      if (opts.noImplicitAny === true) tsconfigRules.push("noImplicitAny: true");
      if (opts.noImplicitReturns === true) tsconfigRules.push("noImplicitReturns: true");
      if (opts.noUncheckedIndexedAccess === true) tsconfigRules.push("noUncheckedIndexedAccess: true");
    }
  } catch (e: unknown) {
    await telemetry?.decision("style-aligner", "tsconfig-fetch-failed", { error: e instanceof Error ? e.message : String(e) });
  }

  await telemetry?.decision("style-aligner", "rules-extracted", {
    eslintRules: eslintRules.length,
    tsconfigRules: tsconfigRules.length,
  });

  return { eslintRules, tsconfigRules };
}

function extractQuotedRules(content: string, candidates: string[]): string[] {
  return candidates.filter((rule) => content.includes(rule));
}

export function formatStylePrompt(rules: StyleRules): string {
  const parts: string[] = [];
  if (rules.eslintRules.length) {
    parts.push(`ESLint rules: ${rules.eslintRules.join(", ")}`);
  }
  if (rules.tsconfigRules.length) {
    parts.push(`tsconfig rules: ${rules.tsconfigRules.join(", ")}`);
  }
  if (!parts.length) return "";
  return `Strictly adhere to these organizational linting rules.\n${parts.join("\n")}`;
}
