import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openOrCreatePrivatePilotContext } from '../app/private-pilot-context.js';
import { createPrivatePilotServer } from '../web/private-pilot-server.js';

const port = Number.parseInt(process.env.PORT ?? '4319', 10);
const dataRoot = resolve(process.env.V20_DATA_ROOT ?? 'evidence/private-pilot-runtime');
const passphrase = readRequiredSecret('V20_KEYSTORE_PASSPHRASE', 'V20_KEYSTORE_PASSPHRASE_FILE');
const bootstrapToken = readRequiredSecret('V20_BOOTSTRAP_TOKEN', 'V20_BOOTSTRAP_TOKEN_FILE');
const allowedOrigin = process.env.V20_ALLOWED_ORIGIN;
const context = openOrCreatePrivatePilotContext(dataRoot, passphrase);
const repositories = (process.env.V20_ALLOWED_REPOSITORIES ?? '').split(':').filter(Boolean).map((value) => resolve(value));
const server = createPrivatePilotServer({
  dataRoot,
  identityStore: context.identityStore,
  sessionSigningSecret: context.sessionSigningSecret,
  bootstrapToken,
  passportSignerByTenant: new Map([['tenant-1', context.passportSigner]]),
  keyRegistryByTenant: new Map([['tenant-1', context.keyRegistry]]),
  allowedRepositoriesByTenant: new Map([['tenant-1', repositories]]),
  ...(allowedOrigin === undefined ? {} : { allowedOrigin }),
  secureCookies: process.env.V20_SECURE_COOKIES === 'true',
});
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(JSON.stringify({ status: 'listening', port, dataRoot, readiness: 'Development', promotionBoundary: 'shadow-only' }) + '\n');
});

function readRequiredSecret(valueName: string, fileName: string): string {
  const direct = process.env[valueName];
  const file = process.env[fileName];
  const value = direct ?? (file === undefined ? undefined : readFileSync(file, 'utf8').trim());
  if (value === undefined || value.length < 16) throw new Error(`required_secret_missing:${valueName}`);
  return value;
}
