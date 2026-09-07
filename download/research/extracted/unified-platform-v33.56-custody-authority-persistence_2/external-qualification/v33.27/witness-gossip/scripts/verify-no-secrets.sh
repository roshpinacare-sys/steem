#!/usr/bin/env sh
set -eu
! grep -RIE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})' "$1"
