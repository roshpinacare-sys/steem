/* SAOS GATE-LEASE (exec36, lane 36-a) — the single-winner verification lease.
 *
 * LAW PROVENANCE — exec36 verification-lease directive; registry number
 * PENDING R353+ (R353-candidate; grep-before-write registration belongs to
 * the registry lanes — exec35 closed with R353+ next-free, Pulse DECISIONS
 * #36). Pattern harvested from the modelcontextprotocol/servers gate-lease
 * (scripts/gate-lease.mjs + docs/quality-gate.md; 33-b dossier §2.2/§5.1 —
 * "atomic mkdir election, mtime-refreshed liveness, stale takeover for
 * crashed holders"), rebuilt sovereignty-native on node builtins:
 *   · ELECTION: fs.mkdirSync(leaseDir/purpose) IS the whole election —
 *     mkdir is atomic on a live filesystem; EEXIST = someone holds the
 *     lease. No lock file, no read-modify-write, no CAS gap. The parent
 *     leaseDir is created recursively (never the elected component itself:
 *     recursive mkdir would swallow the EEXIST that makes the election).
 *   · OWNERSHIP: the winner immediately labels the dir with owner.json
 *     {owner, purpose, acquiredAt, ttlMs, pid, host} — written ATOMICALLY
 *     (tmp + rename), with the JSON pre-serialized BEFORE the mkdir so the
 *     unlabeled window after a win is two syscalls wide, not a serializer.
 *   · LIVENESS (stale law, evaluated in this order): the holder is STALE
 *     when (1) owner.json is missing or unparseable, or (2) its shape is
 *     unrecognizable (no numeric acquiredAt / positive ttlMs), or
 *     (3) acquiredAt+ttlMs < now — works cross-host, or (4) same host only
 *     (hostname-checked) the holder pid is no longer alive
 *     (process.kill(pid,0); ESRCH ⇒ dead; EPERM ⇒ alive-not-ours).
 *     renewLease is the mtime-refresh equivalent: long holders renew or
 *     expire. ONE bounded stale-takeover attempt: the stale dir is claimed
 *     by ATOMIC RENAME to a trash name (two concurrent waiters cannot both
 *     claim it; the first renamer wins, the loser gets ENOENT), the trash
 *     is removed, and the election mkdir is retried exactly ONCE.
 *   · RELEASE is owner-checked: removing a lease you do not own is refused
 *     fail-closed (owner-mismatch); an unparseable owner file is refused
 *     too (owner-file-unreadable). Release is verified by readback (R340).
 *   · withLease orchestration: acquire → run async fn → release in finally.
 *     A not-granted caller gets {skipped:true, holder} — SKIP-NOT-FAIL
 *     (R339 non-blocking: contention is not an error); a fn error
 *     propagates honestly AFTER release.
 *   · Extends the R337 CAS lineage: CAS governs the IDENTITY of appends
 *     (grep-before-write); the lease governs PHYSICAL contention on shared
 *     verification resources (selftest/gates on the same tree). Different
 *     race class, complementary mechanisms.
 *
 * HONEST BOUNDARIES:
 *   · mkdir atomicity is same-filesystem — every contender must see the
 *     SAME leaseDir on ONE filesystem (never a per-process tmpdir).
 *   · pid-liveness is best-effort SAME-HOST only (hostname-checked);
 *     cross-host expiry relies on ttlMs alone. A dead holder's pid may be
 *     REUSED by an unrelated process — that reads "alive", so takeover
 *     waits for ttl (the safe direction: delay, never double-ownership).
 *     ESRCH can only mean "no such process on this host", never "alive
 *     elsewhere". Wall-clock arithmetic assumes sane NTP across hosts.
 *   · A sub-millisecond window remains between a winner's mkdir and its
 *     owner.json rename during which a concurrent waiter may read the dir
 *     as holder-less and take over — the same bound the upstream pattern
 *     accepts. The lease coordinates COOPERATING users of THIS module and
 *     does not make the critical section itself atomic; correctness-critical
 *     sections stay idempotent/CAS-guarded (R337). It is contention
 *     reduction, not a mutex against adversaries.
 *
 * CI WIRING HONESTY: this module SHIPS for callers; the engine selftest
 * does NOT wrap itself in a lease in this beat and the CI heartbeat does
 * not acquire one yet — wiring the verification gate to actually hold the
 * lease is a recorded future beat (exec36/36-a receipt).
 *
 * PAPER/INFRA LAYER ONLY: zero npm deps (node:fs, node:os, node:path),
 * zero keys, zero network, zero broadcasts, zero value movement.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* purpose is a single path component under leaseDir — allowlist-contained
 * (mcp path-validation discipline, 33-b §2.2): one segment, no separators,
 * no "..", no leading dot. Hostile input is refused fail-closed. */
