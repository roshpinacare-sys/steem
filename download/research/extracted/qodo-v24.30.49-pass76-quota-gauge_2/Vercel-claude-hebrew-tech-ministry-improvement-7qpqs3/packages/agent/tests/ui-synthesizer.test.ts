/**
 * Regression tests for ui-synthesizer.ts
 * Focus: generated component paths must match the actual monorepo layout (Bug 17-C).
 */
import { describe, it, expect } from 'vitest';
import { runUiSynthesizer } from '../src/agents/ui-synthesizer.js';
import type { CoderOutput } from '../src/schemas/coder-schema.js';
import type { GitHubClient } from '../src/services/github-client.js';

describe('ui-synthesizer — component path target (Bug 17-C regression)', () => {
  it('commits generated components to apps/mission-control, not apps/web', async () => {
    const committedFiles: Array<{ path: string; content: string }> = [];
    const fakeGh = {
      commitViaGitDB: async (_pr: number, files: Array<{ path: string; content: string }>) => {
        committedFiles.push(...files);
        return { commitSha: 'abc123' };
      },
    } as unknown as GitHubClient;

    const patch: CoderOutput = {
      diff: '',
      files: [
        {
          path: 'packages/agent/src/services/users.ts',
          content: `
            export const getUsers = api.get('/api/users', async () => { return []; });
            export const createUser = api.post('/api/users', async (body) => { return body; });
          `,
        },
      ],
    };

    const components = await runUiSynthesizer(patch, fakeGh, 1, undefined);

    expect(components.length).toBeGreaterThan(0);
    expect(committedFiles.length).toBe(components.length);

    for (const { path } of components) {
      expect(path.startsWith('apps/mission-control/src/components/')).toBe(true);
      expect(path.endsWith('.tsx')).toBe(true);
      expect(path).not.toContain('apps/web');
    }

    expect(committedFiles[0].path.startsWith('apps/mission-control/src/components/')).toBe(true);
  });
});
