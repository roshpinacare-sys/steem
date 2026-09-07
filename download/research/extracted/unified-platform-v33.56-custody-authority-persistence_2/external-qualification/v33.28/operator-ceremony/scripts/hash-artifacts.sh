#!/usr/bin/env bash
set -euo pipefail
find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 sha256sum
