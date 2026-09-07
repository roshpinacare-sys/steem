/**
 * Regression test for the edge-test executor stream handling (Bug 17-B).
 *
 * The executor lives in apps/mission-control and is heavy to render in the
 * agent test harness (React, WebContainer, etc.).  This test inspects the
 * source directly to verify the fix is in place. The logic moved from App.tsx
 * into the desktop shell's useMissionControl hook during the platform-shell
 * redesign; the regression guard follows it there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appPath = resolve(process.cwd(), '../..', 'apps/mission-control/src/shell/useMissionControl.ts');

describe('edge-test executor — awaits stdout stream (Bug 17-B regression)', () => {
  it('assigns and awaits the pipeTo promise before reading captured output', () => {
    const src = readFileSync(appPath, 'utf8');

    // The function must capture the pipeTo promise rather than fire-and-forget.
    expect(src).toMatch(/const streamDone\s*=\s*proc\.output\.pipeTo\(/);

    // It must await process exit AND await stream completion before using
    // the captured output buffer.
    expect(src).toMatch(/const exitCode\s*=\s*await proc\.exit;\s*await streamDone;/);

  });
});
