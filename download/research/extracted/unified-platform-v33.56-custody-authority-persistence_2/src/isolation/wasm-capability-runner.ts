import { Worker } from 'node:worker_threads';
import { sha256, sha256Bytes, type SigningIdentity } from '../contracts/crypto.js';
import { KeyLifecycleRegistry, type PurposeBoundEnvelope } from '../security/key-lifecycle.js';
import { inspectImports } from './wasm-core.js';

export interface WasmCapabilityManifest {
  readonly capabilityId: string;
  readonly version: string;
  readonly tenantId: string;
  readonly moduleDigest: string;
  readonly allowedImports: readonly string[];
  readonly timeoutMs: number;
  readonly maxModuleBytes?: number;
  readonly maxInputBytes: number;
  readonly maxMemoryBytes: number;
  readonly declaredEffects: readonly ['emit-result'];
  readonly evidenceClass: 'COMPUTED';
}

export interface WasmCapabilityReceipt {
  readonly capabilityId: string;
  readonly version: string;
  readonly tenantId: string;
  readonly moduleDigest: string;
  readonly manifestDigest: string;
  readonly inputDigest: string;
  readonly output: number;
  readonly outputDigest: string;
  readonly memoryBytes: number;
  readonly durationMs: number;
  readonly isolationClass: 'webassembly-core';
  readonly limitations: readonly string[];
}

export function signWasmCapabilityManifest(
  manifest: WasmCapabilityManifest,
  identity: SigningIdentity,
  registry: KeyLifecycleRegistry,
  now = new Date(),
): PurposeBoundEnvelope<WasmCapabilityManifest> {
  return registry.sign(manifest, identity, {
    purpose: 'capability-publisher',
    environment: 'test',
    tenantId: manifest.tenantId,
    nonce: `wasm-capability:${manifest.capabilityId}:${manifest.version}:${manifest.moduleDigest}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  });
}

export async function runSignedWasmCapability(options: {
  readonly moduleBytes: Buffer;
  readonly envelope: PurposeBoundEnvelope<WasmCapabilityManifest>;
  readonly registry: KeyLifecycleRegistry;
  readonly input: readonly number[];
  readonly now?: Date;
}): Promise<WasmCapabilityReceipt> {
  const now = options.now ?? new Date();
  const manifest = options.envelope.payload;
  if (!options.registry.verify(options.envelope, {
    purpose: 'capability-publisher', environment: 'test', tenantId: manifest.tenantId,
  }, now)) throw new Error('capability_manifest_signature_invalid');
  if (manifest.moduleDigest !== sha256Bytes(options.moduleBytes)) throw new Error('capability_module_digest_mismatch');
  if (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 10 || manifest.timeoutMs > 60_000) throw new Error('invalid_capability_timeout');
  const maxModuleBytes = manifest.maxModuleBytes ?? 1024 * 1024;
  if (!Number.isInteger(maxModuleBytes) || maxModuleBytes <= 0 || maxModuleBytes > 16 * 1024 * 1024) throw new Error('invalid_module_limit');
  if (options.moduleBytes.byteLength > maxModuleBytes) throw new Error('capability_module_limit_exceeded');
  if (!Number.isInteger(manifest.maxInputBytes) || manifest.maxInputBytes <= 0) throw new Error('invalid_input_limit');
  if (!Number.isInteger(manifest.maxMemoryBytes) || manifest.maxMemoryBytes <= 0) throw new Error('invalid_memory_limit');
  if (options.input.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('input_must_be_bytes');
  if (options.input.length > manifest.maxInputBytes) throw new Error('capability_input_limit_exceeded');
  const actualImports = inspectImports(options.moduleBytes).map((item) => `${item.module}.${item.name}`).sort();
  const allowed = [...manifest.allowedImports].sort();
  if (new Set(allowed).size !== allowed.length) throw new Error('duplicate_capability_import');
  const supportedImports = new Set(['cap.read_byte', 'cap.emit']);
  if (allowed.some((item) => !supportedImports.has(item))) throw new Error(`capability_host_import_forbidden:${allowed.filter((item) => !supportedImports.has(item)).join(',')}`);
  if (manifest.declaredEffects.length !== 1 || manifest.declaredEffects[0] !== 'emit-result') throw new Error('capability_effect_contract_invalid');
  if (JSON.stringify(actualImports) !== JSON.stringify(allowed)) throw new Error(`capability_import_contract_mismatch:${actualImports.join(',')}`);

  const started = Date.now();
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    try {
      let emitted;
      const module = new WebAssembly.Module(workerData.bytes);
      const instance = new WebAssembly.Instance(module, {
        cap: {
          read_byte: (index) => workerData.input[index] ?? 0,
          emit: (value) => { emitted = value; return 0; },
        },
      });
      const output = instance.exports.run(workerData.input.length);
      const memoryBytes = instance.exports.memory?.buffer?.byteLength ?? 0;
      parentPort.postMessage({ ok: true, output: emitted ?? output, memoryBytes });
    } catch (error) {
      parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  `, {
    eval: true,
    workerData: { bytes: options.moduleBytes, input: [...options.input] },
    resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 1 },
  });

  worker.unref();
  const result = await new Promise<{ readonly output: number; readonly memoryBytes: number }>((resolve, reject) => {
    let settled = false;
    let executionTimeout: NodeJS.Timeout | undefined;
    const startupTimeoutMs = Math.max(1_000, Math.min(5_000, manifest.timeoutMs * 4));
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (executionTimeout !== undefined) clearTimeout(executionTimeout);
      worker.unref();
      void worker.terminate();
      operation();
    };
    const startupTimeout = setTimeout(() => finish(() => reject(new Error('capability_worker_start_timeout'))), startupTimeoutMs);
    worker.once('online', () => {
      clearTimeout(startupTimeout);
      executionTimeout = setTimeout(() => finish(() => reject(new Error('capability_timeout'))), manifest.timeoutMs);
    });
    worker.once('message', (message: { ok: boolean; output?: number; memoryBytes?: number; error?: string }) => {
      finish(() => {
        if (!message.ok || message.output === undefined || message.memoryBytes === undefined) reject(new Error(`capability_execution_failed:${message.error ?? 'unknown'}`));
        else resolve({ output: message.output, memoryBytes: message.memoryBytes });
      });
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(() => reject(new Error(`capability_worker_exit:${code}`)));
    });
  });
  if (!Number.isSafeInteger(result.output)) throw new Error('capability_output_invalid');
  if (!Number.isInteger(result.memoryBytes) || result.memoryBytes < 0) throw new Error('capability_memory_measurement_invalid');
  if (result.memoryBytes > manifest.maxMemoryBytes) throw new Error('capability_memory_limit_exceeded');
  const durationMs = Date.now() - started;
  return {
    capabilityId: manifest.capabilityId,
    version: manifest.version,
    tenantId: manifest.tenantId,
    moduleDigest: manifest.moduleDigest,
    manifestDigest: sha256(manifest),
    inputDigest: sha256(options.input),
    output: result.output,
    outputDigest: sha256(result.output),
    memoryBytes: result.memoryBytes,
    durationMs,
    isolationClass: 'webassembly-core',
    limitations: [
      'not-wasi-component-model',
      'no-fuel-or-epoch-interruption',
      'worker-timeout-and-resource-limits-are-runtime-containment-not-os-sandbox',
      'not-independently-security-reviewed',
    ],
  };
}
