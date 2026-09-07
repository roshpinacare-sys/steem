/**
 * Unit tests for janitor.ts
 * Focus: single shared ts-morph Project across files regression (Bug 16-B).
 */
import { describe, it, expect } from 'vitest';
import { runJanitor } from '../src/agents/janitor.js';

// Minimal stubs — janitor.test only exercises runJanitor (the scan path).
const fakeGh = {} as import('../src/services/github-client.js').GitHubClient;

describe('runJanitor — shared Project across files (Bug 16-B regression)', () => {
  it('does not throw when processing many files that share the same variable names', async () => {
    // Before the fix, a new ts-morph Project was created inside the per-file
    // loop. With many files this caused O(N) heavyweight language-service
    // instantiations. The shared-Project fix must still produce correct results.
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/module${i}.ts`,
      // Each file declares a local `value` — identical across files.
      content: `export function compute${i}(input: string): string {\n  const value = input.trim();\n  return value;\n}\n`,
    }));

    await expect(runJanitor(fakeGh, 'owner', 'repo', files)).resolves.not.toThrow();
  });

  it('correctly identifies long functions even when a shared Project is reused', async () => {
    // Generate a function that spans more than 200 lines.
    const longBody = Array.from({ length: 210 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const files = [
      { path: 'src/long.ts', content: `export function longFn(x: string): void {\n${longBody}\n}\n` },
      { path: 'src/short.ts', content: `export function shortFn(x: string): void {\n  return;\n}\n` },
    ];

    const findings = await runJanitor(fakeGh, 'owner', 'repo', files);
    const longFindings = findings.filter((f) => f.type === 'long-function' && f.path === 'src/long.ts');
    expect(longFindings.length).toBeGreaterThan(0);
    // The short function must NOT be flagged.
    const shortFindings = findings.filter((f) => f.type === 'long-function' && f.path === 'src/short.ts');
    expect(shortFindings.length).toBe(0);
  });
});
