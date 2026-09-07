# Dependency Upgrade and Replacement Plan

Dependencies are exact-pinned in the lockfile and must retain integrity hashes and allowed licenses. TypeScript upgrades require a clean compile, the full authoritative test inventory, coverage floors, architecture closure and archive self-test. If the compiler becomes unavailable or unacceptable, the replacement path is a standards-compliant TypeScript compiler or a staged migration to native JavaScript with generated declaration compatibility. No dependency upgrade may bypass rollback to the prior verified lockfile.
