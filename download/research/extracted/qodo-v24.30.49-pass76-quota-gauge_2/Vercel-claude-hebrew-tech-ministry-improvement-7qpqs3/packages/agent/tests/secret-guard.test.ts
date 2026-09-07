/**
 * Regression tests for secret-guard.ts (audit finding 2.3).
 * This validator had zero test coverage before this pass.
 */
import { describe, it, expect } from 'vitest';
import { secretGuard, SecretGuardError } from '../src/validators/secret-guard.js';
import type { CoderOutput } from '../src/schemas/coder-schema.js';

function patchWith(content: string): CoderOutput {
  return { diff: '', files: [{ path: 'src/example.ts', content }] };
}

describe('secretGuard — original five patterns still work', () => {
  it('flags a GitHub PAT', () => {
    expect(() => secretGuard(patchWith('const t = "ghp_' + 'a'.repeat(36) + '";'))).toThrow(SecretGuardError);
  });

  it('allows clean code with no secrets', () => {
    expect(() => secretGuard(patchWith('const t = process.env.GITHUB_TOKEN;'))).not.toThrow();
  });
});

describe('secretGuard — newly added patterns (previously missed)', () => {
  it('flags a Stripe live secret key', () => {
    expect(() => secretGuard(patchWith('const k = "sk_live_' + 'a1B2c3D4e5F6g7H8'.repeat(2) + '";'))).toThrow(
      SecretGuardError,
    );
  });

  it('flags a Slack bot token', () => {
    expect(() => secretGuard(patchWith('const t = "xoxb-123456789012-abcdefghijklmnop";'))).toThrow(
      SecretGuardError,
    );
  });

  it('flags a Slack incoming webhook URL', () => {
    expect(() =>
      secretGuard(patchWith('fetch("https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX");')),
    ).toThrow(SecretGuardError);
  });

  it('flags a SendGrid API key', () => {
    expect(() =>
      secretGuard(patchWith('const k = "SG.' + 'abcdefghijklmnop'.repeat(1) + '.' + 'qrstuvwxyz123456'.repeat(1) + '";')),
    ).toThrow(SecretGuardError);
  });

  it('flags a Google API key', () => {
    expect(() => secretGuard(patchWith('const k = "AIza' + 'A'.repeat(35) + '";'))).toThrow(SecretGuardError);
  });

  it('flags a PEM private key block', () => {
    expect(() => secretGuard(patchWith('const pem = `-----BEGIN RSA PRIVATE KEY-----\\nMIIB...\\n`;'))).toThrow(
      SecretGuardError,
    );
  });
});

describe('secretGuard — documented bypass (does NOT catch, by design limitation)', () => {
  it('does not catch a key split across concatenated string literals', () => {
    // This is the exact bypass called out in the audit. Asserting it here
    // so the limitation is visible in test output, not just a code comment,
    // and so a future entropy/CI-based scanner has a concrete case to beat.
    const content = 'const k = "sk_live_" + "' + 'a1B2c3D4e5F6g7H8'.repeat(2) + '";';
    expect(() => secretGuard(patchWith(content))).not.toThrow();
  });
});
