// Force stdout/stderr to be SYNCHRONOUS for spawned test processes so the
// micro-harness footer ("Passed: N / Failed: N") never gets lost when the
// process exits before libuv finishes flushing async pipe writes. The audit
// engine classifies a 0-test-output run as `cannotRun: did not execute`,
// which makes short, synchronous .test.ts files flaky under high concurrency.
// Setting the underlying stream to blocking eliminates that race.
//
// Safe under all conditions: blocking writes only affect this child process
// and only matter when stdout is a pipe (i.e., under the audit engine).
// Imported by every .test.ts via a single top-of-file import.
try {
  const so = process.stdout;
  const se = process.stderr;
  if (so && so._handle && typeof so._handle.setBlocking === "function") so._handle.setBlocking(true);
  if (se && se._handle && typeof se._handle.setBlocking === "function") se._handle.setBlocking(true);
} catch {
  /* best-effort — never let a flush hint break a test */
}
