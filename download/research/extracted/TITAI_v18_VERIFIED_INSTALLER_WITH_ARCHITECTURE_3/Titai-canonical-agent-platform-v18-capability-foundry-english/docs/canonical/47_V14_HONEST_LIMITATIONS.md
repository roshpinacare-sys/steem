# v14 Honest Limitations

## Release classification

**DEVELOPMENT ONLY**

v14 is substantially closer to a controlled pilot than v13, but it does not satisfy every mandatory pilot gate.

## Verified in this environment

- All nine canonical SQL migrations apply to a clean database.
- Historical migration drift is rejected.
- The complete repository suite passes through Node built-in SQLite.
- Process-level lease contention has one winner.
- Stale fencing tokens cannot checkpoint after takeover.
- Competing approval resolvers produce one persisted decision.
- Competing outbox publishers produce one claim and one publication.
- Database lock contention waits within the configured busy timeout and preserves both committed transactions.
- Disk-full simulation returns an explicit SQLite error and leaves no partial artifact row.
- Encrypted backup and clean restore preserve scoped rows, audit terminal hash, artifact hash, approval, receipt, and verification state.
- Injected restore interruption after target displacement restores the original target.
- The production build completes with bounded worker concurrency.
- Twenty-one of twenty-five labeled failure scenarios pass.
- The final archive can be created from manifest-listed source files and revalidated after extraction.

## Implemented but not independently accepted

- Dual SQLite driver selection.
- Canonical migration ledger.
- Updated seed scope creation.
- Expanded isolated CI lane.
- Local process-race and clean-restore harnesses.

The builder produced and tested these changes. A final verifier must still evaluate the frozen archive hash.

## Environment blocked

### Browser E2E

The installed Chromium is controlled by a managed `URLBlocklist` containing `*`. It blocks `http://localhost` before the application receives a request. The policy was not modified, disabled, or bypassed.

### Browser accessibility and visual regression

Keyboard, focus, screen-reader semantics, responsive screenshots, offline behavior, and visual-regression tests cannot be accepted from this host because browser navigation is blocked.

## Remaining failure-matrix gaps

- Browser tenant-switch attempt.
- Browser offline transition.
- Browser accessibility and responsive failure states.
- Final verifier mismatch or acceptance against the frozen ZIP hash.

## Dependency limitation

The installed Drizzle ORM remains below the repository's conservative static-Roast target. v14 does not change the version string without acquiring, reviewing, compiling, migrating, testing, and preserving rollback for the actual candidate package.

## Pilot safety boundary

The pilot remains limited to simulation and local artifact generation. Live remote model conversations are not restart-safe and remain unsupported.
