# zip-to-pdf-polyglot v9.1.0

> **The file that is simultaneously a valid PDF and a valid ZIP.**

Open it in Adobe Reader — it's a PDF with a cover page, file-tree diagram, and your entire source code rendered as readable text. Open it in 7-Zip or run `unzip` — it's a perfect ZIP archive. It is both, at the binary level.

---

## Contents

- [Quick start](#quick-start)
- [CLI usage](#cli-usage)
- [HTTP API server](#http-api-server)
- [MCP server (AI agents)](#mcp-server-ai-agents)
- [Web UI — Polyglot Studio](#web-ui--polyglot-studio)
- [All 10 strategies](#all-10-strategies)
- [Security](#security)
- [Architecture](#architecture)
- [Requirements](#requirements)

---

## Quick start

```bash
# Unzip and install
cd zip-to-pdf-polyglot-9.1.0
npm install

# Run without building (development — uses tsx)
npx tsx cli.ts build my-project.zip

# Build TypeScript → dist/ (optional)
npm run build
node dist/cli.js build my-project.zip

# Type-check only
npm run typecheck
```

---

## CLI usage

```
zip2pdf build <zip>    [-s strategy] [-o out.pdf] [--passphrase <pass>]
                       [--minimal] [--no-font] [--no-diagram] [--brotli]
                       [--no-exclude-cruft] [--json]

zip2pdf extract <pdf>  [-o out.zip] [--passphrase <pass>] [--no-canonical] [--json]

zip2pdf verify <pdf>   [--json]

zip2pdf readable <pdf> [-n lines] [--json]   Read agent-readable text layer
zip2pdf inspect <pdf>  [--json]              Print the manifest JSON
zip2pdf bootstrap <pdf>[--json]              Print Module OS bootstrap package

zip2pdf --list-strategies [--json]
zip2pdf --version | -v
```

### Options

| Flag | Description |
|------|-------------|
| `-s`, `--strategy` | Strategy name (default: `agent-readable`) |
| `-o`, `--out` | Output file path |
| `--passphrase` | **Required** for `encrypted` and `chacha20-poly1305` strategies |
| `--minimal` | Disable font + diagram (smallest output, 20-40% smaller) |
| `--no-font` | Skip TTF font subset only |
| `--no-diagram` | Skip the file-tree diagram page |
| `--brotli` | Brotli-compress content streams (agent-only read mode) |
| `--no-exclude-cruft` | Include node_modules, .git, dist, etc. |
| `--json` | Machine-readable JSON to stdout |

### Examples

```bash
# Build (default agent-readable strategy)
npx tsx cli.ts build my-project.zip

# Build with AES-256-GCM encryption
npx tsx cli.ts build my-project.zip -s encrypted --passphrase "my secret"

# Build with ChaCha20-Poly1305
npx tsx cli.ts build my-project.zip -s chacha20-poly1305 --passphrase "my secret"

# Build with RSA-2048 signing (private key printed to stdout — save it!)
npx tsx cli.ts build my-project.zip -s rsa-signed

# Build minimal (no font, no diagram — smallest PDF)
npx tsx cli.ts build my-project.zip --minimal

# Verify a polyglot PDF (works on encrypted files without passphrase)
npx tsx cli.ts verify my-project.polyglot.pdf

# Extract (auto-detects strategy)
npx tsx cli.ts extract my-project.polyglot.pdf

# Extract an encrypted PDF
npx tsx cli.ts extract encrypted.polyglot.pdf --passphrase "my secret"

# List all 10 strategies
npx tsx cli.ts --list-strategies

# Machine-readable output
npx tsx cli.ts build my-project.zip --json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).pdfSize)"
```

---

## HTTP API server

```bash
npm run serve               # development (tsx)
node dist/server/index.js   # production (after npm run build)
PORT=8080 npm run serve     # custom port
```

The server opens at `http://localhost:3000` and serves the Polyglot Studio web UI at `/`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Polyglot Studio web UI |
| GET | `/api/info` | Version + limits + endpoint list |
| GET | `/api/strategies` | All 10 strategies with metadata |
| POST | `/api/build` | ZIP → polyglot PDF |
| POST | `/api/extract` | Polyglot PDF → canonical ZIP |
| POST | `/api/verify` | Structural check (marker-only for encrypted) |
| POST | `/api/stats` | File statistics + extension breakdown |
| POST | `/api/readable` | Agent-readable text layer preview |

All POST endpoints accept `multipart/form-data` with a `file` field plus option fields.

### curl examples

```bash
# Build
curl -F "file=@archive.zip" -F "strategy=agent-readable" \
  http://localhost:3000/api/build -s | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['pdfSize'])"

# Build encrypted
curl -F "file=@archive.zip" -F "strategy=encrypted" -F "passphrase=mysecret" \
  http://localhost:3000/api/build -o build-result.json

# Verify (works even for encrypted PDFs, no passphrase needed)
curl -F "file=@archive.polyglot.pdf" http://localhost:3000/api/verify

# Extract
curl -F "file=@archive.polyglot.pdf" http://localhost:3000/api/extract -s | \
  python3 -m json.tool
```

---

## MCP server (AI agents)

```bash
npm run mcp                       # development
node dist/mcp-server/index.js     # production
```

### Configure in Claude Desktop / Cursor

Add to your MCP configuration file:

**Development (tsx — no build step):**
```json
{
  "mcpServers": {
    "zip-to-pdf-polyglot": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/zip-to-pdf-polyglot-9.1.0/mcp-server/index.ts"]
    }
  }
}
```

**Production (after `npm run build`):**
```json
{
  "mcpServers": {
    "zip-to-pdf-polyglot": {
      "command": "node",
      "args": ["/absolute/path/to/zip-to-pdf-polyglot-9.1.0/dist/mcp-server/index.js"]
    }
  }
}
```

### Available MCP tools

| Tool | Description |
|------|-------------|
| `list_strategies` | All 10 strategies with metadata |
| `build_polyglot` | Build ZIP → polyglot PDF (all strategies) |
| `extract_polyglot` | Extract canonical ZIP from polyglot PDF |
| `verify_polyglot` | Structural check (fast, no passphrase for encrypted) |
| `readable_sample` | Read N lines from text layer (fast direct-read, no extraction) |
| `get_capabilities` | Server info + tool list |

---

## Web UI — Polyglot Studio

Start the server and open `http://localhost:3000`.

Features:
- **Build tab**: Drag-and-drop ZIP, strategy grid, passphrase field (shown only for encrypted strategies), font/diagram/cruft/brotli toggles, live build log, download button
- **Extract tab**: Drag-and-drop PDF, **auto-detects strategy on upload** (passphrase field shown only when file is encrypted), Verify / Stats / Extract actions, file list, download button

---

## All 10 strategies

| Strategy | Description | True Polyglot | Passphrase |
|----------|-------------|:---:|:---:|
| `agent-readable` | **Recommended.** Full text layer + deduped binary store + Merkle tree + Module OS manifest. Text files readable by pdftotext/AI agents. | ✓ | — |
| `raw-polyglot-patched` | PDF prefix + patched ZIP offsets. Directly unzippable with `unzip` without any tool. | ✓ | — |
| `raw-polyglot-unpatched` | PDF prefix + original ZIP bytes. Needs offset-tolerant unzip. | ✓ | — |
| `pdf-attachment` | Spec-compliant `/EmbeddedFile` attachment. Works in all PDF viewers. | — | — |
| `xmp-embedded` | ZIP base64-encoded in XMP metadata stream. | — | — |
| `portfolio` | PDF Portfolio `/Collection`. Opens as portfolio in Acrobat. | — | — |
| `raw-polyglot-signed` | Like patched + SHA-256 integrity hash. Verified on extraction. | ✓ | — |
| `encrypted` | **AES-256-GCM** + **PBKDF2-SHA256** (600K iterations). Authenticated encryption. Wrong passphrase detected before any plaintext output. | — | **Required** |
| `chacha20-poly1305` | **ChaCha20-Poly1305** (RFC 8439 IETF). The TLS 1.3 cipher. Same security as AES-256-GCM, faster on ARM/no-AES-NI hardware. | — | **Required** |
| `rsa-signed` | **RSA-2048** + RSASSA-PKCS1-v1_5/SHA-256. Public key embedded in PDF; private key returned to caller only. | ✓ | — |

---

## Security

### Passphrase strategies — no silent defaults (v9.1 fix)

Prior to v9.1, omitting `--passphrase` with `encrypted` or `chacha20-poly1305` silently
used the string `"polyglot"` as the default. This was a security defect — data appeared
encrypted but was protected only by a known constant.

**v9.1 behavior**: Omitting the passphrase **throws an error**. There is no fallback.

### verify is always safe (v9.1 fix)

`verifyPolyglot` now uses **marker-only detection** for encrypted strategies — it scans for
a byte sequence in the PDF rather than attempting decryption. This means:

1. No PBKDF2 iterations during verification (instant, vs ~1 second before)
2. Encrypted files with **any** passphrase are correctly identified as `recognized: true`
3. No passphrase is needed to verify an encrypted polyglot PDF

### Security audit fixes (v3.x through v8.1)

| ID | Fix |
|----|-----|
| SEC-01 | Zip slip prevention — entry names sanitized |
| SEC-02 | Zip bomb: inflate capped at 256 MB |
| SEC-03 | Central directory size validation |
| SEC-04 | PDF FlateDecode bomb: inflate capped at 512 MB |
| SEC-06 | HTTP upload limit: 100 MB |
| SEC-08 | Canonical ZIP sanitizes all entry names |
| SEC-09 | Cover-page injection: control characters stripped |

### Cryptography details

**AES-256-GCM** (`encrypted`):
- PBKDF2-SHA256, 600,000 iterations, 16-byte random salt (NIST SP 800-132)
- AES-256-GCM (NIST SP 800-38D), 12-byte random IV, 16-byte auth tag
- Wrong passphrase or tampering detected before any plaintext is output

**ChaCha20-Poly1305** (`chacha20-poly1305`):
- Same PBKDF2 key derivation
- ChaCha20-Poly1305 RFC 8439 IETF variant, 12-byte nonce, 128-bit Poly1305 tag

**RSA-2048** (`rsa-signed`):
- Key pair generated fresh per file (SPKI/PKCS#8 PEM)
- RSASSA-PKCS1-v1_5 over SHA-256 digest of the ZIP bytes
- Public key embedded in PDF; private key returned to caller only
- Verify without shared secret: anyone with the PDF can authenticate

---

## Architecture

```
zip-to-pdf-polyglot-9.1.0/
├── src/                     Core library (zero runtime deps — pure Node built-ins)
│   ├── index.ts             Public API barrel export
│   ├── types.ts             All TypeScript types + StrategyName enum
│   ├── polyglot.ts          Strategy registry, buildPolyglot, extractPolyglot, verifyPolyglot
│   ├── bytes.ts             Low-level byte helpers (CRC, hex, PDF escaping)
│   ├── flate.ts             Zlib/Brotli wrappers + decompression bomb protection
│   ├── pdf-writer.ts        PDF 1.5 object model + XRef stream writer
│   ├── pdf-reader.ts        Minimal PDF parser (polyglot-specific)
│   ├── zip-reader.ts        ZIP parser: EOCD, central directory, Zip64, extract entry
│   ├── zip-writer.ts        Canonical ZIP writer with Zip64 support
│   ├── merkle.ts            SHA-256 Merkle integrity tree
│   ├── par.ts               PAR2-style blob store + error correction
│   ├── delta.ts             Atomic delta protocol
│   ├── merge.ts             Conflict resolution for branching deltas
│   ├── incremental.ts       Incremental update detection
│   ├── sharding.ts          Multi-shard polyglot PDFs
│   ├── agent-protocol.ts    Module OS manifest builder
│   ├── diagram.ts           File-tree diagram page
│   ├── images.ts            Image embedding (JPEG/PNG pages)
│   ├── font-subset.ts       TTF parser + subsetter for Unicode glyphs
│   └── strategies/          10 build/extract strategy modules
│       ├── agent-readable.ts
│       ├── raw-polyglot-patched.ts
│       ├── raw-polyglot-unpatched.ts
│       ├── pdf-attachment.ts
│       ├── xmp-embedded.ts
│       ├── portfolio.ts
│       ├── raw-polyglot-signed.ts
│       ├── encrypted.ts          AES-256-GCM + PBKDF2
│       ├── chacha20-poly1305.ts  ChaCha20-Poly1305 + PBKDF2
│       └── rsa-signed.ts         RSA-2048 asymmetric signing
├── cli.ts                   CLI (all 10 strategies, passphrase, json output)
├── server/index.ts          HTTP API server (Express + Multer — correct multipart)
├── mcp-server/index.ts      MCP server (JSON-RPC 2.0 stdio)
├── web/index.html           Polyglot Studio (standalone HTML, no framework)
├── test/basic.test.ts       Smoke tests: all 10 strategies + security invariants
├── package.json             v9.1.0, CJS, no "type":"module"
├── tsconfig.json            CommonJS, strict, no extension hacks
└── README.md
```

---

## Requirements

- **Node.js 18+** — uses native `node:crypto` (AES-GCM, ChaCha20, RSA, PBKDF2)
- **npm install** — installs `express`, `multer`, `cors` (server only), `tsx` + `typescript` (dev)
- **Core library** (`src/`) has **zero runtime dependencies** — all `node:*` built-ins

```bash
# Install dependencies
npm install

# Development — no build step needed
npx tsx cli.ts build archive.zip
npx tsx server/index.ts
npx tsx mcp-server/index.ts

# Run tests
npm test

# Production — build first
npm run build
node dist/cli.js build archive.zip
node dist/server/index.js
node dist/mcp-server/index.js
```

---

## License

MIT
