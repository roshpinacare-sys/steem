# Changelog — zip-to-pdf-polyglot

## [9.1.0] — 2026-07-19 — Deep-Audit Fix Release

Full roast + fix of v9.0.0. Every bug found is documented below.

---

### Bugs fixed

#### CRITICAL — build is broken (`tsc` crashes on every file)
**v9.0.0 lie**: `tsconfig.json` declared `"module": "NodeNext"`, which requires `.js` extensions
on every relative import. Every `src/` file imported without extensions
(`import ... from "../bytes"`). Running `npm run build` would fail immediately
with ~50 TypeScript errors before touching any real code.

**Fix**: Changed to `"module": "CommonJS", "moduleResolution": "Node"`. No extensions required.
Removed `"type": "module"` from `package.json`. Fixed `server/index.ts` to not use
`import.meta.url` (CommonJS has `__dirname` natively).

---

#### CRITICAL — silent default passphrase is a security lie
**v9.0.0 lie**: `buildPolyglot` used `passphrase ?? "polyglot"` for encrypted strategies.
This meant:
- Calling `buildPolyglot(buf, name, { strategy: "encrypted" })` without a passphrase silently
  "encrypted" the file with the publicly-known default `"polyglot"`.
- Users could believe their data was encrypted with their secret, when it was actually
  "protected" by a string printed in every file of the source code.

**Fix**: Encrypted/chacha20-poly1305 strategies now **throw immediately** if no passphrase
is provided. There is no default. The error message is explicit:
> Strategy "encrypted" requires a passphrase. Pass passphrase via --passphrase (CLI) or
> opts.passphrase (API). There is no default — a missing passphrase is a security error.

Same fix applied in `extractPolyglot`: auto-detection now **skips** passphrase strategies
rather than trying a hardcoded default.

---

#### CRITICAL — `verifyPolyglot` ran PBKDF2 600K iterations on every call
**v9.0.0 bug**: `verifyPolyglot` tried every strategy's `extract()` function to detect the
format. For `encrypted` and `chacha20-poly1305`, `extract()` runs PBKDF2-SHA256 with 600,000
iterations (≈ 1 second of CPU) **before** failing with "wrong passphrase".
Result: every `verify` call on an encrypted file (with any non-"polyglot" passphrase) took
~2 seconds and returned `recognized: false` — a lie (the file IS a valid polyglot).

**Fix**: `verifyPolyglot` now uses **marker-only detection** for encrypted strategies —
scans for `/PolyglotEncryptedV2` and `/PolyglotChaCha20Poly1305` byte sequences. No decryption,
no passphrase, no PBKDF2. Returns `recognized: true, strategy: "encrypted", entryCount: null`
instantly. Added a `VERIFY_ORDER` array for deterministic, fast-fail detection of all strategies.

---

#### SERIOUS — HTTP server multipart parser corrupted by binary data
**v9.0.0 bug**: The hand-rolled multipart parser searched the raw POST body for
`name="strategy"\r\n\r\n`. If an uploaded ZIP contained these bytes (possible with any binary
content), it would find a false match inside the file data and return garbage field values.
Effective result: strategy, passphrase, and all options could be silently wrong for binary ZIPs.

**Fix**: Replaced the custom parser with **Express + Multer** (already in `dependencies`).
Multer correctly parses boundary-delimited multipart, never confusing file data with field names.

---

#### SERIOUS — `toBase64` used `btoa()` (browser API, not Node.js)
**v9.0.0 bug**: `server/index.ts` used `btoa(String.fromCharCode(...))` for base64 encoding.
`btoa` is a browser global. While Node.js 16+ includes it, it is not the canonical Node API
and its behavior on non-Latin-1 bytes is undefined. `String.fromCharCode(...bytes)` with spread
also stack-overflows for large files due to argument count limits.

**Fix**: `Buffer.from(bytes).toString("base64")` — the correct, Node-native, zero-copy approach.

---

