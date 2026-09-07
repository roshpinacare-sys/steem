# Mutation Testing Results

**Date**: 2026-07-14
**Method**: Snapshot-safe manual mutation testing (v2)
**Test suite**: 10 test files

## Summary

| Metric | Value |
|--------|-------|
| Mutations applied | 21 |
| Mutations killed | 21 |
| Mutations survived | 0 |
| Failed to apply | 2 |
| Mutation score | 100.0% |

## Per-Mutation Results

| # | Status | Description |
|---|--------|-------------|
| 1 | KILLED | SEG: flip admissible check (NOT -> direct) |
| 2 | KILLED | SEG: flip seq comparison (!= -> ==) |
| 3 | KILLED | SEG: flip quorum check (NOT -> direct) |
| 4 | KILLED | SEG: flip witness hash comparison |
| 5 | KILLED | SQA: threshold off-by-one (< -> <=) |
| 6 | KILLED | SQA: c_min off-by-one (< -> <=) |
| 7 | KILLED | SQA: flip verdict filter (== -> !=) |
| 8 | KILLED | Omnivisor: flip owner check (== -> !=) |
| 9 | KILLED | Omnivisor: flip TI check |
| 10 | KILLED | Omnivisor: TIB off-by-one (< -> <=) |
| 11 | KILLED | SMPU: ECR threshold off-by-one |
| 12 | KILLED | SMPU: flip quarantine check |
| 13 | KILLED | DNA: flip zero-norm guard |
| 14 | KILLED | DNA: cosine -> wrong formula (dot/(n1+n2)) |
| 15 | KILLED | Adm: flip op membership check (not in -> in) |
| 16 | KILLED | Adm: flip tier check (!= -> ==) |
| 17 | KILLED | AgeMem: flip tier assignment (in -> not in) |
| 18 | SKIP | AdaQC: depth-reduction off-by-one (> -> >=) |
| 19 | KILLED | AdaQC: Floyd-Warshall flip comparison (< -> >) |
| 20 | KILLED | Photonic: flip delivery counter (+= -> -=) |
| 21 | KILLED | Z3: safety envelope low bound off-by-one (>= -> >) |
| 22 | SKIP | Z3: global budget off-by-one (<= -> <) |
| 23 | KILLED | SVA: flip assert -> cover |
