'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'ecos-api-server.js');
let s = fs.readFileSync(serverPath, 'utf8');
function replaceOnce(find, replace, label) {
  if (!s.includes(find)) throw new Error('Missing target: ' + label);
  s = s.replace(find, replace);
}

replaceOnce(
"const offlineInference                  = require('./lib/offlineInference');\n",
"const offlineInference                  = require('./lib/offlineInference');\n// [V114-P10-07] Compliance Proxy service.\nconst { ComplianceProxy, verifyProxyApiKey } = require('./lib/complianceProxy');\n",
'compliance proxy import');

replaceOnce(
"offlineInference.setLogger(logger.child({ component: 'inference' }));\n",
"offlineInference.setLogger(logger.child({ component: 'inference' }));\n// [V114-P10-07] Compliance Proxy singleton.\nconst complianceProxy = new ComplianceProxy({\n  offlineInference,\n  confidenceGate: evaluateConfidenceGateStrict,\n  hitlGate,\n  auditLog,\n  logger: logger.child({ component: 'compliance-proxy' }),\n});\n",
'compliance proxy singleton');

// Prefer x-forwarded-for in V114 tests/production proxy deployments.
s = s.replace(/const ip = req\.socket\?\.remoteAddress \|\| req\.headers\['x-forwarded-for'\] \|\| 'unknown';/g,
  "const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';");

const insertBefore = "// ─── [V84] ValidatorHub (WebSocket) — optional, graceful degradation ─────────";
const proxyRoutes = `\n  // ── [V114-P10-07] Compliance Proxy — protected by ECOS_PROXY_API_KEY if set ───\n  app.post('/api/v1/proxy/complete', async (req, res) => {\n    try {\n      const auth = verifyProxyApiKey(req);\n      if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });\n\n      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';\n      const limited = complianceProxyLimiter.check(ip);\n      res.setHeader('X-RateLimit-Limit', 60);\n      res.setHeader('X-RateLimit-Remaining', limited.allowed ? limited.remaining : 0);\n      res.setHeader('X-RateLimit-Reset', Math.ceil(limited.resetAt.getTime() / 1000));\n      if (!limited.allowed) return res.status(429).json({ ok: false, error: 'Rate limit exceeded — max 60 proxy calls/min', retryAfter: 60 });\n\n      const result = await complianceProxy.handle(req.body || {});\n      res.status(result.statusCode || 200).json(result);\n    } catch (err) {\n      logger.error({ err: err.message }, '[V114] compliance proxy complete error');\n      res.status(500).json({ ok: false, error: err.message });\n    }\n  });\n\n  app.get('/api/v1/proxy/stats', (req, res) => {\n    const auth = verifyProxyApiKey(req);\n    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });\n    res.json(complianceProxy.stats());\n  });\n\n  app.get('/api/v1/proxy/config', (req, res) => {\n    const auth = verifyProxyApiKey(req);\n    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });\n    res.json(complianceProxy.config());\n  });\n\n`;
replaceOnce(insertBefore, proxyRoutes + insertBefore, 'insert proxy routes');

fs.writeFileSync(serverPath, s);

const openapiPath = path.join(root, 'docs', 'openapi.json');
const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
spec.tags = spec.tags || [];
if (!spec.tags.some(t => t.name === 'proxy')) spec.tags.push({ name: 'proxy', description: 'ECOS V114 compliance proxy and audit wrapper' });
spec.paths = spec.paths || {};
spec.paths['/api/v1/proxy/complete'] = { post: { tags: ['proxy'], summary: 'Execute an AI completion through ECOS compliance controls', security: [{ ProxyApiKey: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['userPrompt'], properties: { userPrompt: { type: 'string' }, systemPrompt: { type: 'string' }, clientAccountId: { type: 'string' }, priceUsd: { type: 'string' }, taskType: { type: 'string' }, context: { type: 'object' }, metadata: { type: 'object' } } } } } }, responses: { '200': { description: 'AUTO_FLOW or HITL_QUEUE result with PROXY_CALL audit metadata' }, '401': { description: 'Missing or invalid proxy API key' }, '429': { description: 'Rate limit exceeded' } } } };
spec.paths['/api/v1/proxy/stats'] = { get: { tags: ['proxy'], summary: 'Compliance proxy usage statistics', security: [{ ProxyApiKey: [] }], responses: { '200': { description: 'Usage summary' }, '401': { description: 'Missing or invalid proxy API key' } } } };
spec.paths['/api/v1/proxy/config'] = { get: { tags: ['proxy'], summary: 'Compliance proxy policy and auth configuration', security: [{ ProxyApiKey: [] }], responses: { '200': { description: 'Policy configuration' }, '401': { description: 'Missing or invalid proxy API key' } } } };
spec.components = spec.components || {};
spec.components.securitySchemes = spec.components.securitySchemes || {};
spec.components.securitySchemes.ProxyApiKey = { type: 'apiKey', in: 'header', name: 'X-API-Key' };
fs.writeFileSync(openapiPath, JSON.stringify(spec, null, 2) + '\n');

console.log('V114 Track B server patch applied');
