# v12 Deterministic Performance Microbenchmarks

Generated: 2026-07-11T18:02:40.737Z

Deterministic local microbenchmarks. They are not production load tests and do not measure model or network latency.

| Operation | Iterations | P50 ms | P95 ms | P99 ms | Max ms |
|---|---:|---:|---:|---:|---:|
| validate_30_step_dag | 1000 | 0.0672 | 0.3139 | 0.6236 | 3.0002 |
| route_24_model_candidates | 2000 | 0.0297 | 0.0704 | 0.136 | 1.0274 |
| govern_200_memory_candidates | 500 | 1.484 | 2.37 | 2.9584 | 6.76 |
