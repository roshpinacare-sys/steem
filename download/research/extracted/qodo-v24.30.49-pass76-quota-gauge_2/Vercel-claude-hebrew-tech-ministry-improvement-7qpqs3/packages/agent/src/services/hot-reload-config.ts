/**
 * Hot-Reload Config — watches .env file for changes and refreshes
 * process.env without restarting. Uses fs.watch with debounce.
 */
import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import { log as logger } from './logger.js';

const DEBOUNCE_MS = 300;

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function applyEnv(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

export interface HotReloadEnv {
  ENV_FILE?: string;
}

export function startHotReload(
  envFilePath?: string,
  env: HotReloadEnv = process.env as HotReloadEnv,
): FSWatcher | null {
  const filePath = resolve(envFilePath ?? env.ENV_FILE ?? '.env');
  if (!existsSync(filePath)) {
    logger.warn('Hot-reload: env file not found; skipping', { filePath });
    return null;
  }

  // Apply initial values
  applyEnv(parseEnvFile(filePath));
  logger.info('Hot-reload config initialised', { filePath });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(filePath, (_event) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const vars = parseEnvFile(filePath);
        applyEnv(vars);
        logger.info('Hot-reload: config refreshed', { keys: Object.keys(vars).length });
      } catch (err) {
        logger.error('Hot-reload: failed to parse env file', { err });
      }
    }, DEBOUNCE_MS);
  });

  watcher.on('error', (err) => {
    logger.error('Hot-reload watcher error', { err });
  });

  return watcher;
}
