// ============================================================
// ECOS V225 — Phase P112–P119 — Server Patch
// Adds the "Lovable-class" orchestration surface on top of V224.
//
//   P112 — POST /llm/chat                  (LLM gateway, multi-provider, streamable)
//   P113 — POST /files/:projectId/{read|write|line-replace|list|search|delete}
//   P114 — POST /sandbox/:projectId/exec   (allow-listed, streaming)
//   P115 — POST /agent/chat                (tool-calling loop, sessions ring)
//          GET  /agent/sessions/:sessionId
//          GET  /agent/sessions
//   P116 — GET  /templates                 (list of starters)
//          GET  /templates/:name           (manifest)
//   P117 — POST /preview/:projectId/log    (console/network feedback ingest)
//          GET  /preview/:projectId/logs
//   P118 — POST /memory/:scope/:scopeId/:key (set)
//          GET  /memory/:scope/:scopeId/:key (get)
//          DEL  /memory/:scope/:scopeId/:key (del)
//          GET  /memory/:scope/:scopeId      (list)
//   P119 — POST /publish/:projectId        (build → static output dir)
//          GET  /admin/summary-v225
//
// R2: all new identifiers end in 225. R3: zero new npm deps; uses
// Node built-ins + global fetch (Node >=18). R6: V220–V224 endpoints
// untouched. Sacred files untouched.
// ============================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { createLlmGateway225 } = require('./src/lib/llmGateway225');
const { createFileTools225 }  = require('./src/lib/fileTools225');
const { createSandboxExec225 } = require('./src/lib/sandboxExec225');
const { runAgentLoop225 }     = require('./src/lib/agentLoop225');
const {
  createSession225, getSession225, appendMessage225, bumpStep225,
  setStatus225, listSessions225, _agentSessions225,
} = require('./src/lib/sessionStore225');
const {
  setMemory225, getMemory225, delMemory225, listMemory225,
} = require('./src/lib/memoryStore225');

const WORKSPACES_ROOT_DEFAULT_225 = path.join(os.tmpdir(), 'ecos-workspaces-225');
const PREVIEW_LOG_RING_MAX_225 = 1000;
const _previewLogs225 = new Map();        // projectId -> ring
const _projectWorkspaces225 = new Map();  // projectId -> abs path

function _projectRoot225(projectId, workspacesRoot) {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('V225: invalid projectId (alnum, _-, 1..64)');
  }
  const root = path.resolve(workspacesRoot, projectId);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  _projectWorkspaces225.set(projectId, root);
  return root;
}

function _err225(res, code, msg, extra) {
  return res.status(code).json({ ok: false, error: msg, code: 'V225_ERROR', ecosVersion: 'V225', ...(extra || {}) });
}

// ─── T01: POST /llm/chat ────────────────────────────────────────────────────
function registerLlmChatEndpoint225(app, gateway) {
  app.post('/llm/chat', async (req, res) => {
    try {
      const body = req.body || {};
      const r = await gateway.chat({
        provider: body.provider || 'mock',
        model: body.model,
        messages: body.messages,
        tools: body.tools,
        temperature: body.temperature,
        stream: false,
        timeout: body.timeout,
      });
      return res.status(r.ok ? 200 : 502).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 500, e.message); }
  });
}

// ─── T02: File tool endpoints ───────────────────────────────────────────────
function _ft225(req, workspacesRoot, sacredPaths, _eventLog181) {
  const projectId = req.params.projectId;
  const root = _projectRoot225(projectId, workspacesRoot);
  return createFileTools225({ workspaceRoot: root, sacredPaths, _eventLog181 });
}

function registerFileToolEndpoints225(app, opts) {
  const workspacesRoot = opts.workspacesRoot;
  const sacredPaths    = opts.sacredPaths || [];
  const _eventLog181   = opts._eventLog181;

  app.post('/files/:projectId/read', (req, res) => {
    try { return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).readFile((req.body || {}).path) ), ecosVersion: 'V225' }); }
    catch (e) { return _err225(res, 400, e.message); }
  });
  app.post('/files/:projectId/write', (req, res) => {
    try {
      const b = req.body || {};
      return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).writeFile(b.path, b.content) ), ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.post('/files/:projectId/line-replace', (req, res) => {
    try {
      const b = req.body || {};
      return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).lineReplace(b.path, b) ), ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.post('/files/:projectId/list', (req, res) => {
    try { return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).listDir((req.body || {}).path || '.') ), ecosVersion: 'V225' }); }
    catch (e) { return _err225(res, 400, e.message); }
  });
  app.post('/files/:projectId/search', (req, res) => {
    try {
      const b = req.body || {};
      return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).search(b.query, b) ), ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.post('/files/:projectId/delete', (req, res) => {
    try { return res.status(200).json({ ...( _ft225(req, workspacesRoot, sacredPaths, _eventLog181).deleteFile((req.body || {}).path) ), ecosVersion: 'V225' }); }
    catch (e) { return _err225(res, 400, e.message); }
  });
}

