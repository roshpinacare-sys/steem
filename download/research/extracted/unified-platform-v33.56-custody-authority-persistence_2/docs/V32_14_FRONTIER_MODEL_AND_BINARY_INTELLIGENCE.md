# v32.14 Frontier Model Execution and Proof-Carrying Binary Intelligence

## Executive position

v32.14 does not claim that the platform or any underlying model is “best in the world.” It creates the machinery required to make such a claim falsifiable: fixed requirements, evidence classes, independent oracles, current execution, adversarial controls, bounded context, reproducible artifacts and explicit external blockers.

## Why v32.13 was not a frontier system

v32.13 was unusually strong in governance, evidence integrity, deterministic packaging and sovereign cost control. It still lacked four frontier-critical capabilities:

1. A high-complexity task compiler that selects maximum reasoning only when justified and decomposes work across deliberately different roles.
2. A just-in-time context compiler that preserves canonical governance and failure evidence while deduplicating and budgeting the rest.
3. Causal claim adjudication that distinguishes observed execution from provider claims and requires independent oracles.
4. Native binary intelligence that treats bytes as structured, policy-bound proof objects rather than opaque attachments.

## Implemented frontier execution kernel

`src/ai/frontier-execution-kernel-v32_14.ts` provides:

- `max`, `high` and `standard` reasoning selection from complexity, uncertainty, blast radius and production impact.
- Diverse role assignment: canonical keeper, architect, implementer, adversary, independent verifier, value reviewer, binary analyst and release engineer.
- Proof obligations and stop conditions before packaging.
- Just-in-time context selection with required-class reservation, digest deduplication and a hard character budget.
- Claim adjudication in which any failed oracle refutes the claim and `PROVEN` requires executed and adversarial proof from at least two independent oracles.
- Counterexample-driven continuation that resolves invariant violations, disagreements, mutation survivors and failing tests before release.

This is a platform control plane for using a frontier model effectively; it is not a modification of the model weights.

## Implemented binary proof architecture

`src/binary/proof-carrying-binary-v32_14.ts` performs bounded read-only inspection for WebAssembly, ELF, PE, Mach-O, ZIP, PDF, PNG, JPEG, GZIP, self-described CBOR and unknown formats.

Each accepted manifest binds:

- exact byte digest and size;
- detected primary and secondary magic signatures;
- bounded structural parse results;
- policy digest and findings;
- domain-separated indexed chunk hashes;
- a Merkle root;
- a structure digest;
- entropy observations;
- a bounded model-context projection that never embeds raw bytes;
- explicit parser and environment limitations.

Unsafe or ambiguous artifacts are rejected or quarantined. Controls include size and chunk bounds, malformed structure detection, ZIP traversal and collision checks, compression-ratio and entry limits, active-PDF detection, executable policy, polyglot detection and unknown-format policy.

`verifier-only/v32.14/independent_binary_verifier.py` independently recomputes the content digest, kind, chunks and Merkle root using Python standard library code and imports no producer implementation. It can only verify; it cannot collect, sign, approve or mutate evidence.

## Standards direction

- WebAssembly is used as the preferred future portable executable envelope because its core binary format is specified precisely and the Component Model adds machine-readable interfaces and composition. v32.14 parses core module structure but does not execute untrusted modules.
- Deterministic CBOR is a future compact evidence representation. The current release only recognizes self-described CBOR and retains strict JSON as the signed canonical representation until cross-language deterministic encoding is independently qualified.
- Protocol Buffers are suitable for internal typed transport, but a `.proto` schema and explicit message framing are required before a byte stream can be interpreted safely. Generic protobuf guessing is intentionally excluded.
- in-toto Statements are the target subject/predicate envelope for portable binary attestations; Sigstore/Cosign is an optional external signature and transparency adapter, never a substitute for local content and policy verification.

## Comparative assurance

`src/validation/frontier-comparative-assurance-v32_14.ts` scores evidence across long-horizon execution, context engineering, coding, tool use, multimodality, binary intelligence, formal assurance, false-PASS resistance, independent verification, sovereignty, cost and reproducibility.

Official provider claims and synthetic fixtures can inform a gap analysis but cannot establish frontier status. External independence, sovereignty and production qualification require observed external evidence. A `FRONTIER_CANDIDATE` verdict requires every critical dimension and at least the configured weighted score; otherwise the platform remains `STRONG_BUT_UNQUALIFIED` or `NOT_FRONTIER`.

## Current proof and limitations

Current local proof includes deterministic unit and integration tests, a second-language verifier, seeded fuzzing, authentic mutation testing and a bounded synthetic workload. It does not prove superiority over GPT-5.6 Sol, Claude, Gemini or other frontier models on general intelligence, nor does it prove production SLOs, independent host separation, human value or external infrastructure qualification.

The next honest step is an independently operated comparative workload with fixed prompts, fixed budgets, hidden evaluation cases, blinded human review, binary corpora and signed raw evidence.

## Primary references reviewed on 2026-07-20

- OpenAI, “Previewing GPT-5.6 Sol: a next-generation model,” https://openai.com/index/previewing-gpt-5-6-sol/
- Anthropic, “Models overview,” https://platform.claude.com/docs/en/about-claude/models/overview
- Google DeepMind, “Gemini 3.5,” https://deepmind.google/models/gemini/
- WebAssembly Community Group, “WebAssembly Specification,” https://webassembly.github.io/spec/core/
- Bytecode Alliance, “The WebAssembly Component Model,” https://component-model.bytecodealliance.org/
- RFC 8949, “Concise Binary Object Representation,” https://www.rfc-editor.org/rfc/rfc8949.html
- Protocol Buffers, “Encoding,” https://protobuf.dev/programming-guides/encoding/
- in-toto Attestation, “Statement v1,” https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
- Sigstore, “In-Toto Attestations,” https://docs.sigstore.dev/cosign/verifying/attestation/
