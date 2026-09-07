import { Worker } from 'node:worker_threads';
import { sha256, sha256Bytes } from '../contracts/crypto.js';

export type WasmRuntimeQualificationStateV32_16 = 'FAILED' | 'DRY_RUN_PASSED';

export interface WasmRuntimeQualificationPolicyV32_16 {
  readonly policyDigest: string;
  readonly maximumModuleBytes: number;
  readonly maximumMemoryBytes: number;
  readonly maximumExecutionMs: number;
  readonly requiredRunExport: string;
  readonly requiredMemoryExport: string;
  readonly allowedImports: readonly string[];
}

export interface WasmRuntimeQualificationReportV32_16 {
  readonly schemaVersion: '32.16';
  readonly runtime: 'node-webassembly-worker';
  readonly state: WasmRuntimeQualificationStateV32_16;
  readonly productionQualified: false;
  readonly moduleDigest: string;
  readonly policyDigest: string;
  readonly output: number | null;
  readonly memoryBytes: number | null;
  readonly durationMs: number;
  readonly findings: readonly string[];
  readonly limitations: readonly string[];
  readonly reportDigest: string;
}

export async function qualifyWasmRuntimeV32_16(options: {
  readonly bytes: Buffer;
  readonly input: readonly number[];
  readonly policy: WasmRuntimeQualificationPolicyV32_16;
}): Promise<WasmRuntimeQualificationReportV32_16> {
  validatePolicy(options.policy);
  const started = Date.now();
  const findings: string[] = [];
  const moduleDigest = sha256Bytes(options.bytes);

  if (options.bytes.byteLength > options.policy.maximumModuleBytes) findings.push('wasm-runtime-module-size-exceeded');
  if (options.input.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) findings.push('wasm-runtime-input-invalid');

  let module: WebAssembly.Module | undefined;
  if (findings.length === 0) {
    try {
      module = new WebAssembly.Module(options.bytes);
    } catch {
      findings.push('wasm-runtime-binary-invalid');
    }
  }

  if (module !== undefined) {
    const exports = WebAssembly.Module.exports(module);
    const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}.${item.name}`).sort();
    const allowedImports = [...options.policy.allowedImports].sort();
    if (new Set(allowedImports).size !== allowedImports.length) findings.push('wasm-runtime-policy-import-duplicate');
    if (JSON.stringify(imports) !== JSON.stringify(allowedImports)) findings.push('wasm-runtime-import-contract-mismatch');

    const runExports = exports.filter((item) => item.kind === 'function' && item.name === options.policy.requiredRunExport);
    if (runExports.length !== 1) findings.push('wasm-runtime-run-export-invalid');
    const memoryExports = exports.filter((item) => item.kind === 'memory');
    if (memoryExports.length !== 1 || memoryExports[0]?.name !== options.policy.requiredMemoryExport) {
      findings.push('wasm-runtime-memory-export-invalid');
    }
  }

  let output: number | null = null;
  let memoryBytes: number | null = null;
  if (findings.length === 0) {
    try {
      const result = await executeInWorker(options.bytes, options.input, options.policy);
      output = result.output;
      memoryBytes = result.memoryBytes;
      if (!Number.isSafeInteger(output)) findings.push('wasm-runtime-output-invalid');
      if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0) findings.push('wasm-runtime-memory-measurement-invalid');
      else if (memoryBytes > options.policy.maximumMemoryBytes) findings.push('wasm-runtime-memory-limit-exceeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'wasm-runtime-timeout') findings.push(message);
      else findings.push(`wasm-runtime-execution-failed:${sanitizeFailure(message)}`);
    }
  }

  const material = {
    schemaVersion: '32.16' as const,
    runtime: 'node-webassembly-worker' as const,
    state: (findings.length === 0 ? 'DRY_RUN_PASSED' : 'FAILED') as WasmRuntimeQualificationStateV32_16,
    productionQualified: false as const,
    moduleDigest,
    policyDigest: options.policy.policyDigest,
    output,
    memoryBytes,
    durationMs: Date.now() - started,
    findings,
    limitations: [
      'local-worker-runtime-only',
      'not-wasi-component-runtime',
      'no-fuel-or-epoch-interruption',
      'not-os-sandboxed',
      'not-independently-security-reviewed',
    ],
  };
  return { ...material, reportDigest: sha256(material) };
}

function validatePolicy(policy: WasmRuntimeQualificationPolicyV32_16): void {
  if (!/^[a-f0-9]{64}$/.test(policy.policyDigest)) throw new Error('wasm_runtime_policy_digest_invalid');
  if ([policy.maximumModuleBytes, policy.maximumMemoryBytes, policy.maximumExecutionMs].some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('wasm_runtime_policy_limits_invalid');
  }
  if (policy.maximumModuleBytes > 32 * 1024 * 1024 || policy.maximumMemoryBytes > 256 * 1024 * 1024 || policy.maximumExecutionMs > 60_000) {
    throw new Error('wasm_runtime_policy_limits_unbounded');
  }
  if (policy.requiredRunExport.trim() === '' || policy.requiredMemoryExport.trim() === '') throw new Error('wasm_runtime_policy_export_invalid');
  if (policy.allowedImports.some((value) => value.trim() === '')) throw new Error('wasm_runtime_policy_import_invalid');
}

async function executeInWorker(
  bytes: Buffer,
  input: readonly number[],
  policy: WasmRuntimeQualificationPolicyV32_16,
): Promise<{ readonly output: number; readonly memoryBytes: number }> {
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
      const run = instance.exports[workerData.runExport];
      const memory = instance.exports[workerData.memoryExport];
      if (typeof run !== 'function') throw new Error('run-export-unavailable');
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('memory-export-unavailable');
      const result = run(workerData.input.length);
      parentPort.postMessage({ ok: true, output: emitted ?? result, memoryBytes: memory.buffer.byteLength });
    } catch (error) {
      parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  `, {
    eval: true,
    workerData: {
      bytes,
      input: [...input],
      runExport: policy.requiredRunExport,
      memoryExport: policy.requiredMemoryExport,
    },
    resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 1 },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let executionTimer: NodeJS.Timeout | undefined;
    const startupTimer = setTimeout(() => finish(() => reject(new Error('wasm-runtime-worker-start-timeout'))), 5_000);
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (executionTimer !== undefined) clearTimeout(executionTimer);
      worker.removeAllListeners();
      void worker.terminate();
      operation();
    };
    worker.once('online', () => {
      clearTimeout(startupTimer);
      executionTimer = setTimeout(() => finish(() => reject(new Error('wasm-runtime-timeout'))), policy.maximumExecutionMs);
    });
    worker.once('message', (message: { readonly ok: boolean; readonly output?: number; readonly memoryBytes?: number; readonly error?: string }) => {
      finish(() => {
        if (!message.ok || message.output === undefined || message.memoryBytes === undefined) reject(new Error(message.error ?? 'worker-response-invalid'));
        else resolve({ output: message.output, memoryBytes: message.memoryBytes });
      });
    });
    worker.once('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      finish(() => reject(new Error(`worker-error:${message}`)));
    });
    worker.once('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`worker-exit:${code}`)));
    });
  });
}

function sanitizeFailure(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'unknown' : cleaned.slice(0, 160);
}
