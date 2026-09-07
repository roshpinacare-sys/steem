import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('content_file_required');
const content = readFileSync(file);
const server = createServer((req, res) => {
  if (req.url !== '/recovery.json') { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': content.length, 'cache-control': 'no-store' });
  res.end(content);
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server_address_invalid');
  process.send?.({ type: 'ready', port: address.port, pid: process.pid });
});
process.on('message', (message) => { if (message?.type === 'shutdown') server.close(() => process.exit(0)); });
