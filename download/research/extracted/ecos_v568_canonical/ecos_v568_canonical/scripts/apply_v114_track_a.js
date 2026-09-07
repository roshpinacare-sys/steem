'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'ecos-api-server.js');
let s = fs.readFileSync(serverPath, 'utf8');

function replaceOnce(find, replace, label) {
  if (!s.includes(find)) throw new Error(`Missing target: ${label}`);
  s = s.replace(find, replace);
}

replaceOnce(
`const chatLimiter    = new RateLimiter(60_000, 30);
const depositLimiter = new RateLimiter(60_000, 10);
const taskLimiter    = new RateLimiter(60_000, 30);
const batchLimiter   = new RateLimiter(60_000,  5);
`,
`const chatLimiter      = new RateLimiter(60_000, 30);
const depositLimiter   = new RateLimiter(60_000, 10);
const taskLimiter      = new RateLimiter(60_000, 30);
const batchLimiter     = new RateLimiter(60_000,  5);
// [V114-P10-01] Hardening for V113 endpoints.
const memoryCompactLimiter = new RateLimiter(60_000, 5);
const euAiActReportLimiter = new RateLimiter(60_000, 10);
// [V114-P10-07] Compliance Proxy main API surface.
const complianceProxyLimiter = new RateLimiter(60_000, 60);
`,
'rate limiter declarations');

replaceOnce(
`        (chatLimiter._store?.size    || 0) +
        (taskLimiter._store?.size    || 0) +
        (depositLimiter._store?.size || 0) +
        (batchLimiter._store?.size   || 0);
`,
`        (chatLimiter._store?.size           || 0) +
        (taskLimiter._store?.size           || 0) +
        (depositLimiter._store?.size        || 0) +
        (batchLimiter._store?.size          || 0) +
        (memoryCompactLimiter._store?.size  || 0) +
        (euAiActReportLimiter._store?.size  || 0) +
        (complianceProxyLimiter._store?.size || 0);
`,
'rate limiter health active key count');

replaceOnce(
`  // ── [V106] GET /api/v1/snapshot/list ─────────────────────────────────────────
  // List available snapshots (file-system backed).
  app.get('/api/v1/snapshot/list', async (req, res) => {
    try {
      const snapshots = await _v106.snapshotEngine.listSnapshots();
      res.json({ ok: true, count: snapshots.length, snapshots });
    } catch (err) {
      logger.error({ err: err.message }, '[V106] snapshot/list error');
      res.status(500).json({ ok: false, error: err.message });
    }
  });
`,
`  // ── [V114-P10-03] GET /api/v1/snapshot/list ───────────────────────────────────
  // List available snapshots from data/*.json and, when configured, Postgres.
  app.get('/api/v1/snapshot/list', async (req, res) => {
    try {
      const dataDir = path.resolve(__dirname, 'data');
      const snapshots = [];

      // File-backed snapshots: tolerate a missing data/ directory.
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir).filter(name => /^snapshot_.*\\.json$/.test(name));
        for (const filename of files) {
          const filePath = path.join(dataDir, filename);
          try {
            const st = fs.statSync(filePath);
            snapshots.push({
              id: filename,
              source: 'file',
              createdAt: st.mtime.toISOString(),
              sizeBytes: st.size,
            });
          } catch (_) {}
        }
      }

      // DB-backed snapshots: optional and non-fatal.
      if (dbPool) {
        try {
          const result = await dbPool.query(
            'SELECT id, created_at, size_bytes FROM snapshots ORDER BY created_at DESC LIMIT 50'
          );
          for (const row of result.rows || []) {
            const created = row.created_at ? new Date(row.created_at).toISOString() : null;
            snapshots.push({
              id: String(row.id),
              source: 'db',
              createdAt: created,
              sizeBytes: Number(row.size_bytes || 0),
            });
          }
        } catch (dbErr) {
          logger.warn({ err: dbErr.message }, '[V114-P10-03] snapshot/list DB path skipped');
        }
      }

      const byTimestamp = new Map();
      for (const snap of snapshots) {
        const key = snap.createdAt || snap.id;
        const existing = byTimestamp.get(key);
        if (!existing || (existing.source !== 'db' && snap.source === 'db')) byTimestamp.set(key, snap);
      }
      const merged = [...byTimestamp.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      res.json({ ok: true, snapshots: merged, total: merged.length });
    } catch (err) {
      logger.error({ err: err.message }, '[V114] snapshot/list error');
      res.status(500).json({ ok: false, error: err.message });
    }
  });
`,
'snapshot list endpoint');

replaceOnce(
`  app.post('/api/v1/memory/compact', (req, res) => {
    try {
`,
`  app.post('/api/v1/memory/compact', (req, res) => {
    try {
      const ip = req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      const { allowed, remaining, resetAt } = memoryCompactLimiter.check(ip);
      res.setHeader('X-RateLimit-Limit', 5);
      res.setHeader('X-RateLimit-Remaining', allowed ? remaining : 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt.getTime() / 1000));
      if (!allowed) return res.status(429).json({ ok: false, error: 'Rate limit exceeded — max 5 memory compact requests/min', retryAfter: 60 });

`,
'memory compact rate limit');

