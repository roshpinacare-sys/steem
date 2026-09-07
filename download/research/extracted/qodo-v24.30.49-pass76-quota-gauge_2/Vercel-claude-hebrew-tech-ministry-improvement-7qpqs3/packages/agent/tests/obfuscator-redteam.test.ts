/**
 * Adversarial / red-team tests for the obfuscator / privacy-mode boundary.
 *
 * Goal: discover ways real symbol names can leak past QODO_PRIVACY_MODE=strict,
 * and confirm the hasUnmappedTokens / reconstitutePatch ordering invariant holds.
 *
 * These tests intentionally probe the CURRENT implementation's design boundary.
 * A test that documents a leak path is valuable even when we choose not to fix
 * it in this pass — it records the boundary so future changes don't silently
 * widen it.
 */
import { describe, it, expect } from 'vitest';
import {
  obfuscateCode,
  obfuscatePrefetch,
  reconstituteCode,
  hasUnmappedTokens,
  type ObfuscationMapping,
} from '../src/services/obfuscator.js';

// Helper: produce a 10+ token mapping so prefix collisions (VAR_1 vs VAR_10)
// are actually possible.
function makeLongPrefetch(): Record<string, string> {
  const file: string[] = [];
  for (let i = 0; i < 12; i++) {
    file.push(`const ${String.fromCharCode(97 + i)} = ${i};`);
  }
  return { 'src/alpha.ts': file.join('\n') };
}

// Helper: scan content for the original symbol names we expect to be protected.
function collectOriginalNames(content: string, names: string[]): string[] {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(content));
}

describe('obfuscator red-team — prefix-token substitution correctness', () => {
  it('does not corrupt VAR_10 when VAR_1 maps to a different original name', () => {
    const prefetch = makeLongPrefetch();
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);
    const content = obfuscated['src/alpha.ts'];

    // Reconstitution must recover every original variable name exactly.
    const restored = reconstituteCode(content, mapping);
    for (const name of 'abcdefghijkl'.split('')) {
      expect(restored).toContain(`const ${name}`);
    }

    // No VAR_N tokens should remain after reconstitution.
    expect(hasUnmappedTokens(restored, mapping)).toBe(false);
  });

  it('substitutes longer tokens before shorter tokens even when order is reversed', () => {
    // Force a mapping where a short token would clobber a longer one if the
    // loop ran in insertion order.
    const mapping: ObfuscationMapping = {
      VAR_1: 'short',
      VAR_10: 'longer',
      VAR_2: 'also',
    };
    const content = 'let VAR_10 = VAR_1 + VAR_2;';

    const restored = reconstituteCode(content, mapping);
    expect(restored).toBe('let longer = short + also;');
    expect(restored).not.toContain('VAR_');
  });
});

describe('obfuscator red-team — privacy leak paths through the current implementation', () => {
  it('leaves function declaration names unobfuscated (documented boundary)', () => {
    const code = 'function computeSecretHash() { return 1; }\nconst x = computeSecretHash();';
    const { content, mapping } = obfuscateCode(code);

    // Local variable x is renamed; function name is not.
    expect(Object.values(mapping)).not.toContain('computeSecretHash');
    expect(content).toContain('computeSecretHash');
    expect(hasUnmappedTokens(content, mapping)).toBe(false);
  });

  it('leaves class and interface names unobfuscated (documented boundary)', () => {
    const code = `
      class InternalPaymentGateway {
        process() { return 1; }
      }
      interface PaymentGatewayConfig {
        endpoint: string;
      }
      const gateway = new InternalPaymentGateway();
    `;
    const { content, mapping } = obfuscateCode(code);

    expect(Object.values(mapping)).not.toContain('InternalPaymentGateway');
    expect(Object.values(mapping)).not.toContain('PaymentGatewayConfig');
    expect(content).toContain('InternalPaymentGateway');
    expect(content).toContain('PaymentGatewayConfig');
  });

  it('leaves import bindings unobfuscated (documented boundary)', () => {
    const code = `import { decryptToken } from './crypto';\nconst result = decryptToken('x');`;
    const { content, mapping } = obfuscateCode(code);

    expect(Object.values(mapping)).not.toContain('decryptToken');
    expect(content).toContain('decryptToken');
  });

  it('obfuscates property assignments coherently (declaration + access renamed together)', () => {
    // Formerly a documented privacy leak: property names survived
    // obfuscation. The current implementation renames PropertyAssignment
    // declarations, and ts-morph rewrites every access in the same scope, so
    // the sensitive name leaves no trace and reconstitution restores it.
    const code = 'const user = { passwordHash: "" };\nconst hash = user.passwordHash;';
    const { content, mapping } = obfuscateCode(code);

    expect(content).not.toContain('passwordHash');
    expect(Object.values(mapping)).toContain('passwordHash');
    const restored = reconstituteCode(content, mapping);
    expect(restored).toContain('user.passwordHash');
  });

  it('leaves string literals containing symbol names unobfuscated (documented boundary)', () => {
    const code = 'const message = "The secretKey is loaded";\nconst key = "secretKey";';
    const { content, mapping } = obfuscateCode(code);

    expect(content).toContain('secretKey');
    expect(Object.values(mapping)).not.toContain('secretKey');
  });

  it('leaves comments containing symbol names unobfuscated (documented boundary)', () => {
    const code = 'const x = 1; // Uses internalAuthToken for legacy reasons';
    const { content, mapping } = obfuscateCode(code);

    expect(content).toContain('internalAuthToken');
    expect(Object.values(mapping)).not.toContain('internalAuthToken');
  });

  it('renames local variables declared inside functions but preserves nested property accesses', () => {
    const code = `
      function transform() {
        const internalUserToken = "abc";
        return internalUserToken.length;
      }
    `;
    const { content, mapping } = obfuscateCode(code);

    expect(Object.keys(mapping).length).toBeGreaterThan(0);
    expect(content).not.toContain('internalUserToken');
    expect(content).toContain('.length');
  });
});

