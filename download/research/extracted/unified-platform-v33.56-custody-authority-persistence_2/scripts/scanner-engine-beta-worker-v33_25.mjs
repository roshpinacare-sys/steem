import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [requestPath, resultPath] = process.argv.slice(2);
if (!requestPath || !resultPath) process.exit(64);
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const artifact of request.artifacts) {
  const bytes = Buffer.from(artifact.bytesBase64, 'base64');
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const prefix = [...bytes.subarray(0, 8)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const hits = new Set();
  for (const rule of request.rules) {
    if (rule.engineScope !== 'BOTH' && rule.engineScope !== 'ENGINE_BETA') continue;
    if (rule.encoding === 'UTF8_LITERAL') {
      const needle = rule.pattern.normalize('NFKC');
      if (utf8.normalize('NFKC').indexOf(needle) >= 0) hits.add(rule.ruleId);
    } else if (rule.encoding === 'HEX_PREFIX' && prefix.slice(0, rule.pattern.length).toLowerCase() === rule.pattern.toLowerCase()) {
      hits.add(rule.ruleId);
    }
  }
  const matchedRuleIds = [...hits].sort();
  results.push({ path: artifact.path, sizeBytes: bytes.byteLength, sha256: digest(bytes), matchedRuleIds, status: matchedRuleIds.length ? 'REJECTED' : 'CLEAN' });
}
writeFileSync(resultPath, JSON.stringify({
  engine: 'ENGINE_BETA',
  engineVersion: '33.25-beta-1',
  workerPid: process.pid,
  parentPid: process.ppid,
  results,
}));
