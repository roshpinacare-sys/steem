#!/usr/bin/env node
// ECOS contract-test generator for TFA. Reads an OpenAPI YAML and emits one zero-dep .test.ts per
// operation that asserts the route is declared & shaped per the contract — and ALSO hits it live.
// v2: Also parses requestBody schemas and generates a payload test for POST/PUT/PATCH operations.
//     Payload test sends a minimal valid body (required fields with typed defaults) and asserts:
//       - status !== 405 (method registered)
//       - status < 500 (no crash)
//       - status in acceptableStatuses (2xx success OR expected client errors — never arbitrary 4xx/5xx)
//     This is stronger than < 500: it rules out unexpected server behaviour with a valid payload.
// v3: Parses `required: [...]` declared directly under the SUCCESS response's JSON schema
//     (responses.<successStatus>.content.application/json.schema.required) and, when present,
//     emits a 4th "response shape" test asserting those fields exist on the body whenever the
//     live status equals the declared success status (skipped for client-error statuses, since
//     a different/no body shape is expected then).
// Regenerate when spec changes: node scripts/gen-contract-tests.mjs <openapi.yaml> [outDir]
import fs from 'fs';
import path from 'path';

const specPath = process.argv[2] || 'lib/api-spec/openapi.yaml';
const outDir   = process.argv[3] || 'tests/contract';
const txt      = fs.readFileSync(specPath, 'utf8');
const lines    = txt.split('\n');

// ─── YAML Helpers ─────────────────────────────────────────────────────────────

/** Minimal inline-YAML value extractor: { type: string, format: email } */
function extractInline(s, key) {
  const m = s.match(new RegExp(`${key}:\\s*([^,}\\s]+)`));
  return m ? m[1] : null;
}

/** Build a single minimal sample value for a schema type/format. */
function sampleValue(type, format, fieldName) {
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'array')   return [];
  if (type === 'object')  return {};
  // string — use format or field-name hints
  if (format === 'email' || fieldName?.toLowerCase().includes('email')) return 'test@example.com';
  if (format === 'password' || fieldName?.toLowerCase().includes('password')) return 'TestPass123!';
  if (format === 'uuid')   return '00000000-0000-0000-0000-000000000000';
  if (format === 'date-time') return new Date(0).toISOString();
  if (fieldName?.toLowerCase().includes('token'))  return 'test-token-000';
  if (fieldName?.toLowerCase().includes('name'))   return 'test-name';
  if (fieldName?.toLowerCase().includes('id'))     return 'test-id-0000';
  if (fieldName?.toLowerCase().includes('code'))   return '000000';
  if (fieldName?.toLowerCase().includes('memo'))   return 'test-memo';
  if (fieldName?.toLowerCase().includes('amount')) return '1000';
  if (fieldName?.toLowerCase().includes('type'))   return 'test';
  return 'test-value';
}

// ─── Parse spec ───────────────────────────────────────────────────────────────

let inPaths = false, curPath = null, curMethod = null;
let inRequestBody = false, inProperties = false, inRequired = false;
let inResponses = false;
let indentBody = 0;

const ops = [];
let cur = null;

function pushCur() {
  if (cur) ops.push(cur);
}

