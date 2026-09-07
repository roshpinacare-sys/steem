export function parseStrictJsonV32_12(text: string): unknown {
  const parser = new StrictJsonParser(text);
  const value = parser.parseValue('$');
  parser.skipWhitespace();
  if (!parser.atEnd()) throw new Error(`strict_json_trailing_content:${parser.position()}`);
  return value;
}

class StrictJsonParser {
  #index = 0;
  constructor(readonly text: string) {}
  position(): number { return this.#index; }
  atEnd(): boolean { return this.#index >= this.text.length; }
  skipWhitespace(): void { while (!this.atEnd() && /[\t\n\r ]/.test(this.text[this.#index]!)) this.#index += 1; }
  parseValue(path: string): unknown {
    this.skipWhitespace();
    const char = this.text[this.#index];
    if (char === '{') return this.parseObject(path);
    if (char === '[') return this.parseArray(path);
    if (char === '"') return this.parseString();
    if (char === 't') return this.parseLiteral('true', true);
    if (char === 'f') return this.parseLiteral('false', false);
    if (char === 'n') return this.parseLiteral('null', null);
    if (char === '-' || (char !== undefined && /[0-9]/.test(char))) return this.parseNumber();
    throw new Error(`strict_json_value_invalid:${path}:${this.#index}`);
  }
  parseObject(path: string): Record<string, unknown> {
    this.expect('{'); this.skipWhitespace();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.peek('}')) { this.#index += 1; return result; }
    while (true) {
      this.skipWhitespace();
      if (!this.peek('"')) throw new Error(`strict_json_object_key_invalid:${path}:${this.#index}`);
      const key = this.parseString();
      if (keys.has(key)) throw new Error(`strict_json_duplicate_key:${path}.${key}`);
      keys.add(key);
      this.skipWhitespace(); this.expect(':');
      result[key] = this.parseValue(`${path}.${escapePath(key)}`);
      this.skipWhitespace();
      if (this.peek('}')) { this.#index += 1; break; }
      this.expect(',');
    }
    return result;
  }
  parseArray(path: string): unknown[] {
    this.expect('['); this.skipWhitespace();
    const result: unknown[] = [];
    if (this.peek(']')) { this.#index += 1; return result; }
    while (true) {
      result.push(this.parseValue(`${path}[${result.length}]`));
      this.skipWhitespace();
      if (this.peek(']')) { this.#index += 1; break; }
      this.expect(',');
    }
    return result;
  }
  parseString(): string {
    const start = this.#index;
    this.expect('"');
    let escaped = false;
    while (!this.atEnd()) {
      const char = this.text[this.#index]!;
      this.#index += 1;
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') {
        const token = this.text.slice(start, this.#index);
        try { return JSON.parse(token) as string; } catch { throw new Error(`strict_json_string_invalid:${start}`); }
      }
      if (char.charCodeAt(0) < 0x20) throw new Error(`strict_json_control_character:${this.#index - 1}`);
    }
    throw new Error(`strict_json_string_unterminated:${start}`);
  }
  parseNumber(): number {
    const remaining = this.text.slice(this.#index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (match === null) throw new Error(`strict_json_number_invalid:${this.#index}`);
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error(`strict_json_number_non_finite:${this.#index}`);
    return value;
  }
  parseLiteral<T>(literal: string, value: T): T {
    if (this.text.slice(this.#index, this.#index + literal.length) !== literal) throw new Error(`strict_json_literal_invalid:${this.#index}`);
    this.#index += literal.length;
    return value;
  }
  expect(char: string): void {
    if (!this.peek(char)) throw new Error(`strict_json_expected_${char}:${this.#index}`);
    this.#index += 1;
  }
  peek(char: string): boolean { return this.text[this.#index] === char; }
}

function escapePath(value: string): string { return value.replaceAll('.', '\\.'); }
