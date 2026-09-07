#!/usr/bin/env bash
set -euo pipefail
if grep -RIE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})' .; then exit 1; fi
