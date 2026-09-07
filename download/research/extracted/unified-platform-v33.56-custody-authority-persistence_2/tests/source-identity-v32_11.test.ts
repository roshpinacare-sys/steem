import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';

function pythonProbe(): { items: string[]; first: string; second: string } {
  const program = String.raw`
import importlib.util,json,tempfile
from pathlib import Path
module_path=Path('scripts/test_ops_context_v32_6.py').resolve()
spec=importlib.util.spec_from_file_location('ctx_v3211',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='v32-11-source-id-') as directory:
 root=Path(directory); handoff=root/'CLAUDE_HANDOFF_v32_11.md'; handoff.write_text('first')
 module.ROOT=root
 items=module.source_items(); first=module.source_digest()
 handoff.write_text('second'); second=module.source_digest()
 print(json.dumps({'items':items,'first':first,'second':second}))
`;
  return JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })) as { items: string[]; first: string; second: string };
}

test('source manifest automatically binds every versioned handoff', () => {
  const actualHandoffs = readdirSync('.').filter((name) => /^CLAUDE_HANDOFF_v.*\.md$/.test(name)).sort();
  const program = String.raw`
import importlib.util,json
from pathlib import Path
p=Path('scripts/test_ops_context_v32_6.py').resolve();s=importlib.util.spec_from_file_location('ctx_v3211',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.source_items()))
`;
  const items = JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })) as string[];
  for (const handoff of actualHandoffs) assert.ok(items.includes(handoff), `missing source identity binding: ${handoff}`);
  assert.ok(items.includes('CLAUDE_HANDOFF_v32_11.md'));
});

test('source identity changes when the current handoff changes', () => {
  const probe = pythonProbe();
  assert.ok(probe.items.includes('CLAUDE_HANDOFF_v32_11.md'));
  assert.notEqual(probe.first, probe.second);
});


test('source identity binds external qualification manifests and runbooks', () => {
  const program = String.raw`
import importlib.util,json,tempfile
from pathlib import Path
module_path=Path('scripts/test_ops_context_v32_6.py').resolve()
spec=importlib.util.spec_from_file_location('ctx_v3212',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='v32-12-qualification-source-id-') as directory:
 root=Path(directory); kit=root/'external-qualification'/'v32.12'/'gate'; kit.mkdir(parents=True)
 manifest=kit/'manifest.json'; manifest.write_text('{"version":"first"}')
 module.ROOT=root
 items=module.source_items(); first=module.source_digest()
 manifest.write_text('{"version":"second"}'); second=module.source_digest()
 print(json.dumps({'items':items,'first':first,'second':second}))
`;
  const probe = JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })) as { items: string[]; first: string; second: string };
  assert.ok(probe.items.includes('external-qualification'));
  assert.notEqual(probe.first, probe.second);
});


test('source identity binds independent verifier-only implementations', () => {
  const program = String.raw`
import importlib.util,json,tempfile
from pathlib import Path
module_path=Path('scripts/test_ops_context_v32_6.py').resolve()
spec=importlib.util.spec_from_file_location('ctx_v3214',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='v32-14-verifier-source-id-') as directory:
 root=Path(directory); verifier=root/'verifier-only'/'v32.14'; verifier.mkdir(parents=True)
 implementation=verifier/'independent_binary_verifier.py'; implementation.write_text('first')
 module.ROOT=root
 items=module.source_items(); first=module.source_digest()
 implementation.write_text('second'); second=module.source_digest()
 print(json.dumps({'items':items,'first':first,'second':second}))
`;
  const probe = JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })) as { items: string[]; first: string; second: string };
  assert.ok(probe.items.includes('verifier-only'));
  assert.notEqual(probe.first, probe.second);
});

test('source identity binds blinded frontier benchmark manifests', () => {
  const program = String.raw`
import importlib.util,json,tempfile
from pathlib import Path
module_path=Path('scripts/test_ops_context_v32_6.py').resolve()
spec=importlib.util.spec_from_file_location('ctx_v3215',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='v32-15-benchmark-source-id-') as directory:
 root=Path(directory); kit=root/'benchmark-kits'/'v32.15'/'tournament'; kit.mkdir(parents=True)
 manifest=kit/'manifest.json'; manifest.write_text('{"version":"first"}')
 module.ROOT=root
 items=module.source_items(); first=module.source_digest()
 manifest.write_text('{"version":"second"}'); second=module.source_digest()
 print(json.dumps({'items':items,'first':first,'second':second}))
`;
  const probe = JSON.parse(execFileSync('python3', ['-c', program], { encoding: 'utf8' })) as { items: string[]; first: string; second: string };
  assert.ok(probe.items.includes('benchmark-kits'));
  assert.notEqual(probe.first, probe.second);
});