const PURPOSE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_TTL_MS = 120000;

/* ── purpose allowlist (exec37 lane 37-a, R353 wiring; ADDITIVE entry only —
 * this export is the ONLY gate-lease.mjs edit of that lane) ────────────────
 * The production purposes registered to HOLD the verification gate. The
 * module's own grant law stays PURPOSE_RE fail-closed (48.16 hostile-refused,
 * byte-preserved); production callers MUST pick their purpose from this list
 * and check membership before acquiring (ci-cycle.mjs does exactly that —
 * an unregistered purpose can never hold the gate in a live beat).
 * "ci-selftest" = the heartbeat's lease-wrapped selftest critical section
 * (run selftest.mjs → verdict + run-marker written, R354). */
export const PURPOSE_ALLOWLIST = Object.freeze(["ci-selftest"]);

const validTtl = (n) => Number.isInteger(n) && n > 0;
const validPid = (n) => Number.isInteger(n) && n > 0;

const ownerFileOf = (dir) => path.join(dir, "owner.json");

function readHolder(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/* ── stale law (header) — order matters: shape → ttl → same-host pid ── */
function holderIsStale(holder, now) {
  if (!holder || typeof holder !== "object") return true; // missing/unparseable
  if (!validTtl(holder.ttlMs) || typeof holder.acquiredAt !== "number") return true; // unrecognizable shape
  if (now > holder.acquiredAt + holder.ttlMs) return true; // expired (cross-host safe)
  if (holder.host === os.hostname() && validPid(holder.pid)) { // same-host liveness only
    try { process.kill(holder.pid, 0); } catch (e) { if (e?.code === "ESRCH") return true; /* EPERM: alive, not ours */ }
  }
  return false;
}

const holderInfo = (h) => (h && typeof h === "object"
  ? { owner: h.owner ?? null, acquiredAt: h.acquiredAt ?? null, ttlMs: h.ttlMs ?? null, pid: h.pid ?? null, host: h.host ?? null }
  : null);

function leaseObj({ leaseDir, purpose, dir, owner, ttlMs, acquiredAt }) {
  return Object.freeze({ leaseDir, purpose, dir, file: ownerFileOf(dir), owner, ttlMs, acquiredAt, pid: process.pid, host: os.hostname() });
}

/* owner.json is written ATOMICALLY (tmp + rename); the JSON is handed in
 * pre-serialized so the winner's unlabeled window stays minimal. */
function commitOwner(dir, json) {
  const file = ownerFileOf(dir);
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    return false;
  }
}

const ownerJson = (lease) => JSON.stringify(
  { owner: lease.owner, purpose: lease.purpose, acquiredAt: lease.acquiredAt, ttlMs: lease.ttlMs, pid: process.pid, host: os.hostname() },
  null, 2
);

