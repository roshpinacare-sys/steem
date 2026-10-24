# presence-matrix — multi-network display parity probe (read-only)

- at: 2026-10-24T07:44:52.825Z
- HEAD: 8bbc0eaeece2c0c81b16ddecd2f12317d3258a6d
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
| steemdb.io | SPA-PARITY | SPA-PARITY×14 | 0.8KB |

## per-account raw

| account | class | chain | steemit.com | steemitwallet.com | steemworld.org | steemscan.com | steemdb.io |
|---|---|---|---|---|---|---|---
| headcorner | fleet-master | 1178p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| cashmachine | fleet | 216p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| haran | fleet | 496p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| israelnews | fleet | 115p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| lsa | fleet | 213p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| macrame | fleet | 150p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| siq | fleet | 172p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| tov | fleet | 182p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| wic | fleet | 134p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| wog | fleet | 174p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| woq | fleet | 123p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| hcsoldier4 | fleet | 38p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| hcsoldier5 | fleet | 35p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| hcsoldier6 | fleet | 42p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| steem | control | 0p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| nasoe | control | 3351p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |
| marpa | control | 29555p | HTTP403 5.5KB | SPA-PARITY 59.5KB | SPA-PARITY 1.6KB | SPA-PARITY 1.0KB | SPA-PARITY 0.8KB |

## honest limits
- read-only probe: zero keys, zero broadcasts, zero writes outside the state dir
- page sizes are response byte counts, capped at 200KB per page (truncated flags where hit)
- SPA surfaces (wallet/steemworld/steemscan) render client-side from public APIs — SPA-PARITY means no server-side differential is measurable, not an endorsement of displayed content
- steemit.com differential is server-side at their origin (measured with cache-buster MISS on both fleet and controls, same IP/UA) — git cannot lift it; chain truth is the ledger
- instrument note: primary client is node fetch (undici); some edges TLS-fingerprint-block it (measured: uniform HTTP403 from sandbox). When a WHOLE surface comes back non-200 for fleet AND controls alike, the sweep is re-measured once via the system curl binary (still zero-dep, read-only, same UA/cache-buster) — the client per record is labeled. A uniform block is an instrument failure, not a differential; a fallback that still fails is reported as-is.
- steemdb.io is measured as served; when it is DOWN for fleet AND controls alike it is excluded from the alternates-parity boolean (parity on a dead surface would be a false claim)

