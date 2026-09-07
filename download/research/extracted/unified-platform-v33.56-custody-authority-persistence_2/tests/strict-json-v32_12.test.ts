import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStrictJsonV32_12 } from '../src/validation/strict-json-v32_12.js';

test('strict JSON parser accepts nested valid JSON without changing data', () => {
  const text = '{"a":1,"b":[true,false,null,{"x":"\\u0061"}],"n":-1.25e2}';
  const value = parseStrictJsonV32_12(text);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), JSON.parse(text));
});

test('strict JSON parser rejects duplicate keys at every nesting level', () => {
  for (const text of ['{"a":1,"a":2}', '{"x":{"a":1,"a":2}}', '[{"a":1,"a":2}]']) {
    assert.throws(() => parseStrictJsonV32_12(text), /strict_json_duplicate_key/);
  }
});

test('strict JSON parser rejects trailing content, malformed numbers and unterminated strings', () => {
  assert.throws(() => parseStrictJsonV32_12('{"a":1}{}'), /trailing_content/);
  assert.throws(() => parseStrictJsonV32_12('{"a":01}'), /expected_/);
  assert.throws(() => parseStrictJsonV32_12('{"a":"x}'), /string_unterminated/);
});

test('strict JSON parser rejects control characters and non-finite numeric overflow', () => {
  assert.throws(() => parseStrictJsonV32_12('{"a":"\u0001"}'), /control_character/);
  assert.throws(() => parseStrictJsonV32_12('{"a":1e9999}'), /number_non_finite/);
});

test('strict JSON parser covers empty containers, escaped strings and all primitive literals', () => {
  assert.deepEqual(parseStrictJsonV32_12('{}'), Object.create(null));
  assert.deepEqual(parseStrictJsonV32_12('[]'), []);
  assert.deepEqual(JSON.parse(JSON.stringify(parseStrictJsonV32_12('[true,false,null,"a\\\"b\\\\c",0,-2,3.5,4e2]'))), [true,false,null,'a"b\\c',0,-2,3.5,400]);
});

test('strict JSON parser rejects invalid entry tokens, object keys, literals, escapes and bare minus', () => {
  assert.throws(() => parseStrictJsonV32_12('x'), /value_invalid/);
  assert.throws(() => parseStrictJsonV32_12('{a:1}'), /object_key_invalid/);
  assert.throws(() => parseStrictJsonV32_12('tru'), /literal_invalid/);
  assert.throws(() => parseStrictJsonV32_12('-'), /number_invalid/);
  assert.throws(() => parseStrictJsonV32_12('"\\uZZZZ"'), /string_invalid/);
});