#### SERIOUS — `cli.ts` passed 2 arguments to a 1-argument function
**v9.0.0 bug**: `findPageContentsRefs(pdfBuf, refs.pagesNum)` — the function signature is
`findPageContentsRefs(buf: Uint8Array): number[]`. The second argument was silently ignored
at runtime, but TypeScript with `strict: true` emits `error TS2554: Expected 1 arguments, but got 2`.
The CLI would fail to compile.

**Fix**: Removed the second argument. The function correctly reads `/Pages` from object 2.

---

#### SERIOUS — `mcp-server/index.ts` used `import.meta.url` (ESM-only)
**v9.0.0 bug**: After switching tsconfig to CommonJS (the fix for bug #1), `import.meta.url`
is not available. The server import would crash at startup with `SyntaxError`.

**Fix**: Replaced with CommonJS-compatible `__dirname` (or removed where not needed).

---

#### MODERATE — `readable_sample` MCP tool did full ZIP extraction for a text preview
**v9.0.0 bug**: The `readable_sample` MCP tool called `extractPolyglot()` which decompresses
and reconstructs the entire ZIP. For a 100 MB archive, this is slow and memory-intensive just
to get a preview of text content.

**Fix**: Now uses the fast direct-read path: `findPolyglotRefs → findPageContentsRefs →
readObjectStream → extractTjLines`. This reads only the PDF text layer without touching
the binary store or rebuilding any ZIP. ~10-100x faster for large archives.

---

#### MODERATE — test ZIP had wrong CRC-32 (hardcoded to 0)
**v9.0.0 bug**: `test/basic.test.ts` built a handcrafted ZIP with `crc32 = 0` for
`"Hello, World!\n"`. The correct CRC-32 is `0x907060cd`. No current code path validates
CRC, so tests passed. But this is wrong and would cause failures if CRC validation was added.

**Fix**: Added a correct IEEE CRC-32 implementation in the test file. The test ZIP now has
the correct checksum.

---

#### MODERATE — web UI passphrase field shown for ALL uploaded PDFs
**v9.0.0 bug**: When any PDF was dropped in the extract panel, the passphrase field was
immediately made visible. This was wrong — only encrypted PDFs need a passphrase.

**Fix**: Added `autoDetectStrategy()` — calls `/api/verify` when a PDF is uploaded and
shows the passphrase field only if `strategy === "encrypted" || "chacha20-poly1305"`.
Also displays a strategy badge ("✓ Detected: agent-readable") after auto-detection.
A manual override toggle ("+ Enter passphrase manually") is provided for edge cases.

---

#### MINOR — `mcp-server/index.ts` didn't create output directories before writing files
**v9.0.0 bug**: `writeFileSync(outPath, ...)` would throw if the parent directory didn't exist.

**Fix**: Added `mkdirSync(dirname(outPath), { recursive: true })` before every `writeFileSync`.

---

#### MINOR — `cli.ts` + `mcp-server/index.ts` imported from `"./src/index.js"` with `.js`
**v9.0.0 issue**: With the old NodeNext module setting, `.js` extensions were required.
With the CommonJS fix, they're wrong.

**Fix**: All imports now use plain relative paths without extensions.

---

### New tests added (v9.1.0)

- `buildPolyglot` without passphrase throws for `encrypted` and `chacha20-poly1305`
- Auto-detect in `extractPolyglot` skips encrypted strategies gracefully without passphrase
- Wrong passphrase correctly rejected (`authentication failed`)
- `verifyPolyglot` detects encrypted by marker only (`entryCount: null`, no decryption)
- `verifyPolyglot` on empty buffer (`pdfMagic: false`)
- Full content round-trip: `"Hello, World!\n"` survives `agent-readable` build → extract
- `extractPolyglot` auto-detects `raw-polyglot-patched` without a strategy hint

---

## [9.0.0] — 2026-07-19

See CHANGELOG in v9.0.0 for the full history from v1.x through v8.1.0.
