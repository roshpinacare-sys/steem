#!/usr/bin/env bash
# SOVEREIGN-WRITER-LAW v1 clause 8: PAT only via file-based credential helper.
# The token lives ONLY in the operator's upload/pat.env (gitignored mount) —
# never in git config, never in remote URLs, never echoed to output.
T=$(sed -E 's/^[A-Za-z_][A-Za-z0-9_]*=//' /home/z/my-project/upload/pat.env 2>/dev/null | tr -d '[:space:]')
if [ -z "$T" ]; then exit 1; fi
echo "username=roshpinacare-sys"
echo "password=$T"
