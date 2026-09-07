#!/usr/bin/env bash
set -euo pipefail
package=${1:?offline package JSON required}
policy=${2:?pinned trust policy JSON required}
node scripts/verify-offline-evidence-package-v33_23.mjs "$package" "$policy"