replaceOnce(
`  app.get('/api/v1/audit/eu-ai-act-report', (req, res) => {
    try {
      const now      = new Date().toISOString();
`,
`  app.get('/api/v1/audit/eu-ai-act-report', (req, res) => {
    try {
      const ip = req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      const { allowed, remaining, resetAt } = euAiActReportLimiter.check(ip);
      res.setHeader('X-RateLimit-Limit', 10);
      res.setHeader('X-RateLimit-Remaining', allowed ? remaining : 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt.getTime() / 1000));
      if (!allowed) return res.status(429).json({ ok: false, error: 'Rate limit exceeded — max 10 EU AI Act report requests/min', retryAfter: 60 });

      const now      = new Date().toISOString();
`,
'eu ai act rate limit');

replaceOnce(
`      res.json({
        ok:          true,
        generatedAt: now,
        version:     'V113',
        deadline:    '2026-08-02T00:00:00Z',
        daysRemaining: Math.max(0, Math.ceil((new Date('2026-08-02') - Date.now()) / 86_400_000)),
        regulation:  { name: 'EU AI Act', articles: ['Art.12 (Transparency & Logging)', 'Art.14 (Human Oversight)'], enforcement: '2026-08-02' },
        overallCompliant,
        coverage,
        auditChain:      { length: chainLength, intact: chainIntact, headHash: auditLog.head ? (auditLog.head()?.hash?.slice(0, 16) || null) : null, dbBacked: !!dbPool },
        humanOversight:  { hitlQueued, hitlResolved, autoFlow, blocked },
        confidenceGating: { autoThreshold: 0.70, hitlLow: 0.50, hitlHigh: 0.70, blockThreshold: 0.30 },
        recommendations,
      });
`,
`      const report = {
        ok:          true,
        generatedAt: now,
        version:     'V114',
        deadline:    '2026-08-02T00:00:00Z',
        daysRemaining: Math.max(0, Math.ceil((new Date('2026-08-02') - Date.now()) / 86_400_000)),
        regulation:  { name: 'EU AI Act', articles: ['Art.12 (Transparency & Logging)', 'Art.14 (Human Oversight)'], enforcement: '2026-08-02' },
        overallCompliant,
        coverage,
        auditChain:      { length: chainLength, intact: chainIntact, headHash: auditLog.head ? (auditLog.head()?.hash?.slice(0, 16) || null) : null, dbBacked: !!dbPool },
        humanOversight:  { hitlQueued, hitlResolved, autoFlow, blocked },
        confidenceGating: { autoThreshold: 0.70, hitlLow: 0.50, hitlHigh: 0.70, blockThreshold: 0.30 },
        recommendations,
      };

      if ((req.query && req.query.format) === 'pdf') {
        const lines = [];
        lines.push('# ECOS EU AI Act Compliance Report');
        lines.push('');
        lines.push('Date generated: ' + report.generatedAt);
        lines.push('Version: ' + report.version);
        lines.push('overallCompliant: ' + report.overallCompliant);
        lines.push('');
        lines.push('## Article checks');
        for (const [key, check] of Object.entries(report.coverage)) {
          const status = check.compliant ? 'PASS' : 'FAIL';
          lines.push('- ' + check.article + ' / ' + key + ': ' + status + ' — ' + check.detail);
        }
        lines.push('');
        lines.push('Generated by ECOS V114 — EU AI Act Art.12/14 Compliance Artifact');
        const filenameTs = now.replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="ecos-eu-ai-act-report-' + filenameTs + '.txt"');
        return res.end(lines.join('\\n'));
      }

      res.json(report);
`,
'eu ai act report object and text export');

fs.writeFileSync(serverPath, s);

// OpenAPI update.
const openapiPath = path.join(root, 'docs', 'openapi.json');
const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
spec.info = spec.info || {};
spec.info.version = '113.0.0';
spec.paths = spec.paths || {};
spec.paths['/api/v1/memory/compact'] = {
  post: {
    summary: 'Compact in-memory knowledge substrate',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { scope: { type: 'string' }, threshold: { type: 'number', minimum: 0, maximum: 1 } } } } } },
    responses: { '200': { description: 'Eviction summary' }, '429': { description: 'Rate limit exceeded' } }
  }
};
spec.paths['/api/v1/audit/eu-ai-act-report'] = {
  get: {
    summary: 'EU AI Act Article 12/14 compliance report',
    parameters: [{ name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['pdf'] }, description: 'When pdf, returns downloadable text/plain compliance artifact.' }],
    responses: { '200': { description: 'Compliance artifact' }, '429': { description: 'Rate limit exceeded' } }
  }
};
fs.writeFileSync(openapiPath, JSON.stringify(spec, null, 2) + '\n');

console.log('V114 Track A patch applied');
