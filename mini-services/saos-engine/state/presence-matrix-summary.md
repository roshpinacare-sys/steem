# presence-matrix — multi-network display parity probe (read-only)

- at: 2026-10-20T23:46:43.123Z
- HEAD: 6f66c2c8c4da7fa0814584e51d221ddaa9b7f4bf
- roster source: army-social.mjs:import · fleet 14 (master headcorner + 13 army) · controls steem/nasoe/marpa
- chain layer: ok via condenser_api.get_accounts

FLEET 14: steemit.com=MIXED · alternates=SPA-PARITY · chain=14/14
CONTROLS 3: steemit.com=MIXED/DEGRADED (fleet FULL=0/14; controls: HTTP403,HTTP403,HTTP403) · chain=3/3

| surface | verdict (surface) | fleet counts | control median bytes |
|---|---|---|---|
| steemit.com | MIXED/DEGRADED (fleet FULL=0/14; controls: HTTP403,HTTP403,HTTP403) | HTTP403×14 | — |
| steemitwallet.com | SPA-PARITY | SPA-PARITY×14 | 59.5KB |
| steemworld.org | SPA-PARITY | SPA-PARITY×14 | 1.6KB |
| steemscan.com | SPA-PARITY | SPA-PARITY×14 | 1.0KB |
| steemdb.io | SPA-PARITY | ERR×4 SPA-PARITY×6 HTTP500×4 | 44.4KB |

## per-account raw

| account | class | chain | steemit.com | steemitwallet.com | steemworld.org | steemscan.com | steemdb.io |
|---|---|---|---|---|---|---|---
| headcorner | fleet-master | 1163p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| cashmachine | fleet | 207p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| haran | fleet | 488p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| israelnews | fleet | 109p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (curl-exit-28: Command failed: curl -sS -) |
| lsa | fleet | 202p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 45.3KB |
| macrame | fleet | 147p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | HTTP500 12.2KB |
| siq | fleet | 169p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | HTTP500 7.7KB |
| tov | fleet | 175p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 45.3KB |
| wic | fleet | 119p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 44.2KB |
| wog | fleet | 164p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | HTTP500 24.5KB |
| woq | fleet | 111p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 45.3KB |
| hcsoldier4 | fleet | 28p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 48.3KB |
| hcsoldier5 | fleet | 27p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 45.4KB |
| hcsoldier6 | fleet | 22p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | HTTP500 7.7KB |
| steem | control | 0p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 39.6KB |
| nasoe | control | 3347p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 44.4KB |
| marpa | control | 29552p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 46.4KB |

## honest limits
- read-only probe: zero keys, zero broadcasts, zero writes outside the state dir
- page sizes are response byte counts, capped at 200KB per page (truncated flags where hit)
- SPA surfaces (wallet/steemworld/steemscan) render client-side from public APIs — SPA-PARITY means no server-side differential is measurable, not an endorsement of displayed content
- steemit.com differential is server-side at their origin (measured with cache-buster MISS on both fleet and controls, same IP/UA) — git cannot lift it; chain truth is the ledger
- instrument note: primary client is node fetch (undici); some edges TLS-fingerprint-block it (measured: uniform HTTP403 from sandbox). When a WHOLE surface comes back non-200 for fleet AND controls alike, the sweep is re-measured once via the system curl binary (still zero-dep, read-only, same UA/cache-buster) — the client per record is labeled. A uniform block is an instrument failure, not a differential; a fallback that still fails is reported as-is.
- steemdb.io is measured as served; when it is DOWN for fleet AND controls alike it is excluded from the alternates-parity boolean (parity on a dead surface would be a false claim)

