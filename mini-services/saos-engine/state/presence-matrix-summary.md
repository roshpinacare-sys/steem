# presence-matrix — multi-network display parity probe (read-only)

- at: 2026-10-14T02:40:09.796Z
- HEAD: ee995009ea4b770c7c2dddf59b1c4f927b99d230
- roster source: army-social.mjs:import · fleet 14 (master headcorner + 13 army) · controls steem/nasoe/marpa
- chain layer: ok via condenser_api.get_accounts

FLEET 14: steemit.com=SHELL · alternates=SPA-PARITY · chain=14/14
CONTROLS 3: steemit.com=SHELL-OR-DEGRADED (fleet shells=14/14; controls not all FULL: SHELL,FULL,FULL) · chain=3/3

| surface | verdict (surface) | fleet counts | control median bytes |
|---|---|---|---|
| steemit.com | SHELL-OR-DEGRADED (fleet shells=14/14; controls not all FULL: SHELL,FULL,FULL) | SHELL×14 | 254.9KB |
| steemitwallet.com | SPA-PARITY | SPA-PARITY×14 | 59.5KB |
| steemworld.org | SPA-PARITY | SPA-PARITY×14 | 1.6KB |
| steemscan.com | SPA-PARITY | SPA-PARITY×14 | 1.0KB |
| steemdb.io | DOWN (every probe failed or non-200 — honest tombstone) | ERR×14 | — |

## per-account raw

| account | class | chain | steemit.com | steemitwallet.com | steemworld.org | steemscan.com | steemdb.io |
|---|---|---|---|---|---|---|---
| headcorner | fleet-master | 1137p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| cashmachine | fleet | 200p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| haran | fleet | 477p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| israelnews | fleet | 105p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| lsa | fleet | 195p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| macrame | fleet | 146p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| siq | fleet | 164p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| tov | fleet | 172p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| wic | fleet | 117p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| wog | fleet | 161p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| woq | fleet | 111p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| hcsoldier4 | fleet | 20p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| hcsoldier5 | fleet | 25p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| hcsoldier6 | fleet | 22p | SHELL 52.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| steem | control | 0p | SHELL 52.8KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| nasoe | control | 3341p | FULL 254.9KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| marpa | control | 29547p | FULL 367.2KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |

## honest limits
- read-only probe: zero keys, zero broadcasts, zero writes outside the state dir
- page sizes are response byte counts, capped at 200KB per page (truncated flags where hit)
- SPA surfaces (wallet/steemworld/steemscan) render client-side from public APIs — SPA-PARITY means no server-side differential is measurable, not an endorsement of displayed content
- steemit.com differential is server-side at their origin (measured with cache-buster MISS on both fleet and controls, same IP/UA) — git cannot lift it; chain truth is the ledger
- instrument note: primary client is node fetch (undici); some edges TLS-fingerprint-block it (measured: uniform HTTP403 from sandbox). When a WHOLE surface comes back non-200 for fleet AND controls alike, the sweep is re-measured once via the system curl binary (still zero-dep, read-only, same UA/cache-buster) — the client per record is labeled. A uniform block is an instrument failure, not a differential; a fallback that still fails is reported as-is.
- steemdb.io is measured as served; when it is DOWN for fleet AND controls alike it is excluded from the alternates-parity boolean (parity on a dead surface would be a false claim)

