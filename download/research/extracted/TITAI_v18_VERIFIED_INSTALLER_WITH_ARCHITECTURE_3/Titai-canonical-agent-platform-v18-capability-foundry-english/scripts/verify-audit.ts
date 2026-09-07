process.env.DATABASE_PATH ??= "./data/titai.db";
process.env.ENCRYPTION_KEY ??= "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=";
process.env.AUTH_SECRET ??= "verify-only-secret";

import { verifyAuditChain } from "../src/lib/engine/audit";

const result = verifyAuditChain();
if (result.ok) {
  console.log(`✅ audit chain verified — ${result.length} entries intact`);
  process.exit(0);
} else {
  console.error(`❌ audit chain broken at entry #${result.brokenAtId}`);
  process.exit(1);
}
