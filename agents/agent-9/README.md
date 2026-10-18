# agent-9 — sandbox-deletion insurance

Owner order (2026-10-18): "ודא דחיפה והכל שלא יעלם לנו עם הסנדבוקס שימחק"
— verify everything is pushed so nothing is lost if the sandbox is deleted.

Everything an agent-9 session needs to reconstruct itself after sandbox loss:

| file | purpose |
|---|---|
| `worklog.md` | full coordination memory — tasks 7→15, laws learned, all measurements |
| `sandbox-tools/*.mjs` | operational CLI tools (org search, workflow enable/wait/log/dispatch, owner commits, treasury/log forensics, sandbox restore drill) |
| `tools-manifest.md` | index of every tool — what it does, exact endpoint, how to run (read this first) |

**Restore drill (one command):** `node agents/agent-9/sandbox-tools/sandbox-restore.mjs` — checks creds/token/repos/worklog/insurance integrity; add `--fix` to actively restore. Source of the PAT if `.git-creds` is gone: `/home/z/my-project/upload/pat.env` (pointer only — never commit its content).

**Security:** every tool reads its token at RUNTIME from `/home/z/.git-creds`
(regex on the creds file) — zero embedded secrets (verified by scan before commit).
This directory must never receive raw credential material.

**Recovery law:** a fresh sandbox clone of this repo restores
(a) the worklog — what was done and why, (b) the tools — how to operate
the org from scratch. The organs themselves (builder, pacer, growth-watch,
scout, treasury, self-heal) live in `engine/` + `.github/workflows/` and run
on GitHub's VMs — they survive sandbox deletion by design.

## Incident log (honest, measured)

**2026-10-18 — reset #1, survived:** the sandbox re-initialized during the
session. Wiped: `/home/z/project-review` (both clones) and `/home/z/.git-creds`.
Survived: worklog (109 KB), all 20+ tools, `upload/pat.env`. Restore took
minutes: token rebuilt from `pat.env` → verified against private repo `steem`
→ both repos re-cloned → drill `sandbox-restore.mjs` written and verified
**PASS 8/8**. Meanwhile the organs on GitHub VMs never stopped: pacer beats
05:57→07:49 (including self-heal after one failed dispatch at 06:29), state
tick#386, verifier verdicts, office3d auto-bake on Domain — all live at
origin while the sandbox was down. **Conclusion: the insurance works as
designed.**

## Owner communication law

**No Chinese in reports. Ever.** Owner order (2026-10-18): "אל תכתוב בסינית
אני לא מבין כלום". All owner-facing output: Hebrew (technical English
allowed). This law is recorded in the worklog and must survive every reset.
