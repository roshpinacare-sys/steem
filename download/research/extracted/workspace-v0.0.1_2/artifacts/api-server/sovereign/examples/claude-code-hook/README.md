# TFA Trust Gate — Claude Code PreToolUse Hook

> **Wedge #1**: Gate every dangerous tool call through TFA automatically —
> zero changes to your AI system or tool implementations.

---

## What this does

This hook intercepts every tool call in Claude Code **before** it executes.
For dangerous operations (file deletion, shell commands, DB migrations, etc.)
it automatically calls TFA's `tfa_simulate_action` to get a risk prediction:

- **Allowed** → tool proceeds normally
- **Approval required / Denied** → tool is blocked; TFA prints the reason + receipt

The result: every Claude Code session is automatically TFA-gated, with a tamper-evident audit trail for every blocked or approved dangerous action.

---

## Installation (2 minutes)

```bash
# 1. Copy the hook into your Claude Code hooks directory
cp examples/claude-code-hook/tfa-pre-tool-use.mjs ~/.claude/hooks/
chmod +x ~/.claude/hooks/tfa-pre-tool-use.mjs

# 2. Register the hook in Claude Code
# In your project's .claude/settings.json (or global ~/.claude/settings.json):
cat >> .claude/settings.json << 'EOF'
{
  "hooks": {
    "PreToolUse": ["~/.claude/hooks/tfa-pre-tool-use.mjs"]
  }
}
EOF

# 3. Configure TFA connection
export TFA_BASE_URL=https://tfa.example.com   # your TFA server
export TFA_TENANT_ID=my-org
export TFA_API_KEY=key_live_xxxx              # optional

# 4. (Optional) Test in dry-run mode first — logs decisions but always allows
export TFA_DRY_RUN=true
```

---

## Risk tiers

The hook classifies every tool call before deciding whether to gate it:

| Tier | Description | Action |
|------|-------------|--------|
| 0 | Safe read-only tools (ReadFile, ls, GrepTool, WebSearch, …) | Always allow — **zero latency overhead** |
| 1 | Low-risk writes (WriteFile to non-sensitive paths) | Allow (with optional advisory) |
| 2 | Medium risk (Bash with side-effects, git operations) | TFA simulate |
| 3 | High risk (rm, kill, psql, DB commands, sensitive paths) | TFA simulate — strict policy |
| 4 | Critical (shutdown, format, production deploy) | TFA simulate — always requires explicit approval |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TFA_BASE_URL` | `http://localhost:7700` | TFA server URL |
| `TFA_TENANT_ID` | `default` | Tenant identifier |
| `TFA_API_KEY` | *(none)* | API key for authenticated TFA instances |
| `TFA_ACTOR_ID` | `claude-code` | Actor ID recorded in audit trail |
| `TFA_DRY_RUN` | `false` | Log decisions but always allow (testing mode) |
| `TFA_TIMEOUT_MS` | `3000` | HTTP timeout per TFA call (ms) |
| `TFA_VERBOSE` | `false` | Log every decision to stderr |

---

## Fail-open policy

The hook **never blocks** if TFA is unreachable. If `TFA_BASE_URL` is down
or the request times out, the tool is allowed with an advisory message.
This ensures TFA is a trust gate, not a single point of failure.

---

## Example interaction

```
Claude wants to run: rm -rf ./node_modules && npm install

[TFA] 🚫 DENIED: Bash
  Risk class: write_destructive
  Reason: Bash command matches dangerous pattern: rm -rf ./node_modules
  Blast radius: high
  Reversible: false
  To proceed: call tfa_approve_execution with the returned approvalToken,
  or set TFA_DRY_RUN=true to run in advisory-only mode.
```

---

## How it integrates with TFA's MCP tools

Once blocked, Claude Code can call TFA's MCP tools directly to proceed:

```
# Get a TFA-signed receipt for manual approval:
tfa_simulate_action → see risk prediction
tfa_check_action    → get formal decision
tfa_approve_execution (with human approval token) → proceed with audit trail
```

The hook, the MCP tools, and the CLI all use the same TFA server — every
decision produces the same tamper-evident `ExecutionReceipt` whether initiated
via hook, MCP, or CLI.

---

## Customizing the risk taxonomy

Edit `DANGEROUS_BASH_PATTERNS` and `SENSITIVE_PATH_PATTERNS` in
`tfa-pre-tool-use.mjs` to match your organization's risk posture.
All changes are local — no TFA server update needed.
