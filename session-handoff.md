# Session Handoff — steem

## Blockers
- Owner-only keys (tov-hive, headcorner-hive): exist in no git folder, proven
  negative Task 13-a — only the owner closes this.
- Realized-revenue KPI: needs days of maturing receipts; cannot be rushed.

## Files
- `AGENTS.md` — landing protocol (read first, run init.sh second)
- `feature_list.json` / `progress.md` / this file — state layer
- `agent/vault/KEYS-ZIP-2026-09-29.zip.enc` + `recovery-meta.json` — custody
- `agent/keys/hed-soldiers-source.txt` — factory master sheet (owner doctrine)
- `agent/receipts/` — the proof trail (append-only)
- `agent/agent.cjs`, `agent/anchor.cjs`, tri-chain leg scripts

## Next Session
1. `git pull --rebase origin main` (receipt bot lands every 10–15 min).
2. `./init.sh` — red baseline? Repair before new scope.
3. Read README live-truth header + latest receipts; never re-do a closed tx.
4. One feature from `feature_list.json` to done-with-evidence.
5. Update state files; push rebase-first; zero secrets, verify-then-sign.
