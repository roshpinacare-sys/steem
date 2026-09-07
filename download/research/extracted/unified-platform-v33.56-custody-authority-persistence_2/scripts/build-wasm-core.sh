#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/isolation/wasm-core/src"
OUT="$ROOT/isolation/wasm-core/artifacts"
mkdir -p "$OUT"
COMMON=(--target=wasm32 -O2 -nostdlib -Wl,--no-entry -Wl,--allow-undefined -Wl,--initial-memory=131072 -Wl,--max-memory=131072)
clang "${COMMON[@]}" -Wl,--export=run -o "$OUT/allowed.wasm" "$SRC/allowed.c"
clang "${COMMON[@]}" -Wl,--export=run -o "$OUT/malicious.wasm" "$SRC/malicious.c"
clang "${COMMON[@]}" -Wl,--export=run -o "$OUT/infinite.wasm" "$SRC/infinite.c"
sha256sum "$OUT"/*.wasm > "$OUT/SHA256SUMS"
