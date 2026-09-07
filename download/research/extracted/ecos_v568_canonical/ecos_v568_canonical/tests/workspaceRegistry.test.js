/**
   * ECOS Workspace Registry Tests — V104
   * 14 tests: UserProfile, Workspace, PluginRegistry, WorkspaceRegistry, leaderboard
   */
  import { describe, it, expect } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('WorkspaceRegistry — V104', () => {
    const { WorkspaceRegistry, VISIBILITY, CONTRIBUTION_EVENTS } = require('../lib/workspaceRegistry');

    it('createUser() returns user with default score 50', () => {
      const reg = new WorkspaceRegistry();
      const u = reg.createUser({ name: 'Alice' });
      expect(u.userId).toMatch(/^user::/);
      expect(u.score).toBe(50);
      expect(u.name).toBe('Alice');
    });

    it('recordContribution() increases score on positive event', () => {
      const reg = new WorkspaceRegistry();
      const u = reg.createUser({ name: 'Bob' });
      const prev = u.score;
      reg.recordContribution(u.userId, CONTRIBUTION_EVENTS.VALIDATOR_APPROVAL.key);
      expect(u.score).toBe(prev + CONTRIBUTION_EVENTS.VALIDATOR_APPROVAL.points);
    });

    it('recordContribution() decreases score on negative event', () => {
      const reg = new WorkspaceRegistry();
      const u = reg.createUser({ name: 'Carol' });
      const prev = u.score;
      reg.recordContribution(u.userId, CONTRIBUTION_EVENTS.MISSION_REJECTED.key);
      expect(u.score).toBe(prev + CONTRIBUTION_EVENTS.MISSION_REJECTED.points);
    });

    it('score is capped at 100', () => {
      const reg = new WorkspaceRegistry();
      const u = reg.createUser({ name: 'Max' });
      for (let i = 0; i < 30; i++) {
        reg.recordContribution(u.userId, CONTRIBUTION_EVENTS.TEMPLATE_PUBLISHED.key);
      }
      expect(u.score).toBeLessThanOrEqual(100);
    });

    it('score does not go below 0', () => {
      const reg = new WorkspaceRegistry();
      const u = reg.createUser({ name: 'Min' });
      for (let i = 0; i < 100; i++) {
        reg.recordContribution(u.userId, CONTRIBUTION_EVENTS.MISSION_REJECTED.key);
      }
      expect(u.score).toBeGreaterThanOrEqual(0);
    });

    it('leaderboard() returns users sorted by score', () => {
      const reg = new WorkspaceRegistry();
      const a = reg.createUser({ name: 'A' });
      const b = reg.createUser({ name: 'B' });
      for (let i = 0; i < 5; i++) reg.recordContribution(a.userId, CONTRIBUTION_EVENTS.VALIDATOR_APPROVAL.key);
      const lb = reg.leaderboard(10);
      expect(lb[0].userId).toBe(a.userId);
      expect(lb[0].score).toBeGreaterThan(lb[1]?.score ?? -1);
    });

    it('createWorkspace() returns workspace with workspaceId', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Owner' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, name: 'My WS' });
      expect(ws.workspaceId).toMatch(/^ws::/);
      expect(ws.ownerId).toBe(u.userId);
    });

    it('workspace.hasAccess() — owner always has access', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Owner' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.PRIVATE });
      expect(ws.hasAccess(u.userId)).toBe(true);
      expect(ws.hasAccess('stranger')).toBe(false);
    });

    it('workspace.hasAccess() — public workspace is open', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Pub' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.PUBLIC });
      expect(ws.hasAccess('anyone')).toBe(true);
    });

    it('workspace.addCollaborator() grants shared access', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Collab' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.SHARED });
      ws.addCollaborator('friend-id');
      expect(ws.hasAccess('friend-id')).toBe(true);
      ws.removeCollaborator('friend-id');
      expect(ws.hasAccess('friend-id')).toBe(false);
    });

    it('workspace.publishTemplate() adds template', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'TplAuthor' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.PUBLIC });
      const tpl = ws.publishTemplate({ name: 'Research Agent', agentType: 'research', config: {} });
      expect(tpl.templateId).toMatch(/^tpl::/);
      expect(tpl.name).toBe('Research Agent');
    });

    it('listPublicTemplates() returns published templates', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Pub2' });
      const ws  = reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.PUBLIC });
      ws.publishTemplate({ name: 'T1', agentType: 'worker', config: {} });
      ws.publishTemplate({ name: 'T2', agentType: 'planner', config: {} });
      const templates = reg.listPublicTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(2);
    });

    it('plugins.register() + list() + invoke() works', () => {
      const reg = new WorkspaceRegistry();
      const id  = reg.plugins.register({
        name: 'test-plugin', version: '1.0.0',
        capabilities: ['compute'],
        entryFn: (input) => ({ doubled: input.value * 2 }),
      });
      expect(id).toMatch(/^plugin::/);
      const list = reg.plugins.list();
      expect(list.some(p => p.pluginId === id)).toBe(true);
      const out = reg.plugins.invoke(id, { value: 21 });
      expect(out.doubled).toBe(42);
    });

    it('stats() returns correct counts', () => {
      const reg = new WorkspaceRegistry();
      const u   = reg.createUser({ name: 'Stats' });
      reg.createWorkspace({ ownerId: u.userId });
      reg.createWorkspace({ ownerId: u.userId, visibility: VISIBILITY.PUBLIC });
      const s = reg.stats();
      expect(s.users).toBe(1);
      expect(s.workspaces).toBe(2);
      expect(s.publicWorkspaces).toBe(1);
    });
  });
  