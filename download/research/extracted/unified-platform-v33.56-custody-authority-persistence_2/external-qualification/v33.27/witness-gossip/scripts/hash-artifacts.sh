#!/usr/bin/env sh
set -eu
find "$1" -type f -print0 | sort -z | xargs -0 sha256sum
