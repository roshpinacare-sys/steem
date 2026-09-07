import { readFileSync, writeFileSync } from 'node:fs';
const [endpoint, requestPath, outputPath] = process.argv.slice(2);
if (!endpoint || !requestPath || !outputPath) throw new Error('usage:endpoint requestPath outputPath');
const envelope = JSON.parse(readFileSync(requestPath, 'utf8'));
let result;
try {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/distributed-lease/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope), redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  result = { transportOk: true, status: response.status, body: JSON.parse(await response.text()) };
} catch (error) {
  result = { transportOk: false, error: error instanceof Error ? error.message : String(error) };
}
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.exit(result.transportOk ? 0 : 2);