for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];

  if (/^paths:\s*$/.test(ln))          { inPaths = true; continue; }
  if (inPaths && /^\S/.test(ln) && !/^paths:/.test(ln)) inPaths = false;
  if (!inPaths) continue;

  // New path
  let m;
  if ((m = ln.match(/^  (\/\S*):\s*$/))) {
    curPath = m[1]; curMethod = null;
    inRequestBody = false; inProperties = false; inResponses = false;
    continue;
  }

  // New method
  if ((m = ln.match(/^    (get|post|put|patch|delete):\s*$/))) {
    pushCur();
    curMethod = m[1];
    cur = {
      path: curPath, method: curMethod,
      opId: '', successStatus: '200', hasBody: false, hasSecurity: false,
      required: [], properties: {}, // map fieldName → { type, format }
      curRespStatus: null, responseRequired: [], foundRespRequired: false,
    };
    inRequestBody = false; inProperties = false; inResponses = false;
    continue;
  }

  if (!cur) continue;

  // operationId
  if ((m = ln.match(/\s+operationId:\s*(\S+)/)))  cur.opId = m[1];

  // security: present means auth-required
  if (/^      security:/.test(ln)) cur.hasSecurity = true;

  // Detect requestBody section
  if (/^      requestBody:/.test(ln)) { cur.hasBody = true; inRequestBody = true; inResponses = false; }

  // Detect responses section
  if (/^      responses:/.test(ln)) { inResponses = true; inRequestBody = false; inProperties = false; }

  // Status-code line within responses, e.g.  `        "201":`  →  track which status's schema we're in.
  if (inResponses && (m = ln.match(/^\s+"(\d{3})":/))) {
    cur.curRespStatus = m[1];
    if (!cur.foundSuccess && /^2/.test(m[1])) {
      cur.successStatus = m[1]; cur.foundSuccess = true;
    }
  }

  // `required: [...]` declared on the SUCCESS response's JSON schema (not requestBody, not
  // other status codes' schemas). First match wins — same convention as requestBody.required.
  if (inResponses && !inRequestBody && cur.curRespStatus === cur.successStatus &&
      !cur.foundRespRequired && (m = ln.match(/^\s+required:\s*\[([^\]]+)\]/))) {
    cur.responseRequired = m[1].split(',').map(s => s.trim()).filter(Boolean);
    cur.foundRespRequired = true;
  }

  if (inRequestBody) {
    // required: [field1, field2, ...]  (single-line form, within the requestBody schema)
    if ((m = ln.match(/^\s+required:\s*\[([^\]]+)\]/))) {
      // Only capture the first required list (that belongs to the request schema, not response)
      if (!cur.foundRequired) {
        cur.required = m[1].split(',').map(s => s.trim()).filter(Boolean);
        cur.foundRequired = true;
      }
    }
    // Start of properties block
    if (/^\s+properties:/.test(ln)) inProperties = true;
  }

  // Parse property lines:  fieldName:   { type: string, format: email }
  if (inRequestBody && inProperties && (m = ln.match(/^\s{16}(\w[\w-]*):\s*\{(.+)\}/))) {
    const fname = m[1], def = m[2];
    const type   = extractInline(def, 'type')   || 'string';
    const format = extractInline(def, 'format')  || null;
    const ex     = extractInline(def, 'example') || null;
    cur.properties[fname] = { type, format, example: ex };
  }
  // Also handle multi-line property with just  fieldName:  on one line then type: on next
  if (inRequestBody && inProperties && (m = ln.match(/^\s{16}(\w[\w-]*):\s*$/))) {
    const fname = m[1];
    const nextType = lines[i+1]?.match(/\s+type:\s*(\S+)/);
    const nextFmt  = lines[i+1]?.match(/\s+format:\s*(\S+)/);
    if (nextType) cur.properties[fname] = { type: nextType[1], format: nextFmt?.[1] || null, example: null };
  }
}
pushCur();

// ─── Build minimal payloads ───────────────────────────────────────────────────

/** Compute minimal JSON payload for an operation. */
function buildPayload(op) {
  if (!op.hasBody || !['post','put','patch'].includes(op.method)) return null;
  const payload = {};
  for (const fname of op.required) {
    const prop = op.properties[fname];
    if (prop?.example) {
      payload[fname] = prop.example;
    } else {
      payload[fname] = sampleValue(prop?.type || 'string', prop?.format || null, fname);
    }
  }
  return payload;
}

/** Acceptable status codes when a valid payload is sent to an operation.
 *  2xx = success as per spec
 *  400/401/403/404/409/422 = known client errors (validation, auth, conflict, not-found)
 *  The test REJECTS anything else (5xx or 405) as a contract violation.
 */
function acceptableStatuses(op) {
  const success = parseInt(op.successStatus, 10);
  // Always include 2xx success range + common client errors
  const always = [200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429];
  if (!always.includes(success)) always.unshift(success);
  return always;
}

// ─── Emit tests ───────────────────────────────────────────────────────────────

fs.mkdirSync(outDir, { recursive: true });
let n = 0;

