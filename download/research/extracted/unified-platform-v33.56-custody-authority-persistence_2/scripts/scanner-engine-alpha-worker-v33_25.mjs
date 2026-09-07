import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [requestPath, resultPath] = process.argv.slice(2);
if (!requestPath || !resultPath) process.exit(64);
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const artifact of request.artifacts) {
  const bytes = Buffer.from(artifact.bytesBase64, 'base64');
  const text = bytes.toString('utf8');
  const hex = bytes.subarray(0, 64).toString('hex');
  const matched = [];
  for (const rule of request.rules) {
    if (rule.engineScope !== 'BOTH' && rule.engineScope !== 'ENGINE_ALPHA') continue;
    if (rule.encoding === 'UTF8_LITERAL' && text.includes(rule.pattern)) matched.push(rule.ruleId);
    if (rule.encoding === 'HEX_PREFIX' && hex.startsWith(rule.pattern.toLowerCase())) matched.push(rule.ruleId);
  }
  matched.sort();
  results.push({
    path: artifact.path,
    sizeBytes: bytes.length,
    sha256: sha256Bytes(bytes),
    matchedRuleIds: matched,
    status: matched.length === 0 ? 'CLEAN' : 'REJECTED',
  });
}
writeFileSync(resultPath, JSON.stringify({
  engine: 'ENGINE_ALPHA',
  engineVersion: '33.25-alpha-1',
  workerPid: process.pid,
  parentPid: process.ppid,
  results,
}));
