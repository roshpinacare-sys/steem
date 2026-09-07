/**
 * Regression tests for edge-prefetch-channel.ts
 * Focus: Redis signaling channel alignment with telemetry-proxy.js (Bug 17-A).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const channelPath = resolve(process.cwd(), 'src/services/edge-prefetch-channel.ts');
const workerPath = resolve(process.cwd(), '../..', 'worker/telemetry-proxy.js');

describe('edge-prefetch-channel — Redis channel alignment (Bug 17-A regression)', () => {
  it('publishes prefetch offers on the same channel the worker SSE bridge polls', () => {
    const channelSrc = readFileSync(channelPath, 'utf8');
    const workerSrc = readFileSync(workerPath, 'utf8');

    // Extract the client-side channel constant.
    const clientMatch = channelSrc.match(/REDIS_CHANNEL\s*=\s*"([^"]+)"/);
    expect(clientMatch).toBeTruthy();
    const clientChannel = clientMatch![1];

    // The worker must reference the same channel in its prefetch-signals SSE
    // endpoint. The worker source uses a KEY_PREFIX template literal, so we
    // assert on the literal pattern and then verify the resolved channel name.
    expect(workerSrc).toContain('const KEY_PREFIX = "qodo:v24:"');
    expect(workerSrc).toContain('["lrange", `${KEY_PREFIX}prefetch:signals`, 0, 49]');
    // Bug 18-A fix: all Redis keys live under the qodo:v24: namespace.
    expect(clientChannel).toBe('qodo:v24:prefetch:signals');
    // Also make sure it is not the old mismatched name.
    expect(clientChannel).not.toBe('qodo:prefetch:req');
  });
});
