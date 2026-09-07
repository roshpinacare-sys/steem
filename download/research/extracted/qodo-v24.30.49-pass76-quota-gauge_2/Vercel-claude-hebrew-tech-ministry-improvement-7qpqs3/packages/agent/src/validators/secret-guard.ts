import type { CoderOutput } from "../schemas/coder-schema.js";

export class SecretGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretGuardError";
  }
}

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "GitHub personal access token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: "generic secret key (sk-...)", regex: /sk-[a-zA-Z0-9]{32,}/g },
  { name: "JSON Web Token", regex: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g },
  { name: "AWS access key ID", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS secret access key", regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g },
  // Added per audit finding 2.3 — these are the most common tokens the
  // original five patterns missed.
  { name: "Stripe secret/restricted key", regex: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { name: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Slack webhook URL", regex: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/g },
  { name: "SendGrid API key", regex: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { name: "Twilio API key/SID", regex: /(?:AC|SK)[a-f0-9]{32}/g },
  { name: "Google API key", regex: /AIza[A-Za-z0-9_-]{35}/g },
  { name: "PEM private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

function detectSecrets(content: string): { name: string; match: string }[] {
  const found: { name: string; match: string }[] = [];
  for (const { name, regex } of PATTERNS) {
    const matches = content.match(regex);
    if (matches) {
      for (const match of matches) {
        found.push({ name, match });
      }
    }
  }
  return found;
}

/**
 * Scans a generated patch for hardcoded secrets using deterministic regex
 * patterns. Throws SecretGuardError if any are found so the Coder can retry
 * with a prompt to use process.env.
 *
 * KNOWN LIMITATION (audit finding 2.3): this is literal-string regex
 * matching against the raw file content. It does not catch secrets that are
 * split across concatenated string literals (`"sk-" + "abc123..."`),
 * base64/hex-encoded, built via template interpolation, or assembled at
 * runtime from character codes. Treat this as a fast first-pass net, not a
 * complete defense — pair it with `red-team.ts` running adversarial bypass
 * attempts against this exact function, and with a secret-scanning step in
 * CI (e.g. gitleaks/trufflehog) that runs entropy analysis on the final
 * diff, not just pattern matching.
 */
export function secretGuard(patch: CoderOutput): void {
  const violations: string[] = [];
  for (const file of patch.files) {
    const secrets = detectSecrets(file.content);
    for (const s of secrets) {
      violations.push(`${file.path}: ${s.name} (${s.match.slice(0, 12)}...)`);
    }
  }
  if (violations.length) {
    throw new SecretGuardError(`Hardcoded secret detected. You must use process.env.\n${violations.join("\n")}`);
  }
}
