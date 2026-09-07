import https from 'node:https';
import { readFileSync } from 'node:fs';
const [keyPath, certPath, contentPath] = process.argv.slice(2);
if (!keyPath || !certPath || !contentPath) throw new Error('v33_36_server_args_required');
const content = readFileSync(contentPath);
const server = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath), minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, (req, res) => {
  if (req.url === '/artifact.json') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': content.length, 'cache-control': 'no-store' }); res.end(content); return; }
  res.writeHead(404); res.end('not found');
});
server.listen(0, '127.0.0.1', () => process.send?.({ type: 'ready', port: server.address().port, pid: process.pid }));
process.on('message', (message) => { if (message?.type === 'stop') server.close(() => process.exit(0)); });
