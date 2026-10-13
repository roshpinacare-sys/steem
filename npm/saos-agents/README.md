# saos-agents

**SAOS sovereignty gate — one command, every agent.** (דפוס-REA "אפס-חיכוך")

Registers the SAOS MCP server (6 tools) into Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, VSCode, OpenCode (+ honest manual instructions for Codex/TOML).

## Quick start

```bash
npx saos-agents setup            # plan first (nothing written)
npx saos-agents setup --yes      # apply — with automatic backup before every write
npx saos-agents mcp-config       # just print the JSON snippet
npx saos-agents doctor           # fail-closed install self-check
```

## The gate — 6 tools

| tool | answers |
|---|---|
| `saos_law` | the sovereignty law (AGENTS.md) + sandbox-distrust protocol |
| `saos_status` | live engine status, honest offline-with-remedy |
| `saos_doctor` | measured readiness verdict, fail-closed scopes |
| `saos_anchors` | on-chain custody anchors (Steem custom_json) |
| `saos_pnl` | public measured-vs-estimated return (Alpha-Arena pattern) |
| `saos_join` | how to join the sovereignty via the FF-only push gate |

## Hard laws

1. plan-before-action — no `--yes`, nothing written
2. backup before every write (`<path>.bak-saos-<ts>`)
3. additive + idempotent — touches only its own `saos` entry, never others'
4. `--uninstall` removes only its own entry
5. zero secrets in config — command/args only
6. zero dependencies — node builtins only

## Full engine

This package is the gate. The full sovereign engine (law corpus, on-chain anchoring, trading grid, public PnL) lives at <https://github.com/roshpinacare-sys/steem>.

*Evidence-first: every answer carries evidence or an honest refusal. No improvisation.*
