# Sovereign Resume Queue — removing the Redis dependency

## Why

The ADR-005 resume loop (`/qodo proceed`, webhook PR/check-suite events →
dispatch the agent pipeline on the right PR) was backed **only** by Upstash
Redis. That made a managed third-party the hard prerequisite for the whole
resume mechanism: no Upstash → the drain job crashed at env validation, and
there was no queue at all. A fork, an air-gapped deploy, or anyone unwilling to
rent Redis simply could not run it.

This document describes the sovereign replacement: **build what Redis did for us
in-house, and make the external service optional.**

## The calculation — what Redis actually provided

The resume queue never needed a database. Auditing `RedisTriggerQueue`, it uses
exactly **two primitives**:

1. **Atomic list operations** — `LPUSH` (enqueue), `LMOVE` RIGHT→LEFT (atomic
   pop into a processing list), `LREM` (targeted removal), `LRANGE`/`LLEN`
   (introspection). Three lists: `queue`, `processing`, `dead`.
2. **A durable key with a TTL** — the per-task ack (`SET … EX`) the resumed run
   writes at its first checkpoint, read back by the reaper.

Crucially, the queue was already written against a **narrow 7-method interface**
(`RedisListOps`), not against Redis directly (ADR-001: interfaces at the point of
consumption). That interface *is* the seam. Replacing Redis means implementing
those 7 methods over a substrate we already own and cannot lose.

## The substrate — what we already own

We depend, unavoidably, on **GitHub**: the repo, the Actions runner, the API,
our token. So the sovereign substrate is a two-layer model, both implementing
the same `RedisListOps`/`DurableListOps` contract:

| Layer | Implementation | Durability | Status |
|------|----------------|-----------|--------|
| Working copy | `FileDurableStore` (filesystem) | Within a run / on a persistent disk | **Shipped (Step 1)** |
| Durable backend | `GitRefQueue` (a dedicated Git ref) | Forever, replicated by GitHub | **Shipped (Step 2)** |
| Optional adapter | Upstash Redis | Managed | Kept, no longer required |

### `FileDurableStore` (Step 1 — shipped)

A dependency-free filesystem implementation of the durable store
(`src/services/sovereign-store.ts`):

- Lists are JSON arrays under `root/l/<b64url(key)>`, index 0 = the LEFT end, so
  Redis list orientation (LPUSH prepends, RIGHT is oldest) is preserved exactly.
- Ack keys are `{ v, exp }` entries under `root/k/<b64url(key)>`, with lazy
  TTL expiry on read.
- Every write is **write-temp-then-rename**, so a crash mid-write can never tear
  a file — a reader sees the old bytes or the new bytes, never a half.
- A **mkdir-based mutex** (`root/.lock/`) makes each operation atomic even across
  concurrent processes. `mkdir` is atomic on POSIX and Windows; a stale lock from
  a crashed holder is force-broken after a short deadline so the queue can never
  wedge.

The same `RedisTriggerQueue` runs over it unchanged — it is store-agnostic and
also exported as `StoreTriggerQueue`. Redis becomes just one possible backend.

The four Invariant #12 reliability contracts (no-loss-on-crash-before-ack,
no-duplicate-on-crash-after-ack, poison→dead-letter, FIFO) are proven against
the filesystem substrate in `tests/sovereign-queue.test.ts`, mirroring the Redis
coverage in `resume-loop.test.ts`.

## The drain, now sovereign

`node dist/cli.js --drain-trigger-queue`:

- Runs **before** `validateAndCoerce()`, so a fork without secrets never crashes
  on missing env (the old failure mode).
- Selects the substrate automatically: **Redis** when `UPSTASH_REDIS_REST_URL` +
  `_TOKEN` are set, otherwise the **filesystem** store at `QODO_QUEUE_DIR`
  (default `.qodo/trigger-queue`).
- Falls back to **reap-only** when there is no `GITHUB_TOKEN` — reconciliation
  needs no credentials and dispatch has nowhere to go without a token.

Result: the drain workflow is green with **zero external services and zero
secrets**, and fully functional the moment either a token (to dispatch) or Redis
(to share state) is supplied.

## Step 2 — cross-tick durability via a Git ref (shipped)

The drain runs on a `schedule:` every 2 minutes in an **ephemeral** runner, so a
plain `FileDurableStore` starts empty each tick. `GitRefQueue`
(`src/services/git-ref-store.ts`) makes the queue durable *between* ticks with
no external service:

1. `syncDown(ref)` — materialize a dedicated ref (default
   `refs/qodo/trigger-queue`) into a `FileDurableStore` working copy.
2. Run the drain (reap + pop + dispatch) against that working copy.
3. `persist()` → commit and push back. **The push is the compare-and-swap** — a
   non-fast-forward rejection means another writer moved the ref, so `persist()`
   returns `"conflict"` and the drain leaves it for the next tick.

GitHub becomes the sole durable backend — the same trust root we already depend
on — with the whole queue history visible as commits (strictly more auditable
than opaque Redis). Enabled by setting `QODO_QUEUE_GIT_REF` with a token that
has `contents` + `actions` scope; without it the drain falls back to the
ephemeral filesystem store (Step 1). The Git plumbing sits behind a `GitRunner`
seam and is proven end-to-end against a real local bare repo in
`tests/git-ref-store.test.ts` — no network, no GitHub.

### Correctness under concurrency

- **Consumer/consumer:** the workflow's `concurrency` group
  (`cancel-in-progress: false`) guarantees a single drainer at a time, so two
  drains never race the ref.
- **Producer/consumer:** a producer enqueue during a drain tick makes the
  drain's push a `"conflict"`; the drain does not force, and reconciles next
  tick. Any dispatch that already fired is **safe to repeat** because the
  resumed pipeline is idempotent behind its run lock — the same guarantee the
  webhook receiver already relies on ("duplicate deliveries are safe").

### Producer options (no Redis required)

The webhook receiver (`worker/webhook-receiver.js`) already has a Redis-free
producer path: **Option C** dispatches the agent-pipeline workflow directly via
the GitHub API (`workflow_dispatch`), no queue at all — the simplest sovereign
choice for the stateless Worker. The Redis LPUSH (Option B) is now legacy; the
buffered, reaper-backed path is the Git-ref queue drained here. A Cloudflare
Worker cannot run `git`, so a future enqueue-to-ref producer would use the
GitHub Git Data API (append a task blob, update the ref with the expected SHA as
the CAS) — tracked as follow-up; Option C covers the zero-infra case today.
