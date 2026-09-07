# v32.4 External Qualification Acceleration

The six external gates are now dependency-ordered. HSM/KMS, witness, PostgreSQL, human pilot and independent review may run in the first wave; multi-host SLO/revocation/recovery depends on HSM/KMS, witness and PostgreSQL evidence. Every gate requires separate collector and reviewer identities, a command reference, evidence path and rollback plan. The plan improves execution readiness but does not change the qualification status from NOT_EXECUTED.
