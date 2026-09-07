/**
 * agentIdentity.test.js — V102
 * Unit tests for lib/agentIdentity.js
 *
 * Covers:
 *   - init() generates a UUID and persists it
 *   - init() is idempotent (same ID on second call)
 *   - getAgentId() returns the initialized ID
 *   - getAgentId() throws before init()
 *   - _reset() + re-init re-loads persisted ID from file
 *
 * Run: npx vitest run tests/agentIdentity.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Fresh require each test via _reset()
let agentIdentity;
const IDENTITY_FILE_PATH = path.resolve(
  new URL('..', import.meta.url).pathname,
  '.agent-identity.json'
);

function freshLoad() {
  // Clear module from cache so _agentId state resets
  const modPath = require.resolve('../lib/agentIdentity');
  delete require.cache[modPath];
  agentIdentity = require('../lib/agentIdentity');
}

beforeEach(() => {
  // Remove persisted file before each test for isolation
  try { fs.unlinkSync(IDENTITY_FILE_PATH); } catch (_) {}
  freshLoad();
});

afterEach(() => {
  // Clean up
  try { fs.unlinkSync(IDENTITY_FILE_PATH); } catch (_) {}
});

describe('AgentIdentity — V102', () => {
  it('init() resolves to a valid UUID v4', async () => {
    const id = await agentIdentity.init(null);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('init() persists identity to .agent-identity.json', async () => {
    const id = await agentIdentity.init(null);
    expect(fs.existsSync(IDENTITY_FILE_PATH)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(IDENTITY_FILE_PATH, 'utf8'));
    expect(saved.agentId).toBe(id);
  });

  it('init() is idempotent — returns same ID on second call', async () => {
    const id1 = await agentIdentity.init(null);
    const id2 = await agentIdentity.init(null);
    expect(id1).toBe(id2);
  });

  it('getAgentId() returns the initialized ID', async () => {
    const id = await agentIdentity.init(null);
    expect(agentIdentity.getAgentId()).toBe(id);
  });

  it('getAgentId() throws before init()', () => {
    // Module freshly loaded — _agentId is null
    expect(() => agentIdentity.getAgentId()).toThrow('[agentIdentity] getAgentId() called before init()');
  });

  it('re-init after module reload re-reads persisted ID from file', async () => {
    const id1 = await agentIdentity.init(null);

    // Reload module (simulates server restart)
    freshLoad();
    const id2 = await agentIdentity.init(null);

    expect(id2).toBe(id1);
  });

  it('IDENTITY_FILE export points to .agent-identity.json', () => {
    expect(agentIdentity.IDENTITY_FILE).toMatch(/\.agent-identity\.json$/);
  });
});
