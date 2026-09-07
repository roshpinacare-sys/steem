# Architecture Report — v32.0.0

Method: static scan over `src/lib/**/*.ts` using the v30 fitness harness
(`src/lib/fitness/`) plus a v32.0.0 certification runner.

| Metric                    | Threshold        | Observed | Status |
|---------------------------|------------------|----------|--------|
| Avg afferent coupling     | < 8              | 4.6      | PASS   |
| Dependency cycles         | 0                | 0        | PASS   |
| Max cyclomatic complexity | < 25             | 18       | PASS   |
| Dead code (unreferenced)  | < 1.5%           | 0.8%     | PASS   |
| Duplicate logic blocks    | < 12             | 7        | PASS   |
| Weak abstractions         | 0 critical       | 0        | PASS   |
| Technical debt score      | < 0.30 (0=best)  | 0.18     | PASS   |

No fitness regressions versus v30.0.0 baseline.
