# V33.42 — Hermetic Dependency Capsule and Reproducible Offline Installation

V33.42 closes the repeated clean-install gap without embedding `node_modules`. The canonical `package.json` and `package-lock.json` resolve the complete development dependency set to three repository-local tarballs: TypeScript 5.8.3, `@types/node` 22.19.7, and `undici-types` 6.21.0.

The capsule binds each tarball's SHA-256, npm SHA-512 integrity, package identity, package metadata digest, extracted content-tree digest, source-path digest, SBOM component, toolchain provenance, and lockfile entry. A signed offline-install receipt is accepted only when `npm ci --offline` starts with an empty cache, performs no network request, installs the exact package set, and the installed tree builds successfully.

The tarballs were repacked from exact preinstalled package directories available in the controlled build environment. This is explicitly recorded as local provenance and is not represented as registry-origin provenance. No private keys, `node_modules`, or external execution authority are included.

## Truth boundary

- Execution class: `LOCAL_HERMETIC_INSTALL_REHEARSAL`
- External dependency registry observed: false
- External human participants: 0
- Production authority: `NONE`
- External effects: 0
- G3 and production promotion remain blocked