/* ── 1 · acquireLease — single-winner election with ONE stale takeover ── */
export function acquireLease({ leaseDir, purpose, ttlMs = DEFAULT_TTL_MS, owner, now = Date.now() }) {
  if (typeof leaseDir !== "string" || leaseDir.length === 0) return { granted: false, error: "leaseDir-required" };
  if (typeof purpose !== "string" || !PURPOSE_RE.test(purpose)) return { granted: false, error: "purpose-not-allowlisted" };
  if (typeof owner !== "string" || owner.length === 0) return { granted: false, error: "owner-required" };
  if (!validTtl(ttlMs)) return { granted: false, error: "ttl-invalid" };

  const dir = path.join(leaseDir, purpose);
  const json = ownerJson({ owner, purpose, ttlMs, acquiredAt: now }); // pre-serialized BEFORE the election

  try { fs.mkdirSync(leaseDir, { recursive: true }); } catch { /* parent best-effort; the elected mkdir surfaces real errors */ }

  // THE ELECTION — plain mkdir, recursive:false, so EEXIST is meaningful.
  let won = false, mkdirErr = null;
  try { fs.mkdirSync(dir); won = true; } catch (e) { mkdirErr = e; }
  if (!won && mkdirErr?.code !== "EEXIST") return { granted: false, error: `mkdir-failed:${mkdirErr?.code ?? String(mkdirErr)}` };

  if (won) {
    const lease = leaseObj({ leaseDir, purpose, dir, owner, ttlMs, acquiredAt: now });
    if (!commitOwner(dir, json)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort: never hand out an unlabeled lease */ }
      return { granted: false, error: "owner-write-failed" };
    }
    return { granted: true, lease, tookOver: false, prevOwner: null };
  }

  // CONTENTION — read the holder, apply the stale law.
  const holder = readHolder(ownerFileOf(dir));
  if (!holderIsStale(holder, now)) return { granted: false, holder: holderInfo(holder) };

  // STALE TAKEOVER — atomic rename-claim, rm trash, retry mkdir ONCE.
  const trash = `${dir}.stale.${process.pid}.${now}`;
  try { fs.renameSync(dir, trash); } catch { /* another waiter claimed it first — ENOENT */ }
  try { fs.rmSync(trash, { recursive: true, force: true }); } catch { /* best-effort cleanup of stale bytes */ }

  let rewon = false, remkdirErr = null;
  try { fs.mkdirSync(dir); rewon = true; } catch (e) { remkdirErr = e; }
  if (!rewon && remkdirErr?.code !== "EEXIST") return { granted: false, error: `takeover-mkdir-failed:${remkdirErr?.code ?? String(remkdirErr)}`, prevOwner: holder?.owner ?? null };
  if (!rewon) { // lost the takeover race to another waiter — honest not-granted with the NEW holder
    const nh = readHolder(ownerFileOf(dir));
    return { granted: false, error: "takeover-race-lost", prevOwner: holder?.owner ?? null, holder: holderIsStale(nh, now) ? null : holderInfo(nh) };
  }
  const lease = leaseObj({ leaseDir, purpose, dir, owner, ttlMs, acquiredAt: now });
  if (!commitOwner(dir, json)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return { granted: false, error: "owner-write-failed", prevOwner: holder?.owner ?? null };
  }
  return { granted: true, lease, tookOver: true, prevOwner: holder?.owner ?? null };
}

/* ── 2 · renewLease — the mtime-refresh equivalent (renew or expire) ── */
export function renewLease(lease, { now = Date.now() } = {}) {
  try {
    if (!lease || typeof lease !== "object" || typeof lease.dir !== "string" || typeof lease.owner !== "string") return { renewed: false, reason: "lease-invalid" };
    const holder = readHolder(ownerFileOf(lease.dir));
    if (!holder || typeof holder !== "object") return { renewed: false, reason: "holder-file-unreadable" };
    if (holder.owner !== lease.owner) return { renewed: false, reason: "owner-mismatch" };
    const json = ownerJson({ owner: lease.owner, purpose: lease.purpose ?? holder.purpose, ttlMs: validTtl(lease.ttlMs) ? lease.ttlMs : holder.ttlMs, acquiredAt: now });
    if (!commitOwner(lease.dir, json)) return { renewed: false, reason: "owner-write-failed" };
    return { renewed: true, lease: Object.freeze({ ...lease, acquiredAt: now }) };
  } catch (e) {
    return { renewed: false, reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/* ── 3 · releaseLease — owner-checked removal with readback (R340) ── */
export function releaseLease(lease) {
  try {
    if (!lease || typeof lease !== "object" || typeof lease.dir !== "string" || typeof lease.owner !== "string") return { released: false, reason: "lease-invalid" };
    if (!fs.existsSync(lease.dir)) return { released: true, note: "already-absent" };
    const holder = readHolder(ownerFileOf(lease.dir));
    if (!holder || typeof holder !== "object") return { released: false, reason: "owner-file-unreadable" };
    if (holder.owner !== lease.owner) return { released: false, reason: "owner-mismatch" };
    fs.rmSync(lease.dir, { recursive: true, force: true });
    return fs.existsSync(lease.dir) ? { released: false, reason: "release-readback-failed" } : { released: true };
  } catch (e) {
    return { released: false, reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/* ── 4 · withLease — acquire (one stale-takeover attempt) → fn → release ──
 * Not-granted ⇒ {skipped:true, holder} — callers treat skip as
 * SKIP-NOT-FAIL (R339 non-blocking). fn errors propagate honestly after
 * the finally-release. */
export async function withLease({ leaseDir, purpose, ttlMs, owner, now, fn }) {
  if (typeof fn !== "function") throw new Error("withLease: fn-required");
  const acq = acquireLease({ leaseDir, purpose, ttlMs, owner, now });
  if (!acq.granted) return { skipped: true, holder: acq.holder ?? null, error: acq.error ?? null };
  try {
    const result = await fn(acq.lease);
    return { skipped: false, result };
  } finally {
    releaseLease(acq.lease);
  }
}
