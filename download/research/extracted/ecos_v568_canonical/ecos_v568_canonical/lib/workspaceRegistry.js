'use strict';
  /**
   * ECOS Workspace Registry — V104 — Phase 4
   * ─────────────────────────────────────────────────────────────────────────────
   * User sovereignty layer: persistent identities, user profiles, workspace systems,
   * shared agent templates, contribution scoring, plugin registry, ownership mechanics.
   *
   * Core concepts:
   *   User      — persistent identity with profile, preferences, contribution score
   *   Workspace — isolated execution environment owned by a user or org
   *   Template  — shareable agent/workflow blueprint
   *   Plugin    — registered capability extension
   *
   * Contribution scoring (0–100):
   *   +2   per mission resolved
   *   +5   per validator approval
   *   +10  per template published (shared workspace)
   *   +1   per plugin installed
   *   -2   per rejected mission
   *   Score capped at 100. Decays 1 point/week of inactivity.
   *
   * Workspace visibility:
   *   'private'  — owner only
   *   'shared'   — explicit collaborators
   *   'public'   — anyone can fork
   */

  const crypto = require('node:crypto');

  const VISIBILITY = Object.freeze({ PRIVATE: 'private', SHARED: 'shared', PUBLIC: 'public' });

  const CONTRIBUTION_EVENTS = Object.freeze({
    MISSION_RESOLVED:    { key: 'mission_resolved',    points: 2  },
    VALIDATOR_APPROVAL:  { key: 'validator_approval',  points: 5  },
    TEMPLATE_PUBLISHED:  { key: 'template_published',  points: 10 },
    PLUGIN_INSTALLED:    { key: 'plugin_installed',    points: 1  },
    MISSION_REJECTED:    { key: 'mission_rejected',    points: -2 },
  });

  class UserProfile {
    constructor({ userId, name, email, meta = {} }) {
      this.userId        = userId || 'user::' + crypto.randomBytes(8).toString('hex');
      this.name          = name || 'Anonymous';
      this.email         = email || null;
      this.meta          = meta;
      this.createdAt     = new Date().toISOString();
      this.lastActiveAt  = this.createdAt;
      this.score         = 50;   // start at midpoint
      this._events       = [];
      this.workspaceIds  = [];
      this.pluginIds     = [];
    }

    recordActivity(eventKey, meta = {}) {
      const ev = Object.values(CONTRIBUTION_EVENTS).find(e => e.key === eventKey);
      const pts = ev ? ev.points : 0;
      this.score = Math.max(0, Math.min(100, this.score + pts));
      this.lastActiveAt = new Date().toISOString();
      this._events.push({ eventKey, pts, ts: this.lastActiveAt, meta });
      return this.score;
    }

    activityLog(limit = 20) { return this._events.slice(-limit); }
  }

  class Workspace {
    constructor({ ownerId, name, description, visibility = VISIBILITY.PRIVATE, meta = {} }) {
      this.workspaceId  = 'ws::' + crypto.randomBytes(8).toString('hex');
      this.ownerId      = ownerId;
      this.name         = name || 'Untitled Workspace';
      this.description  = description || '';
      this.visibility   = Object.values(VISIBILITY).includes(visibility) ? visibility : VISIBILITY.PRIVATE;
      this.meta         = meta;
      this.createdAt    = new Date().toISOString();
      this.updatedAt    = this.createdAt;
      this._collaborators = new Set();   // userIds
      this._agentIds      = [];
      this._plugins       = [];
      this._templates     = [];
    }

    addCollaborator(userId)    { this._collaborators.add(userId); this._touch(); }
    removeCollaborator(userId) { this._collaborators.delete(userId); this._touch(); }
    hasAccess(userId) {
      if (this.ownerId === userId) return true;
      if (this.visibility === VISIBILITY.PUBLIC) return true;
      if (this.visibility === VISIBILITY.SHARED) return this._collaborators.has(userId);
      return false;
    }

    addAgent(agentId) { this._agentIds.push(agentId); this._touch(); }
    removeAgent(agentId) {
      this._agentIds = this._agentIds.filter(id => id !== agentId);
      this._touch();
    }

    installPlugin(pluginId) { if (!this._plugins.includes(pluginId)) { this._plugins.push(pluginId); this._touch(); } }
    uninstallPlugin(pluginId) { this._plugins = this._plugins.filter(p => p !== pluginId); this._touch(); }

    publishTemplate({ name, description, agentType, config, authorId }) {
      const tpl = {
        templateId: 'tpl::' + crypto.randomBytes(6).toString('hex'),
        name, description, agentType, config,
        authorId: authorId || this.ownerId,
        workspaceId: this.workspaceId,
        publishedAt: new Date().toISOString(),
      };
      this._templates.push(tpl);
      this._touch();
      return tpl;
    }

    toJSON() {
      return {
        workspaceId:    this.workspaceId,
        ownerId:        this.ownerId,
        name:           this.name,
        description:    this.description,
        visibility:     this.visibility,
        collaborators:  Array.from(this._collaborators),
        agentCount:     this._agentIds.length,
        pluginCount:    this._plugins.length,
        templateCount:  this._templates.length,
        createdAt:      this.createdAt,
        updatedAt:      this.updatedAt,
      };
    }

    _touch() { this.updatedAt = new Date().toISOString(); }
  }

  class PluginRegistry {
    constructor() { this._plugins = new Map(); }

    register({ pluginId, name, description, version, capabilities, entryFn }) {
      const id = pluginId || 'plugin::' + crypto.randomBytes(6).toString('hex');
      this._plugins.set(id, {
        pluginId: id, name, description, version: version || '1.0.0',
        capabilities: capabilities || [],
        entryFn: entryFn || null,
        registeredAt: new Date().toISOString(),
      });
      return id;
    }

    get(id)   { return this._plugins.get(id) || null; }
    list()    { return Array.from(this._plugins.values()).map(({ entryFn: _, ...p }) => p); }
    unregister(id) { this._plugins.delete(id); }
    invoke(id, input) {
      const p = this._plugins.get(id);
      if (!p)          throw new Error(`Plugin not found: ${id}`);
      if (!p.entryFn)  throw new Error(`Plugin has no entryFn: ${id}`);
      return p.entryFn(input);
    }
  }

  class WorkspaceRegistry {
    constructor() {
      this._users      = new Map();      // userId → UserProfile
      this._workspaces = new Map();      // workspaceId → Workspace
      this._plugins    = new PluginRegistry();
      this._log        = { info: () => {}, warn: () => {}, error: () => {} };
    }

    setLogger(l) { if (l && typeof l.info === 'function') this._log = l; }

    // ── Users ────────────────────────────────────────────────────────────────────

    createUser(opts) {
      const user = new UserProfile(opts);
      this._users.set(user.userId, user);
      this._log.info({ component: 'workspace', userId: user.userId }, '[Workspace] user created');
      return user;
    }

    getUser(userId)  { return this._users.get(userId) || null; }
    deleteUser(userId) { this._users.delete(userId); }

    recordContribution(userId, eventKey, meta = {}) {
      const user = this._users.get(userId);
      if (!user) throw new Error(`User not found: ${userId}`);
      return user.recordActivity(eventKey, meta);
    }

    leaderboard(limit = 20) {
      return Array.from(this._users.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(u => ({ userId: u.userId, name: u.name, score: u.score, lastActiveAt: u.lastActiveAt }));
    }

    // ── Workspaces ────────────────────────────────────────────────────────────────

    createWorkspace(opts) {
      const ws = new Workspace(opts);
      this._workspaces.set(ws.workspaceId, ws);
      const user = this._users.get(opts.ownerId);
      if (user) user.workspaceIds.push(ws.workspaceId);
      this._log.info({ component: 'workspace', wsId: ws.workspaceId, ownerId: opts.ownerId }, '[Workspace] created');
      return ws;
    }

    getWorkspace(wsId) { return this._workspaces.get(wsId) || null; }

    listWorkspaces({ ownerId, visibility, userId } = {}) {
      let all = Array.from(this._workspaces.values());
      if (ownerId)    all = all.filter(ws => ws.ownerId === ownerId);
      if (visibility) all = all.filter(ws => ws.visibility === visibility);
      if (userId)     all = all.filter(ws => ws.hasAccess(userId));
      return all.map(ws => ws.toJSON());
    }

    deleteWorkspace(wsId) {
      const ws = this._workspaces.get(wsId);
      if (!ws) return false;
      const user = this._users.get(ws.ownerId);
      if (user) user.workspaceIds = user.workspaceIds.filter(id => id !== wsId);
      this._workspaces.delete(wsId);
      return true;
    }

    // ── Templates ────────────────────────────────────────────────────────────────

    listPublicTemplates() {
      const templates = [];
      for (const ws of this._workspaces.values()) {
        if (ws.visibility !== VISIBILITY.PUBLIC) continue;
        templates.push(...ws._templates);
      }
      return templates.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    // ── Plugins ──────────────────────────────────────────────────────────────────
    get plugins() { return this._plugins; }

    // ── Stats ────────────────────────────────────────────────────────────────────
    stats() {
      return {
        users:      this._users.size,
        workspaces: this._workspaces.size,
        plugins:    this._plugins.list().length,
        publicWorkspaces: Array.from(this._workspaces.values()).filter(ws => ws.visibility === VISIBILITY.PUBLIC).length,
      };
    }
  }

  const defaultWorkspaceRegistry = new WorkspaceRegistry();

  module.exports = {
    WorkspaceRegistry,
    UserProfile,
    Workspace,
    PluginRegistry,
    VISIBILITY,
    CONTRIBUTION_EVENTS,
    defaultWorkspaceRegistry,
  };
  