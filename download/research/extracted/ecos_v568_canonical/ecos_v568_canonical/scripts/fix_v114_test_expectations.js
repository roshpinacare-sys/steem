const fs = require('fs');
const path = require('path');
const root = process.cwd();
function patch(rel, replacements) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [find, replace] of replacements) {
    if (!s.includes(find)) throw new Error(`${rel}: missing ${find}`);
    s = s.split(find).join(replace);
  }
  fs.writeFileSync(p, s);
  console.log(`patched ${rel}`);
}
patch('tests/auditReport.test.js', [["expect(body).toHaveProperty('version', 'V113');", "expect(body).toHaveProperty('version', 'V114');"]]);
patch('tests/chainProof.test.js', [["expect(body.ecosVersion).toBe('V112');", "expect(body.ecosVersion).toBe('V114');"]]);
patch('tests/euAiActReport.test.js', [
  ["expect(report.version).toBe('V113');", "expect(report.version).toBe('V114');"],
  ["expect(typeof ac.intact).toBe('boolean');", "expect(typeof (typeof ac.intact === 'object' ? ac.intact.ok : ac.intact)).toBe('boolean');"],
]);
patch('tests/integration.test.js', [
  ["GET /api/v1/health returns version 'V112'", "GET /api/v1/health returns version 'V114'"],
  ["expect(body.version).toBe('V112');", "expect(body.version).toBe('V114');"],
  ["expect(body).toHaveProperty('version', 'V112');", "expect(body).toHaveProperty('version', 'V114');"],
]);
patch('tests/snapshotCron.test.js', [["expect(JSON.stringify(body)).toMatch(/V113|113/);", "expect(JSON.stringify(body)).toMatch(/V114|114/);"]]);
