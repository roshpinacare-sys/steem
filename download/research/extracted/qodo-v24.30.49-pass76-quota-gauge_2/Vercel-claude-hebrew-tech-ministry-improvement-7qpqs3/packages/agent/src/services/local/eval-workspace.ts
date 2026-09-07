/**
 * eval-workspace.ts — a side-effect module that MUST be imported first in the
 * CLI's import graph. `pipeline/helpers.ts` freezes `WORKSPACE_ROOT` from
 * `process.env.QODO_WORKSPACE_ROOT` at module-load time, so to redirect the
 * `--eval` run's hash-chained audit log into an isolated temp dir (instead of
 * appending to the repo's own `.audit-log.ndjson`) the env var has to be set
 * before that module loads. ESM evaluates imports in source order, so placing
 * this as cli.ts's first import guarantees it wins the race.
 *
 * Inert unless the process was launched with `--eval` and the owner hasn't
 * already pinned a workspace root.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv.includes("--eval") && !process.env.QODO_WORKSPACE_ROOT) {
  process.env.QODO_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "qodo-eval-"));
}
