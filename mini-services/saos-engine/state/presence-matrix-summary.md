# presence-matrix — multi-network display parity probe (read-only)

- at: 2026-10-16T02:52:16.514Z
- HEAD: 108d9914fa2472ecdf64babdbbf78acf814daf47
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
| steemdb.io | SPA-DIVERGENT | SPA-DIVERGENT×10 ERR×4 | 42.8KB |

## per-account raw

| account | class | chain | steemit.com | steemitwallet.com | steemworld.org | steemscan.com | steemdb.io |
|---|---|---|---|---|---|---|---
| headcorner | fleet-master | 1147p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 52.5KB |
| cashmachine | fleet | 200p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 44.4KB |
| haran | fleet | 477p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 44.9KB |
| israelnews | fleet | 105p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 44.3KB |
| lsa | fleet | 195p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 43.7KB |
| macrame | fleet | 146p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 44.5KB |
| siq | fleet | 164p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 46.7KB |
| tov | fleet | 172p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 46.5KB |
| wic | fleet | 117p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (This operation was aborted) |
| wog | fleet | 161p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (This operation was aborted) |
| woq | fleet | 111p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (This operation was aborted) |
| hcsoldier4 | fleet | 20p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (This operation was aborted) |
| hcsoldier5 | fleet | 25p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 47.7KB |
| hcsoldier6 | fleet | 22p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 49.0KB |
| steem | control | 0p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 42.3KB |
| nasoe | control | 3343p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-DIVERGENT 43.4KB |
| marpa | control | 29548p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | ERR (This operation was aborted) |

## honest limits
- read-only probe: zero keys, zero broadcasts, zero writes outside the state dir
- page sizes are response byte counts, capped at 200KB per page (truncated flags where hit)
- SPA surfaces (wallet/steemworld/steemscan) render client-side from public APIs — SPA-PARITY means no server-side differential is measurable, not an endorsement of displayed content
- steemit.com differential is server-side at their origin (measured with cache-buster MISS on both fleet and controls, same IP/UA) — git cannot lift it; chain truth is the ledger
- instrument note: primary client is node fetch (undici); some edges TLS-fingerprint-block it (measured: uniform HTTP403 from sandbox). When a WHOLE surface comes back non-200 for fleet AND controls alike, the sweep is re-measured once via the system curl binary (still zero-dep, read-only, same UA/cache-buster) — the client per record is labeled. A uniform block is an instrument failure, not a differential; a fallback that still fails is reported as-is.
- steemdb.io is measured as served; when it is DOWN for fleet AND controls alike it is excluded from the alternates-parity boolean (parity on a dead surface would be a false claim)

