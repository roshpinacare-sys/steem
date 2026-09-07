export interface WasmImportDescriptor {
  readonly module: string;
  readonly name: string;
  readonly kind: WebAssembly.ImportExportKind;
}

export function inspectImports(bytes: BufferSource): readonly WasmImportDescriptor[] {
  const module = new WebAssembly.Module(bytes);
  return WebAssembly.Module.imports(module);
}

export function instantiateWithAllowlist(
  bytes: BufferSource,
  imports: WebAssembly.Imports,
  allowed: ReadonlySet<string>,
): WebAssembly.Instance {
  const module = new WebAssembly.Module(bytes);
  for (const item of WebAssembly.Module.imports(module)) {
    const key = `${item.module}.${item.name}`;
    if (!allowed.has(key)) throw new Error(`wasm_import_denied:${key}`);
  }
  return new WebAssembly.Instance(module, imports);
}