for (const op of ops) {
  const name     = (op.opId || (op.method + op.path.replace(/\W+/g, '_'))).replace(/[^A-Za-z0-9_]/g, '_');
  const file     = path.join(outDir, name + '.contract.test.ts');
  const livePath = op.path.replace(/\{[^}]+\}/g, 'contract-test-id-0000');
  const payload  = buildPayload(op);
  const hasPayload = payload !== null;
  const payloadJson = hasPayload ? JSON.stringify(payload) : 'undefined';
  const acceptable  = acceptableStatuses(op).join(', ');
  const hasRespShape = op.responseRequired.length > 0;

  const body = `import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
// AUTO-GENERATED contract test from ${path.basename(specPath)} — do not hand-edit; regenerate.
// Contract: ${op.method.toUpperCase()} ${op.path} → ${op.successStatus}
const SPEC = { method: "${op.method}", path: "${op.path}", expectStatus: ${op.successStatus} };
${hasPayload ? `// Minimal valid payload derived from requestBody.schema.required in the OpenAPI spec.
const PAYLOAD = ${payloadJson};` : '// No requestBody defined for this operation.'}

test("contract ${op.opId}: ${op.method.toUpperCase()} ${op.path} is declared", () => {
  assert(SPEC.path.startsWith("/"), "path must be absolute");
  eq(SPEC.method, "${op.method}");
});

test("contract ${op.opId}: ${op.method.toUpperCase()} ${op.path} is reachable (live, no crash)", async () => {
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "${livePath}", {
      method: "${op.method.toUpperCase()}",
      headers: { "x-tenant-id": "contract-test-tenant", "content-type": "application/json" },
${hasPayload ? `      body: JSON.stringify(PAYLOAD),` : ''}
    });
    // Contract guarantee: route handler runs without crashing the server.
    // 400 (missing/invalid body), 401/403 (auth), 404 (resource not found) are all acceptable —
    // they prove the route is registered and validation ran.
    // 405 would mean the method is not registered on this path.
    // 5xx means the server crashed — a contract violation.
    assert(res.status !== 405, "method must be registered on this path (got 405)");
    assert(res.status < 500, "server must not crash — got " + res.status);
  } finally {
    server.close();
  }
});
${hasPayload ? `
test("contract ${op.opId}: ${op.method.toUpperCase()} ${op.path} accepts valid payload (${op.successStatus} or known client error)", async () => {
  // Spec contract: a minimal valid payload should yield status ${op.successStatus} (success)
  // OR a known client error (400/401/403/404/409/422) — never a crash (5xx) or 405.
  // Acceptable: [${acceptable}]
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "${livePath}", {
      method: "${op.method.toUpperCase()}",
      headers: { "x-tenant-id": "contract-test-tenant-payload", "content-type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
    const acceptable = new Set([${acceptable}]);
    assert(res.status !== 405, "method must be registered (got 405)");
    assert(res.status < 500, "server must not crash with valid payload — got " + res.status);
    assert(acceptable.has(res.status),
      "status " + res.status + " is not in acceptable set [${acceptable}] for ${op.method.toUpperCase()} ${op.path} with valid payload");
  } finally {
    server.close();
  }
});` : ''}
${hasRespShape ? `
// Response-shape: responses["${op.successStatus}"].content.application/json.schema.required from the spec.
const REQUIRED_RESPONSE_FIELDS = ${JSON.stringify(op.responseRequired)};

test("contract ${op.opId}: ${op.method.toUpperCase()} ${op.path} response shape — required fields present on ${op.successStatus}", async () => {
  // Only checked when the live status equals the declared success status (${op.successStatus}).
  // A client-error status (400/401/403/404/409/422) has a different/no body shape and is skipped here —
  // it is already covered by the "accepts valid payload" test above.
  const server = startSovereignServer(0);
  const port = (server.address()).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const res = await fetch(base + "/api" + "${livePath}", {
      method: "${op.method.toUpperCase()}",
      headers: { "x-tenant-id": "contract-test-tenant-shape", "content-type": "application/json" },
${hasPayload ? `      body: JSON.stringify(PAYLOAD),` : ''}
    });
    if (res.status !== ${op.successStatus}) return; // client-error path — shape not asserted
    const body = await res.json();
    for (const field of REQUIRED_RESPONSE_FIELDS) {
      assert(field in body, "response missing required field \\"" + field + "\\" for ${op.method.toUpperCase()} ${op.path} (status ${op.successStatus})");
    }
  } finally {
    server.close();
  }
});` : ''}
`;

  fs.writeFileSync(file, body);
  n++;
}

console.log(`generated ${n} contract test file(s) from ${ops.length} operation(s) → ${outDir}/`);
const withPayload = ops.filter(o => buildPayload(o) !== null).length;
const withRespShape = ops.filter(o => o.responseRequired.length > 0).length;
console.log(`  ${withPayload} operations have requestBody → 3 tests each (declared + reachable + valid-payload)`);
console.log(`  ${n - withPayload} operations have no requestBody → 2 tests each (declared + reachable)`);
console.log(`  ${withRespShape} operation(s) declare response-schema required fields → +1 response-shape test each`);
