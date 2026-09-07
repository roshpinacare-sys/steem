import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectImports, instantiateWithAllowlist } from '../src/isolation/wasm-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, '..', '..', 'isolation', 'wasm-core', 'artifacts');

function read(name: string): Buffer {
  return readFileSync(join(artifacts, name));
}

test('WebAssembly capability exposes only explicit imports', () => {
  const imports = inspectImports(read('allowed.wasm'));
  assert.deepEqual(imports.map((item) => `${item.module}.${item.name}`), ['cap.read_byte', 'cap.emit']);
});

test('allowed WebAssembly capability executes through host adapter', () => {
  let emitted: number | undefined;
  const values = [3, 5, 7];
  const instance = instantiateWithAllowlist(read('allowed.wasm'), {
    cap: {
      read_byte: (index: number) => values[index] ?? 0,
      emit: (value: number) => { emitted = value; return 0; },
    },
  }, new Set(['cap.read_byte', 'cap.emit']));
  const run = instance.exports.run as (count: number) => number;
  assert.equal(run(values.length), 15);
  assert.equal(emitted, 15);
});

test('undeclared host capability import is rejected', () => {
  assert.throws(() => instantiateWithAllowlist(read('malicious.wasm'), {
    env: { host_secret: () => 42 },
  }, new Set(['cap.read_byte', 'cap.emit'])), /wasm_import_denied:env.host_secret/);
});

test('linear memory cannot grow beyond declared maximum', () => {
  const instance = instantiateWithAllowlist(read('allowed.wasm'), {
    cap: { read_byte: () => 0, emit: () => 0 },
  }, new Set(['cap.read_byte', 'cap.emit']));
  const memory = instance.exports.memory as WebAssembly.Memory;
  assert.equal(memory.buffer.byteLength, 131072);
  assert.throws(() => memory.grow(1), /Maximum memory size exceeded|maximum memory size exceeded|Unable to grow instance memory/);
});

test('infinite WebAssembly execution is contained by a killable process boundary', async () => {
  const child = spawn(process.execPath, ['-e', `
    const { readFileSync } = require('node:fs');
    const bytes = readFileSync(process.env.WASM_PATH);
    const module = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(module, {});
    process.stdout.write('READY\\n');
    instance.exports.run();
  `], { env: { ...process.env, WASM_PATH: join(artifacts, 'infinite.wasm') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr?.setEncoding('utf8'); child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => { const timeout=setTimeout(()=>reject(new Error(`wasm_child_start_timeout:${stderr}`)),2000); child.stdout?.setEncoding('utf8'); child.stdout?.on('data',(chunk)=>{if(String(chunk).includes('READY')){clearTimeout(timeout);resolve();}}); child.once('error',(error)=>{clearTimeout(timeout);reject(error);}); child.once('exit',(code,signal)=>{if(code!==null||signal!==null){clearTimeout(timeout);reject(new Error(`wasm_child_exited_before_ready:${code}:${signal}:${stderr}`));}}); });
    const started=Date.now(); assert.equal(child.kill('SIGKILL'),true); const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('wasm_child_termination_timeout')),2000);child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});}); assert.equal(exit.code,null);assert.equal(exit.signal,'SIGKILL');assert.ok(Date.now()-started<2000);
  } finally { if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');child.stdout?.destroy();child.stderr?.destroy(); }
});
