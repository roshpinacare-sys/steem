# V33.53 Qualification Runbook

1. Verify v33.52 audit proof and verdict.
2. Enroll three separated append-only queue stores.
3. Enroll two separated worker hosts and two independent clocks.
4. Replicate exact journal bytes to all stores.
5. Exercise partition failover with two observers.
6. Run overload rejection and hysteresis clear.
7. Lose one site and replay the audit from two surviving stores.
8. Keep external qualification, G3 and production blocked unless trusted external evidence is imported.
