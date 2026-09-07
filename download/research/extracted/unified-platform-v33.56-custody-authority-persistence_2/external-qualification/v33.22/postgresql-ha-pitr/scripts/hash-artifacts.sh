#!/usr/bin/env bash
set -euo pipefail
root="${1:?artifact directory required}"
find "$root" -type l -print -quit | grep -q . && { echo "symlinks forbidden" >&2; exit 1; } || true
find "$root" -type f -print0 | sort -z | while IFS= read -r -d '' file; do
  relative="${file#"$root"/}"
  case "$relative" in /*|../*|*/../*) echo "unsafe path: $relative" >&2; exit 1;; esac
  bytes=$(wc -c < "$file" | tr -d ' ')
  digest=$(sha256sum "$file" | awk '{print $1}')
  printf '%s\t%s\t%s\n' "$digest" "$bytes" "$relative"
done