// ─── T03: Sandbox exec ──────────────────────────────────────────────────────
function registerSandboxEndpoint225(app, opts) {
  const workspacesRoot = opts.workspacesRoot;
  const _eventLog181   = opts._eventLog181;
  const sandboxOpts    = opts.sandbox || {};

  app.post('/sandbox/:projectId/exec', async (req, res) => {
    try {
      const b = req.body || {};
      const root = _projectRoot225(req.params.projectId, workspacesRoot);
      const sb = createSandboxExec225({ workspaceRoot: root, _eventLog181, ...sandboxOpts });
      const r = await sb.exec(b.cmd, { timeoutMs: b.timeoutMs, cwd: b.cwd });
      return res.status(200).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
}

// ─── T04: Agent loop endpoints ──────────────────────────────────────────────
function _buildDefaultTools225(projectId, opts) {
  const root = _projectRoot225(projectId, opts.workspacesRoot);
  const tools = createFileTools225({ workspaceRoot: root, sacredPaths: opts.sacredPaths || [], _eventLog181: opts._eventLog181 });
  const sb = createSandboxExec225({ workspaceRoot: root, _eventLog181: opts._eventLog181, ...(opts.sandbox || {}) });
  return [
    { name: 'read_file', description: 'Read a UTF-8 file by relative path.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async ({ args }) => tools.readFile(args.path) },
    { name: 'write_file', description: 'Write a UTF-8 file by relative path.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async ({ args }) => tools.writeFile(args.path, args.content) },
    { name: 'line_replace', description: 'Replace a contiguous range of lines.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, firstLine: { type: 'integer' }, lastLine: { type: 'integer' }, oldContent: { type: 'string' }, newContent: { type: 'string' } }, required: ['path', 'firstLine', 'lastLine'] },
      run: async ({ args }) => tools.lineReplace(args.path, args) },
    { name: 'list_dir', description: 'List a directory.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      run: async ({ args }) => tools.listDir(args.path) },
    { name: 'search', description: 'Substring or regex search across files.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' }, path: { type: 'string' } }, required: ['query'] },
      run: async ({ args }) => tools.search(args.query, args) },
    { name: 'delete_file', description: 'Delete a file or directory.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async ({ args }) => tools.deleteFile(args.path) },
    { name: 'exec', description: 'Run an allow-listed shell command in the project workspace.',
      parameters: { type: 'object', properties: { cmd: { type: 'string' }, timeoutMs: { type: 'integer' } }, required: ['cmd'] },
      run: async ({ args }) => sb.exec(args.cmd, { timeoutMs: args.timeoutMs }) },
  ];
}

function registerAgentEndpoints225(app, opts) {
  const gateway = opts.gateway;

  app.post('/agent/chat', async (req, res) => {
    try {
      const b = req.body || {};
      const projectId = b.projectId || 'default';
      let sess;
      if (b.sessionId) sess = getSession225(b.sessionId) || createSession225({ id: b.sessionId, meta: { projectId } });
      else             sess = createSession225({ meta: { projectId } });
      setStatus225(sess.id, 'running');
      if (b.userMessage) appendMessage225(sess.id, { role: 'user', content: String(b.userMessage) });
      const tools = Array.isArray(b.toolNames) && b.toolNames.length > 0
        ? _buildDefaultTools225(projectId, opts).filter(t => b.toolNames.includes(t.name))
        : _buildDefaultTools225(projectId, opts);
      const result = await runAgentLoop225({
        gateway,
        provider: b.provider || 'mock',
        model: b.model,
        system: b.system,
        messages: sess.messages,
        tools,
        maxSteps: b.maxSteps,
        ctx: { projectId },
      });
      if (result.ok && result.output) appendMessage225(sess.id, { role: 'assistant', content: result.output });
      for (let i = 0; i < (result.steps || 0); i++) bumpStep225(sess.id);
      setStatus225(sess.id, result.ok ? 'idle' : 'error');
      return res.status(200).json({ ...result, sessionId: sess.id, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 500, e.message); }
  });

  app.get('/agent/sessions/:sessionId', (req, res) => {
    const s = getSession225(req.params.sessionId);
    if (!s) return _err225(res, 404, 'session not found');
    return res.status(200).json({ ok: true, session: s, ecosVersion: 'V225' });
  });

  app.get('/agent/sessions', (req, res) => {
    const limit = parseInt((req.query && req.query.limit) || (req.params && req.params.limit), 10);
    return res.status(200).json({ ok: true, sessions: listSessions225(Number.isFinite(limit) ? limit : 100), ecosVersion: 'V225' });
  });
}

// ─── T05: Templates ─────────────────────────────────────────────────────────
const TEMPLATES_225 = [
  { name: 'vite-react-shadcn', title: 'Vite + React 19 + Tailwind v4 + shadcn/ui', stack: ['vite', 'react', 'tailwind', 'shadcn'], path: 'templates/vite-react-shadcn' },
];
function registerTemplateEndpoints225(app) {
  app.get('/templates', (req, res) => res.status(200).json({ ok: true, templates: TEMPLATES_225, ecosVersion: 'V225' }));
  app.get('/templates/:name', (req, res) => {
    const t = TEMPLATES_225.find(x => x.name === req.params.name);
    if (!t) return _err225(res, 404, 'template not found');
    return res.status(200).json({ ok: true, template: t, ecosVersion: 'V225' });
  });
}

// ─── T06: Preview log ingestion ─────────────────────────────────────────────
function registerPreviewEndpoints225(app) {
  app.post('/preview/:projectId/log', (req, res) => {
    const pid = req.params.projectId;
    const b = req.body || {};
    if (!b || typeof b.type !== 'string') return _err225(res, 400, 'type required');
    if (!_previewLogs225.has(pid)) _previewLogs225.set(pid, []);
    const ring = _previewLogs225.get(pid);
    ring.push({ ts: Date.now(), type: b.type, level: b.level || 'log', message: b.message || '', url: b.url || null, status: b.status || null });
    while (ring.length > PREVIEW_LOG_RING_MAX_225) ring.shift();
    return res.status(200).json({ ok: true, size: ring.length, ecosVersion: 'V225' });
  });
  app.get('/preview/:projectId/logs', (req, res) => {
    const ring = _previewLogs225.get(req.params.projectId) || [];
    return res.status(200).json({ ok: true, count: ring.length, logs: ring.slice(-200), ecosVersion: 'V225' });
  });
}

// ─── T07: Memory ────────────────────────────────────────────────────────────
function registerMemoryEndpoints225(app) {
  app.post('/memory/:scope/:scopeId/:key', (req, res) => {
    try {
      const b = req.body || {};
      const r = setMemory225({ scope: req.params.scope, scopeId: req.params.scopeId, key: req.params.key, value: b.value, type: b.type || 'preference' });
      return res.status(r.ok ? 200 : 400).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.get('/memory/:scope/:scopeId/:key', (req, res) => {
    try {
      const r = getMemory225({ scope: req.params.scope, scopeId: req.params.scopeId, key: req.params.key });
      return res.status(r.ok ? 200 : 404).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.delete && app.delete('/memory/:scope/:scopeId/:key', (req, res) => {
    try {
      const r = delMemory225({ scope: req.params.scope, scopeId: req.params.scopeId, key: req.params.key });
      return res.status(200).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
  app.get('/memory/:scope/:scopeId', (req, res) => {
    try {
      const r = listMemory225({ scope: req.params.scope, scopeId: req.params.scopeId, type: req.query && req.query.type });
      return res.status(200).json({ ...r, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 400, e.message); }
  });
}

// ─── T08: Publish (stub: build via sandbox + copy dist) ─────────────────────
function registerPublishEndpoint225(app, opts) {
  const workspacesRoot = opts.workspacesRoot;
  const _eventLog181   = opts._eventLog181;
  const publishRoot    = opts.publishRoot || path.join(os.tmpdir(), 'ecos-publish-225');
  if (!fs.existsSync(publishRoot)) fs.mkdirSync(publishRoot, { recursive: true });

  app.post('/publish/:projectId', async (req, res) => {
    try {
      const pid = req.params.projectId;
      const root = _projectRoot225(pid, workspacesRoot);
      const b = req.body || {};
      const buildCmd = b.buildCmd || 'true';
      const distDir  = b.distDir || 'dist';
      const sb = createSandboxExec225({ workspaceRoot: root, _eventLog181, ...(opts.sandbox || {}) });
      const r = await sb.exec(buildCmd, { timeoutMs: b.timeoutMs });
      if (!r.ok) return res.status(200).json({ ok: false, step: 'build', ...r, ecosVersion: 'V225' });
      const src = path.resolve(root, distDir);
      const dst = path.join(publishRoot, pid);
      if (fs.existsSync(src)) {
        fs.rmSync(dst, { recursive: true, force: true });
        fs.cpSync(src, dst, { recursive: true });
      }
      return res.status(200).json({ ok: true, projectId: pid, published: fs.existsSync(src), dst, ecosVersion: 'V225' });
    } catch (e) { return _err225(res, 500, e.message); }
  });
}

// ─── Tz: Admin Summary V225 ─────────────────────────────────────────────────
function registerAdminSummaryV225Endpoint225(app, gateway) {
  app.get('/admin/summary-v225', (req, res) => {
    return res.status(200).json({
      version: '225.0.0',
      phase: 'P112-P119',
      v225: {
        llm_chat_endpoint:      true,
        file_tool_endpoints:    true,
        sandbox_exec_endpoint:  true,
        agent_chat_endpoint:    true,
        templates_endpoint:     true,
        preview_log_endpoint:   true,
        memory_endpoints:       true,
        publish_endpoint:       true,
        providers:              gateway ? gateway.listProviders() : [],
        sessions_size:          _agentSessions225.size,
        preview_projects:       _previewLogs225.size,
        workspaces_size:        _projectWorkspaces225.size,
      },
    });
  });
}

// ─── Registration helper ─────────────────────────────────────────────────────
function registerV225Endpoints(app, stores) {
  const opts = stores || {};
  const workspacesRoot = opts.workspacesRoot || WORKSPACES_ROOT_DEFAULT_225;
  if (!fs.existsSync(workspacesRoot)) fs.mkdirSync(workspacesRoot, { recursive: true });
  const _eventLog181 = Array.isArray(opts._eventLog181) ? opts._eventLog181 : [];
  const gateway = opts.gateway || createLlmGateway225({ fetchImpl: opts.fetchImpl });
  const sacredPaths = Array.isArray(opts.sacredPaths) ? opts.sacredPaths : [];
  const sandbox = opts.sandbox || {};

  registerLlmChatEndpoint225(app, gateway);
  registerFileToolEndpoints225(app, { workspacesRoot, sacredPaths, _eventLog181 });
  registerSandboxEndpoint225(app, { workspacesRoot, _eventLog181, sandbox });
  registerAgentEndpoints225(app, { gateway, workspacesRoot, sacredPaths, _eventLog181, sandbox });
  registerTemplateEndpoints225(app);
  registerPreviewEndpoints225(app);
  registerMemoryEndpoints225(app);
  registerPublishEndpoint225(app, { workspacesRoot, _eventLog181, sandbox, publishRoot: opts.publishRoot });
  registerAdminSummaryV225Endpoint225(app, gateway);

  return { gateway, workspacesRoot, _eventLog181 };
}

{
  // [V226] export unconditionally so the server can wire the patch in production too
  module.exports = {
    WORKSPACES_ROOT_DEFAULT_225,
    PREVIEW_LOG_RING_MAX_225,
    TEMPLATES_225,
    _previewLogs225,
    _projectWorkspaces225,
    _projectRoot225,
    _buildDefaultTools225,
    registerV225Endpoints,
    registerLlmChatEndpoint225,
    registerFileToolEndpoints225,
    registerSandboxEndpoint225,
    registerAgentEndpoints225,
    registerTemplateEndpoints225,
    registerPreviewEndpoints225,
    registerMemoryEndpoints225,
    registerPublishEndpoint225,
    registerAdminSummaryV225Endpoint225,
  };
}
