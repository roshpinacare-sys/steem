# Migration Guide: v7.0 → v8.1

This guide covers the breaking changes introduced between v7.0 and v8.1 of
the SRS Runtime. For each change we show the old behaviour, the new
behaviour, and how to update calling code.

## Breaking Changes

### v7.2: AdviceTable.lookup signature changed
- BEFORE: `advice.lookup(hyps)` — returns advice for any target
- AFTER: `advice.lookup(hyps, target_idx)` — returns advice only for specific target
- Migration: add `target_idx` argument to all lookup calls

### v7.3: Task payload validation
- Tasks now require `n_features` in payload for identify-like kinds
- Tasks reject unknown kinds, out-of-range `target_idx`, `n_features > 64`
- Migration: add `n_features` to all `Task` payloads

### v7.4: Compression work_units increased
- C `work_units` went from 32 (fraud) to 4128 (real scoring)
- Migration: update any assertions on `work_units`

### v7.6: Snapshot format changed
- `advice_hash` field replaced by `snapshot_hash` (covers full payload)
- `timestamp` changed from epoch float to ISO 8601 string
- Old snapshots are auto-migrated on load (`advice_hash` verified, then upgraded)

### v7.8: task_id sanitization
- `task_id`s containing `/`, `..`, null bytes, control chars are now sanitized
- Custom `task_id`s are replaced with sanitized versions
- Migration: use only `[a-zA-Z0-9_-]` in `task_id`s

### v8.0: SafeJSONDecoder regex (R20 optimization #2)
- BEFORE: `SafeJSONDecoder` used a char-by-char pre-scan to count
  nesting depth before parsing. Slow (~544µs per 20KB load) and
  required a size gate to avoid quadratic time on large payloads.
- AFTER: `SafeJSONDecoder` uses a regex (`re module`, runs in C) to
  count depth. ~10× faster (~50µs per 20KB load) and no size gate
  needed (regex is fast enough for all payload sizes up to
  `MAX_SNAPSHOT_SIZE = 10 MB`).
- Migration: external code that relied on the size gate (e.g.
  pre-truncating payloads above a threshold) is no longer needed —
  the decoder handles all sizes up to `MAX_SNAPSHOT_SIZE` natively.
  No code changes required for callers using `json.load(..., cls=SafeJSONDecoder)`.

### v8.0: AdviceTable thread-safe (R6.6/R6.7/R6.15 fix)
- BEFORE: `AdviceTable` had no internal lock. Concurrent
  `build_for_identify` / `lookup` / `lookup_any_target` calls relied
  on the GIL for atomicity. Under no-GIL Python (3.13t+) or under
  mixed read/write workloads on CPython, races could lose advice
  writes or return stale entries.
- AFTER: All `AdviceTable` read/write methods take `self._lock`
  (a `threading.Lock`). `lookup_any_target` snapshots the table with
  `list(self._table.items())` before iterating. `improvement.improve()`
  uses `advice._lock` for check-then-set atomicity.
- Migration: external code that held a reference to `advice._table`
  and mutated it directly must now acquire `advice._lock` (or,
  preferably, use the public `advice.add()` / `advice.lookup()` API).
  Reading `advice._table` without the lock is still safe under the
  GIL but is now formally a data race.

### v8.1: AdviceTable._fingerprint cached (R20 optimization #4)
- BEFORE: `_fingerprint(hypotheses: list[bytes])` re-computed the
  SHA-256 + struct.pack loop on every call. For a 64-element hyps
  list, this was ~25µs per call; called 3× per execute() (build +
  lookup + lookup_any_target in the worst case), it totalled ~75µs.
- AFTER: `_fingerprint(hypotheses: tuple[bytes, ...])` is wrapped in
  `@lru_cache(maxsize=128)`. The cache key is a `tuple` (hashable)
  rather than a `list` (unhashable). Callers convert via
  `tuple(hypotheses)` before invoking.
- Migration: external code that called `_fingerprint(list_of_bytes)`
  directly must now pass `tuple(list_of_bytes)`. The public API
  (`build_for_identify`, `lookup`, `lookup_any_target`) is unchanged —
  they convert internally. Direct callers of `_fingerprint` (rare)
  should also call `.cache_clear()` if they mutate the hypotheses
  list in place (which they shouldn't — bytes are immutable).

### v8.1: Debug log calls gated behind `isEnabledFor(DEBUG)` (R20 optimization #5)
- BEFORE: every `logger.debug("...", _safe_log_value(x))` call
  eagerly invoked `_safe_log_value(x)` to sanitize the argument,
  even when the DEBUG level was disabled (the common case). Each
  call did a per-char control-char scan and allocated a new str.
- AFTER: every `logger.debug(...)` call in `runtime.py` that
  interpolates a `_safe_log_value(...)` result is wrapped in
  `if logger.isEnabledFor(logging.DEBUG):`. On the default INFO
  path, the sanitizer is never invoked.
- Migration: external code that subclasses `Runtime` and overrides
  `execute()` / `recover()` / `store_state()` should follow the same
  pattern (gate `_safe_log_value` behind `isEnabledFor(DEBUG)`).
  No public API change.

### v8.1: sequence.json deletion protection (R17 known weakness)
- BEFORE: the high-water sequence number lived only in
  `~/.srs/snapshots/sequence.json`. An attacker with snapshots-dir
  write access could delete `sequence.json` to reset the high-water
  mark to 0, then write a `latest.json` pointing at an old snapshot
  and bypass the rollback check entirely.
- AFTER: the high-water mark is also mirrored to
  `~/.srs/secret_key.seq` (an HMAC-protected file in the same
  directory as the secret key, OUTSIDE the snapshots dir).
  `_get_high_water_sequence` consults the snapshots-dir file first
  (for compatibility), but if it's missing OR tampered, falls back
  to the mirror. The mirror is updated on every `save()` alongside
  the in-snapshots-dir copy.
- Migration: external code that reads `~/.srs/snapshots/sequence.json`
  directly should switch to `persistence._get_high_water_sequence(home)`.
  External code that deletes `~/.srs/snapshots/` to "reset" the
  runtime (e.g. test fixtures) should also delete
  `~/.srs/secret_key.seq` to fully reset the high-water mark.