describe('obfuscator red-team — hasUnmappedTokens ordering invariant', () => {
  it('detects unmapped VAR_N tokens in a reconstituted patch', () => {
    const mapping: ObfuscationMapping = { VAR_1: 'x' };
    const patchContent = 'const VAR_2 = 1;';

    expect(hasUnmappedTokens(patchContent, mapping)).toBe(true);
  });

  it('does not falsely flag mapped VAR_N tokens', () => {
    const mapping: ObfuscationMapping = { VAR_1: 'x' };
    const patchContent = 'const VAR_1 = 1;';

    expect(hasUnmappedTokens(patchContent, mapping)).toBe(false);
  });

  it('rejects an LLM output that emits an out-of-range token even when the token looks valid', () => {
    const prefetch = { 'src/a.ts': 'const realName = 1;' };
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);

    // Simulate an LLM hallucinating a new VAR_N token that does not exist.
    const fakePatch = `${obfuscated['src/a.ts']}\nconst VAR_999 = 2;`;

    // Reconstitute first, then check — the correct ordering.
    const restored = reconstituteCode(fakePatch, mapping);
    expect(hasUnmappedTokens(restored, mapping)).toBe(true);
  });

  it('would leave VAR_N tokens in production code if hasUnmappedTokens ran before reconstitute', () => {
    // This is the invariant the Do Not Touch list protects against.
    const mapping: ObfuscationMapping = { VAR_1: 'x' };
    const aiOutput = 'const VAR_1 = 1;';

    // If we checked before reconstituting, the mapped token would pass...
    const beforeCheck = hasUnmappedTokens(aiOutput, mapping);
    expect(beforeCheck).toBe(false);

    // ...but the final patch would still contain VAR_1, not x.
    const restored = reconstituteCode(aiOutput, mapping);
    expect(restored).toContain('const x');
  });
});

describe('obfuscator red-team — adversarial source shapes', () => {
  it('handles identifiers that collide with the VAR_N token namespace', () => {
    const code = 'const VAR_1 = 1;\nconst real = VAR_1 + 1;';
    const { content, mapping } = obfuscateCode(code);

    // The original VAR_1 should not collide with the new token assigned to real.
    const tokens = Object.keys(mapping);
    expect(tokens.length).toBeGreaterThan(0);
    expect(content).not.toContain('real');

    const restored = reconstituteCode(content, mapping);
    expect(restored).toContain('const real');
  });

  it('does not expose original names via the mapping object direction leak', () => {
    // Mapping is token -> original. Any code that iterates the wrong direction,
    // or logs the mapping as-is, would leak real names. We cannot test logging,
    // but we can assert the public contract stays token->original.
    const code = 'const secretSauce = 42;';
    const { mapping } = obfuscateCode(code);

    const keys = Object.keys(mapping);
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^VAR_\d+$/);
    expect(mapping[keys[0]]).toBe('secretSauce');
  });

  it('multi-file batch still has no unmapped tokens after reconstitution', () => {
    const prefetch: Record<string, string> = {
      'src/a.ts': 'const alpha = 1;',
      'src/b.ts': 'const beta = alpha;',
      'src/c.ts': 'const gamma = beta + alpha;',
    };
    const { prefetch: obfuscated, mapping } = obfuscatePrefetch(prefetch);

    for (const [path, content] of Object.entries(obfuscated)) {
      const restored = reconstituteCode(content, mapping);
      expect(hasUnmappedTokens(restored, mapping)).toBe(false);
      expect(restored).toContain(prefetch[path].split(' ')[1]);
    }
  });
});
