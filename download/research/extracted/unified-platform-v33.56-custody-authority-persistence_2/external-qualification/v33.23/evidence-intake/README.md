# V33.23 Signed Evidence Intake Kit

This kit transports PostgreSQL HA/PITR evidence into a bounded quarantine and an offline verifier. It contains no credentials, private keys, database connection strings, public ingress configuration, or production authority.

The intake endpoint is loopback-only in the reference implementation. Operators must pin trust fingerprints outside the submitted package. A successful built-in scan does not replace an independently operated malware scanner.
