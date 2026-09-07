#!/usr/bin/env bash
set -euo pipefail
file=${1:?package file required}
sha256sum "$file"
