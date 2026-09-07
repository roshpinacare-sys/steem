import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowService } from './workflow-service.js';

const moduleRoot = resolve(process.cwd());
const staticRoot = join(moduleRoot, 'web');
const port = Number.parseInt(process.env.PORT ?? '4319', 10);
const dataRoot = process.env.V19_DATA_ROOT ?? join(moduleRoot, 'evidence', 'web-runtime');
const service = new WorkflowService(dataRoot);

export function createApplicationServer(workflowService: WorkflowService) {
  return createServer(async (request, response) => {
    try {
      await route(workflowService, request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message });
    }
  });
}

export const server = createApplicationServer(service);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(JSON.stringify({ status: 'listening', url: `http://127.0.0.1:${port}`, dataRoot }) + '\n');
  });
}

async function route(service: WorkflowService, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, service.health());
  if (request.method === 'GET' && url.pathname === '/api/operations') return sendJson(response, 200, service.operations());
  if (request.method === 'GET' && url.pathname === '/api/demo-fixture') return sendJson(response, 200, service.fixture());
  if (request.method === 'POST' && url.pathname === '/api/sessions/intake') {
    const body = await readJson(request);
    if (!isJsonObject(body)) throw new Error('intake_body_must_be_object');
    return sendJson(response, 201, await service.intake(body));
  }
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{24})(?:\/(execute|review|rollback))?$/);
  if (sessionMatch !== null) {
    const sessionId = sessionMatch[1];
    if (sessionId === undefined) throw new Error('session_id_missing');
    const action = sessionMatch[2];
    if (request.method === 'GET' && action === undefined) return sendJson(response, 200, service.get(sessionId));
    if (request.method === 'POST' && action === 'execute') return sendJson(response, 200, await service.execute(sessionId));
    if (request.method === 'POST' && action === 'review') {
      const body = await readJson(request) as { reviewerId?: string };
      return sendJson(response, 200, service.review(sessionId, body.reviewerId ?? 'reviewer-1'));
    }
    if (request.method === 'POST' && action === 'rollback') return sendJson(response, 200, service.rollback(sessionId));
  }
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
  return serveStatic(url.pathname, response);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256_000) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new Error('invalid_json'); }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const filename = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!['index.html', 'app.js', 'styles.css'].includes(filename)) return sendJson(response, 404, { error: 'not_found' });
  const content = readFileSync(join(staticRoot, filename));
  const type = extname(filename) === '.html' ? 'text/html; charset=utf-8' : extname(filename) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
  response.writeHead(200, {
    'content-type': type,
    'content-length': content.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(content);
}
