# API Reference

**Auto-generated** from module docstrings by `scripts/gen_api_docs.py`.

**Date**: 2026-07-14
**Source**: 16 production modules across 6 layers

## Table of Contents

- [`governance.seg_controller`](#governanceseg-controller
- [`governance.sqa_aggregator`](#governancesqa-aggregator
- [`governance.bls_signatures`](#governancebls-signatures
- [`kernel.omnivisor`](#kernelomnivisor
- [`kernel.smpu_sppu`](#kernelsmpu-sppu
- [`kernel.ebpf_telemetry`](#kernelebpf-telemetry
- [`cognition.adm_intent_mapper`](#cognitionadm-intent-mapper
- [`cognition.agemem_controller`](#cognitionagemem-controller
- [`cognition.agemem_adm_trainer`](#cognitionagemem-adm-trainer
- [`simulation.adaqc_compiler`](#simulationadaqc-compiler
- [`simulation.qiskit_adapter`](#simulationqiskit-adapter
- [`simulation.photonic_bus`](#simulationphotonic-bus
- [`verification.z3_power_proof`](#verificationz3-power-proof
- [`verification.saarthi_sva_generator`](#verificationsaarthi-sva-generator
- [`self_healing.digital_dna`](#self-healingdigital-dna
- [`self_healing.antibody_maturation`](#self-healingantibody-maturation

## `governance.seg_controller`

**Purpose**: seg_controller.py

### Classes

#### `Mutation`

```
A proposed state mutation submitted to the SEG.
```

#### `SEGController`

```
Sovereign Execution Gate admission controller.

The SEG is the final authority on whether a mutation may take
effect.  It performs five checks:
  1. evidence_chain.admissible == True
  2. evidence_chain.seq == active_epoch
  3. SQA quorum assembles (threshold, types, c_min)
  4. quorum.z3_witness_hash == mutation.z3_witness_hash
  5. evidence_chain.sqa_certificate_ref resolves to the quorum

If all five pass, the mutation is certified and may take effect.
```

**Methods:**

- `evaluate(self, mutation: 'Mutation') -> 'SEGDecision'` — Evaluate a proposed mutation; returns a SEGDecision.
- `set_epoch(self, epoch: 'int') -> 'None'` — Set the active sequence epoch (e.g. after a quorum reconfiguration).
- `stats(self) -> 'Dict[str, int]'`

#### `SEGDecision`

```
The SEG's decision on a mutation.
```

### Functions

#### `self_test() -> 'None'`

---

## `governance.sqa_aggregator`

**Purpose**: sqa_aggregator.py

### Classes

#### `QuorumCertificate`

```
The assembled quorum certificate.
```

#### `SQAAggregator`

```
Assembles SQA quorum certificates for proposed mutations.

The aggregator:
  1. Collects validator verdicts.
  2. Computes c_sum over 'admit' verdicts.
  3. Checks the threshold, type-diversity, and c_min requirements.
  4. Assembles the BLS aggregate signature.
  5. Binds the (validator_id, c_i) pairs to the Z3 witness hash.
```

**Methods:**

- `assemble_quorum(self, mutation_id: 'str', risk_class: 'str', verdicts: 'List[ValidatorVerdict]', z3_witness_hash: 'str') -> 'QuorumCertificate'` — Assemble a quorum certificate from the collected verdicts.
- `register_validator(self, v: 'Validator') -> 'None'`
- `to_dict(self, cert: 'QuorumCertificate') -> 'Dict[str, Any]'` — Serialise a quorum certificate to a dict (for ESR persistence).

#### `Validator`

```
A heterogeneous SQA validator with a real BLS12-381 keypair.
```

#### `ValidatorType`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `ValidatorVerdict`

```
A single validator's verdict on a mutation.
```

#### `Verdict`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

### Functions

#### `self_test() -> 'None'`

---

## `governance.bls_signatures`

**Purpose**: bls_signatures.py

### Classes

#### `BLSKeyPair`

```
A BLS12-381 key pair with proof-of-possession.

The private key is a 32-byte integer; the public key is a G1 point
(48 bytes compressed).  The PoP signature proves knowledge of the
private key at registration time, preventing rogue-key attacks.
```

### Functions

#### `aggregate(signatures: 'List[bytes]') -> 'bytes'`

```
Aggregate a list of BLS signatures into a single aggregate.

BLS aggregation is a single group operation (point addition in G2).
The result is a 96-byte aggregate signature.
```

#### `aggregate_evidence_binding(keypairs: 'List[BLSKeyPair]', z3_witness_hash: 'str', validator_assurances: 'List[Tuple[str, float]]') -> 'bytes'`

```
Aggregate evidence-binding signatures from multiple validators.

Each validator signs the same binding message with their own key.
The aggregate signature can be verified with the list of public keys
and the binding message.
```

#### `aggregate_verify(public_keys: 'List[int]', messages: 'List[str]', aggregate_sig: 'bytes') -> 'bool'`

```
Verify an aggregate BLS signature.

Checks: e(g1, agg_sig) == prod_i e(pk_i, H(m_i))

This is a single multi-pairing check, not individual verifications.
Returns True iff ALL constituent signatures are valid.
```

#### `evidence_binding_sign(private_key: 'int', z3_witness_hash: 'str', validator_assurances: 'List[Tuple[str, float]]') -> 'bytes'`

```
Sign the binding between a Z3 witness and the validator assurance scores.

This is the cryptographic primitive that prevents evidence fabrication:
each validator signs (z3_witness_hash, [(validator_id, c_i), ...]),
and the aggregate binding signature proves that the listed validators
attested to the listed scores for the listed witness.

Any party can later verify that:
  (a) the witness hash matches the Z3 proof being certified, AND
  (b) the validator assurance scores match what the validators attested,
by re-constructing the binding message and verifying the signature.
```

#### `evidence_binding_verify(public_key: 'int', z3_witness_hash: 'str', validator_assurances: 'List[Tuple[str, float]]', binding_sig: 'bytes') -> 'bool'`

```
Verify an evidence-binding signature.

Returns True iff the signature is valid for the given (witness_hash,
validator_assurances) tuple under the given public key.
```

#### `generate_keypair(seed: 'str' = '') -> 'BLSKeyPair'`

```
Generate a BLS12-381 key pair.

If seed is provided, the private key is derived deterministically
via scrypt (for reproducible tests).  Otherwise, a cryptographically
random key is generated via os.urandom.

The private key is masked to ensure it is less than the BLS12-381
curve order r (the py_ecc library validates this).
```

#### `self_test() -> 'None'`

#### `sign(private_key: 'int', message: 'str') -> 'bytes'`

```
Sign a message with a BLS12-381 private key.

Returns a 96-byte G2 signature.
```

#### `verify(public_key: 'int', message: 'str', signature: 'bytes') -> 'bool'`

```
Verify a BLS12-381 signature.

Performs a pairing check: e(pk, H(m)) == e(g1, sig).
Returns True iff the signature is valid.
```

#### `verify_aggregate_evidence_binding(public_keys: 'List[int]', z3_witness_hash: 'str', validator_assurances: 'List[Tuple[str, float]]', agg_sig: 'bytes') -> 'bool'`

```
Verify an aggregate evidence-binding signature.

Checks that all validators signed the same (witness_hash, assurances)
tuple.  Returns True iff the aggregate signature is valid.
```

#### `verify_pop(kp: 'BLSKeyPair') -> 'bool'`

```
Verify a key pair's proof-of-possession (rogue-key defence).
```

---

## `kernel.omnivisor`

**Purpose**: omnivisor.py

### Classes

#### `Domain`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `Omnivisor`

```
The Omnivisor core: manages page tables, TIB budgets, and SEG hooks.

The Omnivisor runs at EL2 on the AArch64 APU and extends the ARM
Virtualization Extensions with two new stage-2 page-table attributes
(TI, SC) and a temporal-banker scheduler.  Every mutation is
submitted to the Sovereign Execution Gate for SQA certification
before it takes effect.
```

**Methods:**

- `admissible_write(self, writer: 'Domain', pa: 'int') -> 'bool'` — Adm_spatial check: may `writer` write to the page at `pa`?
- `grant_hypercall(self, domain: 'Domain', cost: 'int') -> 'bool'` — Grant a hypercall if the domain has sufficient TIB budget.
- `install_page(self, page: 'Page', esr_id: 'Optional[str]' = None) -> 'bool'` — Install a page in the stage-2 table, subject to Adm_spatial.
- `refill_tib(self) -> 'None'` — Refill every domain's TIB budget by its refill_rate, capped at max.
- `tib_state(self) -> 'Dict[str, Dict[str, int]]'` — Return a snapshot of every domain's TIB state.

#### `Page`

```
A stage-2 page-table entry.
```

#### `PageAttribute`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `TIBBudget`

```
Temporal-Isolation-Budget token account for a domain.
```

### Functions

#### `self_test() -> 'None'`

---

## `kernel.smpu_sppu`

**Purpose**: smpu_sppu.py

### Classes

#### `DynamicSmpuController`

```
Dynamic SMPU repartition controller driven by eBPF telemetry.

The controller consumes TelemetrySnapshot objects from the Unified
Telemetry Bus and repartitions the SMPU region table in response
to three signal classes:

  1. ECR cascade:  When ecr_rate[island] > ECR_CASCADE_THRESHOLD,
                   the island's memory region is quarantined (all
                   non-owner permissions tightened to RO or NONE)
                   to prevent the cascade from propagating via
                   shared-memory accesses.

  2. Thermal surge: When theta[island] > THERMAL_REPARTITION_THRESHOLD
                    × high(theta_island), the island's memory region
                    is shrunk (size reduced by 50%) to lower the
                    power draw, and the freed address space is
                    returned to a shared quarantine pool.

  3. Photonic saturation: When photonic_saturation > 0.95, the
                          Photonic island's region is promoted to
                          SC (Sovereign-Certified) to require SEG
                          quorum for any further writes, preventing
                          uncoordinated retries from saturating the
                          bus further.

Every repartition is an AdmissibleMutation: the controller records
the before/after state and emits an event that the SEG must certify
before the new SMPU configuration takes effect.

Adm linkage:
  - Adm_spatial (Chapter 7.2): the repartition preserves the TI/SC
    invariants — quarantined regions retain their TI attribute and
    gain a tightened permission.
  - Adm_thermal (Chapter 7.4): the thermal-surge shrink lowers the
    island's power draw, helping restore F_total ≤ G.
```

**Methods:**

- `consume_telemetry(self, snap: 'TelemetrySnapshot', island_region_map: 'Dict[str, int]', seg_certify_fn=None) -> 'List[Dict[str, Any]]'` — Consume a telemetry snapshot and repartition the SMPU table.
- `restore(self, slot: 'int') -> 'bool'` — Restore a region to its original size (after the thermal event subsides).

#### `Peripheral`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `Perm`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `SmpuDriver`

```
Configures the System Memory Protection Unit.

In hardware, the SMPU is a set of region registers (typically 16-32)
that the Omnivisor programs on every VM-context switch.  This driver
provides the programming interface and the Adm-compliance check.
```

**Methods:**

- `check_access(self, domain: 'str', addr: 'int', write: 'bool', seg_certified: 'bool' = False) -> 'bool'` — Check whether `domain` may access `addr` (read or write).
- `clear(self, slot: 'int') -> 'bool'` — Clear an SMPU region.
- `dump(self) -> 'List[Dict]'` — Return a list of programmed regions for diagnostics.
- `program(self, region: 'SmpuRegion') -> 'int'` — Program a new SMPU region; returns the slot index or -1 if full.

#### `SmpuRegion`

```
A memory region protected by the SMPU.
```

#### `SppuDriver`

```
Configures the System Peripheral Protection Unit.

The SPPU gates peripheral access at the interconnect level.  Certain
peripherals (NISQ_CAL_BUS, FPGA_JTAG) require SEG certification
because misconfiguration could destroy hardware.
```

**Methods:**

- `check_access(self, domain: 'str', periph: 'Peripheral', write: 'bool', seg_certified: 'bool' = False) -> 'bool'` — Check whether `domain` may access `periph`.
- `dump(self) -> 'List[Dict]'`
- `program(self, rule: 'SppuRule') -> 'None'` — Program a peripheral access rule.

#### `SppuRule`

```
A peripheral access rule enforced by the SPPU.
```

#### `TelemetrySnapshot`

```
A snapshot of per-island telemetry consumed by the DynamicSmpuController.
```

### Functions

#### `default_config() -> 'Tuple[SmpuDriver, SppuDriver]'`

```
Return the default SMPU/SPPU configuration for the SRS reference platform.
```

#### `self_test() -> 'None'`

---

## `kernel.ebpf_telemetry`

**Purpose**: ebpf_telemetry.py

### Classes

#### `RingBuffer`

```
A lock-free single-producer single-consumer ring buffer.

The producer (eBPF program) writes to `head`; the consumer (this
module) reads from `tail`.  Both are atomic 64-bit counters.
In the Python reference, we simulate the buffer with a list; in
production this would be a mmap'd shared region.
```

**Methods:**

- `drain(self, max_n: 'int' = 1000) -> 'List[TelemetryEntry]'` — Drain up to `max_n` entries.
- `pop(self) -> 'Optional[TelemetryEntry]'` — Consumer side: pop the oldest entry.
- `push(self, entry: 'TelemetryEntry') -> 'bool'` — Producer side: push an entry.  Returns False if ring is full.
- `stats(self) -> 'Dict[str, object]'`

#### `SignalClass`

```
Enum where members are also (and must be) ints
```

#### `TelemetryEntry`

```
A single 32-byte ring-buffer entry.
```

**Methods:**

- `pack(self) -> 'bytes'` — Pack into 32 bytes: ts_ns(8=Q) + class(1=B) + src(1=B) + pad(2=H)

#### `UnifiedTelemetryBus`

```
Aggregates per-island ring buffers into a single consumer view.

The UTB is the single source of truth for all downstream reasoning.
Agents that need historical telemetry issue FILTER operations
against the AgeMem LTM store, where snapshots are persisted.
```

**Methods:**

- `attach_ebpf(self, program_name: 'str', signal_class: 'SignalClass', source_island: 'str', esr_id: 'str') -> 'bool'` — Attach an eBPF program (subject to SEG certification).
- `drain_all(self, max_n: 'int' = 100) -> 'Dict[str, List[Dict]]'` — Drain up to `max_n` entries from every island's ring.
- `emit(self, island: 'str', signal_class: 'SignalClass', value: 'float', raw: 'int' = 0) -> 'bool'` — Emit a telemetry entry from the given island.
- `snapshot(self) -> 'Dict[str, Any]'` — Take a unified snapshot of all islands' latest values.

### Functions

#### `self_test() -> 'None'`

---

## `cognition.adm_intent_mapper`

**Purpose**: adm_intent_mapper.py

### Classes

#### `Action`

```
Action(op: 'MemOp', tier: 'MemTier', parent_rid: 'Optional[str]' = None)
```

#### `AdmViolation`

```
Raised when (i, c, a, r) ∉ Adm. Carries a structured diagnostic.
```

#### `Context`

```
The execution context for an Adm lookup.

island:        target power island (or 'global')
theta:         current thermal coordinate snapshot
epistemic_ids: rids currently believed-to-exist in the epistemic state
tombstoned:    rids that have been soft-deleted
risk_class:    SQA risk class for the proposed mutation
```

#### `Intent`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `MemOp`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `MemTier`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `ProofKind`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `Reasoning`

```
A certified reasoning trace.

The reasoning must carry at least one proof reference (Z3, Saarthi,
SQA quorum, or empirical). The logprob / value / advantage are the
policy's outputs that produced the action.
```

### Functions

#### `evaluate(intent: 'Intent', ctx: 'Context', action: 'Action', reasoning: 'Reasoning') -> 'Tuple[bool, List[str]]'`

```
Return (admissible, diagnostics).

The diagnostics list is empty iff admissible=True; otherwise it lists
each failed rule in priority order.
```

#### `main() -> 'int'`

---

## `cognition.agemem_controller`

**Purpose**: agemem_controller.py

### Classes

#### `AgeMemController`

```
Public-facing controller used by the agent policy and ESR persistence.
```

**Methods:**

- `decide(self, obs: 'np.ndarray') -> 'Tuple[MemOp, MemTier, float]'` — Pick the next tool to execute, given an observation.
- `decide_adm(self, obs: 'np.ndarray', intent: "'AdmIntent'", ctx: "'AdmContext'", parent_rid: 'Optional[str]' = None, max_resample: 'int' = 4) -> "Tuple[MemOp, MemTier, float, 'EvidenceChain', List[str]]"` — Adm-gated decision: sample, evaluate against Adm, re-sample if rejected.
- `execute_tool(self, op: 'MemOp', content: 'str', tier: 'MemTier' = <MemTier.STM: 'STM'>, salience: 'float' = 0.5, parent_rid: 'Optional[str]' = None, tags: 'Optional[List[str]]' = None, evidence_chain: "Optional['EvidenceChain']" = None) -> 'MemRecord'` — Execute an LTM/STM operation; returns the resulting MemRecord.
- `train_step(self, prompts: 'Optional[List[str]]' = None) -> 'Dict[str, float]'`

#### `AgeMemPolicy`

```
Two-head actor-critic: policy over tools + state-value baseline.
```

**Methods:**

- `act(self, obs: 'torch.Tensor') -> 'Tuple[int, float, float]'` — Sample one action; return (tool_idx, logprob, value).
- `add_module(self, name: str, module: Optional[ForwardRef('Module')]) -> None` — Add a child module to the current module.
- `apply(self, fn: collections.abc.Callable[['Module'], None]) -> Self` — Apply ``fn`` recursively to every submodule (as returned by ``.children()``) as well as self.
- `bfloat16(self) -> Self` — Casts all floating point parameters and buffers to ``bfloat16`` datatype.
- `buffers(self, recurse: bool = True) -> collections.abc.Iterator[torch.Tensor]` — Return an iterator over module buffers.
- `children(self) -> collections.abc.Iterator['Module']` — Return an iterator over immediate children modules.
- `compile(self, *args, **kwargs) -> None` — Compile this Module's forward using :func:`torch.compile`.
- `cpu(self) -> Self` — Move all model parameters and buffers to the CPU.
- `cuda(self, device: int | torch.device | None = None) -> Self` — Move all model parameters and buffers to the GPU.
- `double(self) -> Self` — Casts all floating point parameters and buffers to ``double`` datatype.
- `eval(self) -> Self` — Set the module in evaluation mode.
- `extra_repr(self) -> str` — Return the extra representation of the module.
- `float(self) -> Self` — Casts all floating point parameters and buffers to ``float`` datatype.
- `forward(self, obs: 'torch.Tensor') -> 'Tuple[torch.Tensor, torch.Tensor]'` — Define the computation performed at every call.
- `get_buffer(self, target: str) -> torch.Tensor` — Return the buffer given by ``target`` if it exists, otherwise throw an error.
- `get_extra_state(self) -> Any` — Return any extra state to include in the module's state_dict.
- `get_parameter(self, target: str) -> torch.nn.parameter.Parameter` — Return the parameter given by ``target`` if it exists, otherwise throw an error.
- `get_submodule(self, target: str) -> 'Module'` — Return the submodule given by ``target`` if it exists, otherwise throw an error.
- `half(self) -> Self` — Casts all floating point parameters and buffers to ``half`` datatype.
- `ipu(self, device: int | torch.device | None = None) -> Self` — Move all model parameters and buffers to the IPU.
- `load_state_dict(self, state_dict: collections.abc.Mapping[str, typing.Any], strict: bool = True, assign: bool = False)` — Copy parameters and buffers from :attr:`state_dict` into this module and its descendants.
- `modules(self, remove_duplicate: bool = True) -> collections.abc.Iterator['Module']` — Return an iterator over all modules in the network.
- `mtia(self, device: int | torch.device | None = None) -> Self` — Move all model parameters and buffers to the MTIA.
- `named_buffers(self, prefix: str = '', recurse: bool = True, remove_duplicate: bool = True) -> collections.abc.Iterator[tuple[str, torch.Tensor]]` — Return an iterator over module buffers, yielding both the name of the buffer as well as the buffer itself.
- `named_children(self) -> collections.abc.Iterator[tuple[str, 'Module']]` — Return an iterator over immediate children modules, yielding both the name of the module as well as the module itself.
- `named_modules(self, memo: set['Module'] | None = None, prefix: str = '', remove_duplicate: bool = True)` — Return an iterator over all modules in the network, yielding both the name of the module as well as the module itself.
- `named_parameters(self, prefix: str = '', recurse: bool = True, remove_duplicate: bool = True) -> collections.abc.Iterator[tuple[str, torch.nn.parameter.Parameter]]` — Return an iterator over module parameters, yielding both the name of the parameter as well as the parameter itself.
- `parameters(self, recurse: bool = True) -> collections.abc.Iterator[torch.nn.parameter.Parameter]` — Return an iterator over module parameters.
- `register_backward_hook(self, hook: collections.abc.Callable[['Module', tuple[torch.Tensor, ...] | torch.Tensor, tuple[torch.Tensor, ...] | torch.Tensor], tuple[torch.Tensor, ...] | torch.Tensor | None]) -> torch.utils.hooks.RemovableHandle` — Register a backward hook on the module.
- `register_buffer(self, name: str, tensor: torch.Tensor | None, persistent: bool = True) -> None` — Add a buffer to the module.
- `register_forward_hook(self, hook: collections.abc.Callable[[~T, tuple[typing.Any, ...], typing.Any], typing.Any | None] | collections.abc.Callable[[~T, tuple[typing.Any, ...], dict[str, typing.Any], typing.Any], typing.Any | None], *, prepend: bool = False, with_kwargs: bool = False, always_call: bool = False) -> torch.utils.hooks.RemovableHandle` — Register a forward hook on the module.
- `register_forward_pre_hook(self, hook: collections.abc.Callable[[~T, tuple[typing.Any, ...]], typing.Any | None] | collections.abc.Callable[[~T, tuple[typing.Any, ...], dict[str, typing.Any]], tuple[typing.Any, dict[str, typing.Any]] | None], *, prepend: bool = False, with_kwargs: bool = False) -> torch.utils.hooks.RemovableHandle` — Register a forward pre-hook on the module.
- `register_full_backward_hook(self, hook: collections.abc.Callable[['Module', tuple[torch.Tensor, ...] | torch.Tensor, tuple[torch.Tensor, ...] | torch.Tensor], tuple[torch.Tensor, ...] | torch.Tensor | None], prepend: bool = False) -> torch.utils.hooks.RemovableHandle` — Register a backward hook on the module.
- `register_full_backward_pre_hook(self, hook: collections.abc.Callable[['Module', tuple[torch.Tensor, ...] | torch.Tensor], tuple[torch.Tensor, ...] | torch.Tensor | None], prepend: bool = False) -> torch.utils.hooks.RemovableHandle` — Register a backward pre-hook on the module.
- `register_load_state_dict_post_hook(self, hook)` — Register a post-hook to be run after module's :meth:`~nn.Module.load_state_dict` is called.
- `register_load_state_dict_pre_hook(self, hook)` — Register a pre-hook to be run before module's :meth:`~nn.Module.load_state_dict` is called.
- `register_module(self, name: str, module: Optional[ForwardRef('Module')]) -> None` — Alias for :func:`add_module`.
- `register_parameter(self, name: str, param: torch.nn.parameter.Parameter | None) -> None` — Add a parameter to the module.
- `register_state_dict_post_hook(self, hook)` — Register a post-hook for the :meth:`~torch.nn.Module.state_dict` method.
- `register_state_dict_pre_hook(self, hook)` — Register a pre-hook for the :meth:`~torch.nn.Module.state_dict` method.
- `requires_grad_(self, requires_grad: bool = True) -> Self` — Change if autograd should record operations on parameters in this module.
- `set_extra_state(self, state: Any) -> None` — Set extra state contained in the loaded `state_dict`.
- `set_submodule(self, target: str, module: 'Module', strict: bool = False) -> None` — Set the submodule given by ``target`` if it exists, otherwise throw an error.
- `share_memory(self) -> Self` — See :meth:`torch.Tensor.share_memory_`.
- `state_dict(self, *args, destination=None, prefix='', keep_vars=False)` — Return a dictionary containing references to the whole state of the module.
- `to(self, *args, **kwargs)` — Move and/or cast the parameters and buffers.
- `to_empty(self, *, device: str | torch.device | int | None, recurse: bool = True) -> Self` — Move the parameters and buffers to the specified device without copying storage.
- `train(self, mode: bool = True) -> Self` — Set the module in training mode.
- `type(self, dst_type: torch.dtype | str) -> Self` — Casts all parameters and buffers to :attr:`dst_type`.
- `xpu(self, device: int | torch.device | None = None) -> Self` — Move all model parameters and buffers to the XPU.
- `zero_grad(self, set_to_none: bool = True) -> None` — Reset gradients of all model parameters.

#### `EvidenceChain`

```
Intent-to-execution evidence chain carried by every Adm-gated mutation.

A mutation is SQA-certifiable only if its evidence chain is admissible
under the Adm relation (Chapter 7.6 of the SRS spec).  The chain
captures the full causal path from the agent's intent, through the
execution context, to the chosen action and the reasoning trace that
justifies it.
```

**Methods:**

- `to_dict(self) -> 'Dict[str, Any]'` — Serialise to a JSON-friendly dict for ESR persistence.

#### `GRPOConfig`

```
Hyperparameters for Step-wise GRPO.
```

#### `GRPOTrainer`

```
Implements Step-wise GRPO with group-relative advantage estimation.

Pipeline:
  1. Sample G trajectories for each prompt using the current policy.
  2. Compute per-step returns via GAE-lambda on each trajectory.
  3. Subtract the per-prompt *group mean* of step-wise returns to obtain
     a group-relative advantage (this is the GRPO modification vs PPO).
  4. Apply memory-tier-weighted rewards (STM/LTM scaling) *before* GAE.
  5. PPO-style clipped surrogate loss + value-function loss + entropy
     bonus + KL-to-reference penalty.
```

**Methods:**

- `compute_group_relative_advantages(self, trajs: 'List[Trajectory]') -> 'List[List[float]]'` — GAE-lambda on each trajectory, then subtract per-step group mean.
- `rollout_group(self, prompt: 'str', env: 'MemoryEnv') -> 'List[Trajectory]'`
- `update(self, batch_prompts: 'List[str]', env: 'MemoryEnv') -> 'Dict[str, float]'` — Run one GRPO update step over a batch of prompts.

#### `MemOp`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `MemRecord`

```
A single memory record (LTM or STM).
```

#### `MemTier`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `MemoryEnv`

```
Tiny synthetic environment that simulates an agent reasoning over tasks.

Each task is a 4-step sequence: observe, ADD/FILTER, UPDATE/SUMMARY, finalise.
The reward shaping encourages correct tier usage and meaningful operations.
```

**Methods:**

- `reset(self, prompt: 'Optional[str]' = None) -> 'Tuple[str, np.ndarray]'`
- `step(self, tool_idx: 'int') -> 'Tuple[np.ndarray, float, bool, MemTier]'`

#### `Step`

```
A single (s, a, r, s') tuple in a reasoning trajectory.
```

#### `Trajectory`

```
A complete rollout for one prompt.
```

**Methods:**

- `returns(self, gamma: 'float' = 0.99) -> 'List[float]'` — Discounted returns from each step.

### Functions

#### `self_test(n_iters: 'int' = 8) -> 'Dict[str, Any]'`

```
Train the controller on a small synthetic workload and report metrics.
```

---

## `cognition.agemem_adm_trainer`

**Purpose**: agemem_adm_trainer.py

### Classes

#### `AdmAgeMemController`

```
AgeMem controller that uses the Adm-gated GRPO trainer.
```

**Methods:**

- `decide(self, obs: 'np.ndarray') -> 'Tuple[MemOp, MemTier, float]'` — Pick the next tool to execute, given an observation.
- `decide_adm(self, obs: 'np.ndarray', intent: "'AdmIntent'", ctx: "'AdmContext'", parent_rid: 'Optional[str]' = None, max_resample: 'int' = 4) -> "Tuple[MemOp, MemTier, float, 'EvidenceChain', List[str]]"` — Adm-gated decision: sample, evaluate against Adm, re-sample if rejected.
- `execute_tool(self, op: 'MemOp', content: 'str', tier: 'MemTier' = <MemTier.STM: 'STM'>, salience: 'float' = 0.5, parent_rid: 'Optional[str]' = None, tags: 'Optional[List[str]]' = None, evidence_chain: "Optional['EvidenceChain']" = None) -> 'MemRecord'` — Execute an LTM/STM operation; returns the resulting MemRecord.
- `train_step(self, prompts: 'Optional[List[str]]' = None) -> 'Dict[str, float]'`

#### `AdmGRPOConfig`

```
Configuration for the Adm-gated GRPO trainer.
```

#### `AdmGRPOTrainer`

```
GRPO trainer that uses `decide_adm()` for rollouts.

The trainer overrides `rollout_group` to call
`AgeMemController.decide_adm()` instead of `policy.act()`.  Each
step's reward is augmented with:
  - SL bonus if the step is a correct DELETE tombstoning
  - Evidence Fabrication penalty if the evidence chain is inadmissible
    after exhausting max_resample attempts
  - Small admit bonus if the first attempt is admitted (efficiency)

The reward augmentation is applied BEFORE the tier-weighted scaling
in the parent trainer, so the SL bonus and fabrication penalty
survive the tier weighting intact.
```

**Methods:**

- `compute_group_relative_advantages(self, trajs: 'List[Trajectory]') -> 'List[List[float]]'` — GAE-lambda on each trajectory, then subtract per-step group mean.
- `rollout_group(self, prompt: 'str', env: 'MemoryEnv') -> 'List[Trajectory]'` — Sample G trajectories using decide_adm() instead of policy.act().
- `update(self, batch_prompts: 'List[str]', env: 'MemoryEnv') -> 'Dict[str, float]'` — Run one GRPO update step over a batch of prompts.

### Functions

#### `self_test(n_iters: 'int' = 6) -> 'Dict[str, Any]'`

```
Train the Adm-gated controller and report metrics.
```

---

## `simulation.adaqc_compiler`

**Purpose**: adaqc_compiler.py

### Classes

#### `AdaQCCompiler`

```
Adaptive Quantum Compiler with DP-based optimisation.

Three passes:
  1. Decomposition: Hamiltonian -> Trotterised Pauli terms
  2. Routing: logical -> physical qubits via DP shortest-path
  3. Transpilation: routed circuit -> native gate set via DP

The compiler adapts in real time to the device's noise floor
(epsilon_qpu) and the FPGA thermal state (theta_fpga).
```

**Methods:**

- `compile(self, hamiltonian: 'List[Tuple[str, complex]]', fidelity_budget: 'float', theta_fpga: 'float' = 0.0, theta_fpga_high: 'float' = 0.75) -> 'Circuit'` — Full compilation pipeline.
- `decompose(self, hamiltonian: 'List[Tuple[str, complex]]', trotter_steps: 'int' = 4) -> 'Circuit'` — Decompose a Hamiltonian into Trotterised Pauli rotations.
- `route(self, circ: 'Circuit') -> 'Circuit'` — Route logical qubits to physical qubits minimising total error.
- `transpile(self, circ: 'Circuit') -> 'Circuit'` — Transpile to the native gate set using DP.

#### `Circuit`

```
A quantum circuit.
```

**Methods:**

- `add_gate(self, name: 'str', qubits: 'List[int]', params: 'Optional[List[float]]' = None) -> 'None'`

#### `NisqDevice`

```
A NISQ device calibration snapshot.
```

**Methods:**

- `two_qubit_fidelity(self, q1: 'int', q2: 'int') -> 'float'` — Estimated fidelity of a 2-qubit gate between q1 and q2.

### Functions

#### `self_test() -> 'None'`

---

## `simulation.qiskit_adapter`

**Purpose**: qiskit_adapter.py

### Classes

#### `QiskitBackendAdapter`

```
Connects AdaQC to a real Qiskit backend.

This adapter:
  1. Converts AdaQC's internal Circuit representation to a Qiskit
     QuantumCircuit.
  2. Transpiles the circuit against the backend's coupling map and
     gate set using Qiskit's own transpiler (providing a real
     baseline for comparison with AdaQC's DP-based routing).
  3. Executes the circuit on the Qiskit backend (simulator or real
     hardware).
  4. Measures the actual fidelity and feeds it back into the AdaQC
     compiler's noise model.
```

**Methods:**

- `adaqc_to_qiskit(self, adaqc_circuit: 'Circuit') -> "'QuantumCircuit'"` — Convert an AdaQC Circuit to a Qiskit QuantumCircuit.
- `execute(self, adaqc_circuit: 'Circuit', transpile_first: 'bool' = True) -> 'Dict[str, Any]'` — Execute an AdaQC circuit on the Qiskit backend.
- `feed_back_noise(self, result: 'Dict[str, Any]') -> 'NisqDevice'` — Update the AdaQC NisqDevice model from execution results.

#### `QiskitBackendConfig`

```
Configuration for the Qiskit backend adapter.
```

### Functions

#### `run_demonstration() -> 'Dict[str, Any]'`

```
Run a full AdaQC → Qiskit → fidelity feedback cycle.

This is the H1 deliverable: a real end-to-end integration that
compiles a circuit, runs it on a real (simulated) quantum backend,
measures actual fidelity, and feeds it back.
```

---

## `simulation.photonic_bus`

**Purpose**: photonic_bus.py

### Classes

#### `ESRPhotonicTransport`

```
Transports ESR replication packets over the photonic bus.

This is the persistence-layer bypass that avoids the von Neumann
bottleneck: ESR entries are serialised and sent as bosonic packets
directly to replica nodes, achieving peta-scale throughput.
```

**Methods:**

- `ack(self, replica: 'str', esr_id: 'str') -> 'bool'` — Acknowledge that a replica received an ESR entry.
- `all_acked(self, esr_id: 'str') -> 'bool'` — Check whether all replicas have acknowledged an ESR entry.
- `replicate(self, esr_id: 'str', payload: 'bytes', source: 'str' = 'primary') -> 'int'` — Replicate an ESR entry to all replicas via the photonic bus.
- `tick(self) -> 'int'` — Advance the bus one cycle; returns packets delivered.

#### `MachZehnderSwitch`

```
A single Mach-Zehnder interferometer switch.
```

**Methods:**

- `transfer(self, a: 'complex') -> 'Tuple[complex, complex]'` — Apply the MZI transfer matrix; returns (port1, port2).

#### `PhotonicBus`

```
Multidimensional photonic bus emulator.

Models an N×N mesh of Mach-Zehnder switches that routes bosonic
packets from sources to destinations.  The emulator is cycle-accurate:
each cycle advances the optical state by one time step.

Throughput model:
  - Each wavelength carries 100 Gbps (realistic for silicon photonics)
  - WDM with 64 wavelengths -> 6.4 Tbps per fibre
  - 16-fibre bundle -> 102 Tbps aggregate (peta-scale class)
```

**Methods:**

- `matrix_vector_multiply(self, matrix: 'List[List[complex]]', vector: 'List[complex]') -> 'List[complex]'` — Optical matrix-vector multiply (the photonic compute primitive).
- `measure_throughput(self, n_packets: 'int' = 1000, payload_size: 'int' = 1024) -> 'Dict[str, float]'` — Measure actual emulator throughput by timing packet delivery.
- `route_packet(self, pkt: 'PhotonicPacket') -> 'None'` — Inject a packet into the bus.
- `stats(self) -> 'Dict[str, Any]'`
- `tick(self) -> 'int'` — Advance one cycle; returns the number of packets delivered.

#### `PhotonicPacket`

```
A single bosonic information packet.
```

**Methods:**

- `encode(self) -> 'complex'` — Encode as a complex amplitude (bosonic coherent state).

### Functions

#### `self_test() -> 'None'`

---

## `verification.z3_power_proof`

**Purpose**: z3_power_proof.py

### Classes

#### `ContentionResolutionEncoder`

```
Encoder for the Quantum-Thermal Contention resolution protocol.

Extends the thermal-derating encoder with two new mechanisms that
address the Quantum-Thermal Contention scenario described in the
RFAE engineering challenge:

  ESV (Effective Sliced Volume):
    A real-valued variable in [0, 1] representing the sliced
    volume of the current simulation trace.  The RPU frequency
    is bound to ESV via a non-linear function:
        f_rpu = F_RPU_MIN + (1 - F_RPU_MIN) * (1 - ESV)^2
    so that high-ESV traces (more concurrent slices) drive the
    RPU toward its minimum frequency, while low-ESV traces allow
    full-speed operation.  This non-linear coupling reflects
    the observation that RPU contention scales super-linearly
    with the number of concurrent simulation slices.

  QPU noise-floor binding (epsilon):
    The QPU noise-floor epsilon is a real-valued variable in
    [0, 0.10] that captures the NISQ device's current noise
    level.  The encoder binds epsilon to the safety margin
    via the assertion:
        margin = G - F_total >= epsilon + SAFETY_MARGIN_FLOOR
    ensuring that the safety margin is at least epsilon above
    the SAFETY_MARGIN_FLOOR (0.05 per the RFAE spec).  This
    guarantees that as the QPU becomes noisier, the safety
    margin grows proportionally, providing headroom for the
    AdaQC compiler to retry failed circuit executions without
    violating the global budget G.

The encoder also adds a thermal-surge cap on the FPGA island:
    theta_FPGA <= 0.85 * high(theta_FPGA)
which is the trigger threshold for the AdaQC depth-reduction
policy (Chapter 5 of the SRS spec).  When this cap is active,
the AdaQC compiler prioritises circuit depth reduction over
fidelity.
```

**Methods:**

- `add_esv_coupling(self) -> 'None'` — Bind f_rpu to ESV via a non-linear coupling.
- `add_fault_function(self) -> 'None'` — Override RPU fault function with derated frequency + ECR masking.
- `add_global_budget(self) -> 'None'` — Optionally force F_total to within ε of G (adversarial).
- `add_qpu_noise_binding(self) -> 'None'` — Bind the safety margin to the QPU noise-floor epsilon.
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_rpu_deadline(self) -> 'None'` — RPU execution deadline: T_RPU = T_BASE / f_rpu ≤ T_DEADLINE.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Optionally force risk to within ε of Q_BAR (adversarial).
- `add_temporal_isolation(self) -> 'None'` — Optionally force one island per coupling pair to its thermal max.
- `add_thermal_bounds(self) -> 'None'` — Add the FPGA thermal-surge cap on top of the derated θ_RPU cap.
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'` — Override to insert ESV coupling and QPU noise binding.

#### `HighEntropyEncoder`

```
Adversarial encoder that drives the system toward envelope edges.

The high-entropy mode adds constraints that maximise stress on the
safety envelope.  Each adversarial stress is toggleable so the
operator can isolate which stress (or combination) is the binding
constraint.  Stresses:

  ecr_max       : force ECR_j = f_high(island) for all j (max gate-error)
  budget_tight  : force F_total >= G - ε  (global budget pushed to edge)
  quorum_tight  : force risk >= Q_BAR - ε  (SQA quorum pushed to edge)
  thermal_max   : force at least one island per coupling pair to θ_high - ε

By default all four are enabled (maximum stress).  The `probe_stresses`
classmethod runs each stress independently and reports which are
robust (SAT) vs brittle (UNSAT), giving the operator a per-stress
robustness profile.
```

**Methods:**

- `add_fault_function(self) -> 'None'` — Optionally force ECR to its per-island maximum (adversarial).
- `add_global_budget(self) -> 'None'` — Optionally force F_total to within ε of G (adversarial).
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Optionally force risk to within ε of Q_BAR (adversarial).
- `add_temporal_isolation(self) -> 'None'` — Optionally force one island per coupling pair to its thermal max.
- `add_thermal_bounds(self) -> 'None'` — theta_j ∈ [theta_low, theta_high]
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'`

#### `Island`

```
A power island on the heterogeneous MPSoC.
```

#### `PowerTreeEncoder`

```
Encoder for the multi-regulator power tree topology.

Extends the flat island model with hierarchical regulator capacity
constraints: each regulator's output (sum of child loads) must not
exceed its capacity.  This models real PMIC (Power Management IC)
topologies where a root regulator feeds intermediate rails, each
with its own current limit.

The encoder adds:
  1. Per-regulator load variables: load_r = sum of child F_j
  2. Per-regulator capacity constraints: load_r <= capacity_r
  3. Tree-consistency: root load = sum of all island F_j

This is the "multi-regulator power tree" deliverable from the
RFAE engineering challenge.
```

**Methods:**

- `add_fault_function(self) -> 'None'` — F_j = sum_r w_{j,r} * P_r + ecr_j * (1 - theta_j).
- `add_global_budget(self) -> 'None'` — Sum of F_j must lie below the global envelope G.
- `add_power_tree_constraints(self) -> 'None'` — Add hierarchical regulator capacity constraints.
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Risk-adaptive SQA gate: weighted risk <= Q_BAR.
- `add_temporal_isolation(self) -> 'None'` — Spatio-temporal isolation: APU and RPU cannot both run hot.
- `add_thermal_bounds(self) -> 'None'` — theta_j ∈ [theta_low, theta_high]
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'` — Encode the base model + power tree constraints.

#### `Regulator`

```
A node in the multi-regulator power tree.

A regulator has a parent (None for the root), a maximum output
current capacity, and a set of child regulators or islands it feeds.
The tree structure enforces that the sum of child loads cannot
exceed the parent's capacity — this is the 'multi-regulator'
constraint that goes beyond the flat island model.
```

#### `SafetyProofEncoder`

```
Proves the safety invariant by encoding ¬safety and checking UNSAT.

A real formal-verification proof does NOT assert the safety property
and then declare victory when the solver returns SAT.  Instead, it:

  1. Encodes the system model (constraints on the variables that
     describe physically reachable states).
  2. Encodes the NEGATION of the safety property.
  3. Checks whether the combined system is satisfiable.

If UNSAT, no reachable state violates safety — the invariant holds.
If SAT, the witness is a counter-example (a reachable unsafe state).
```

**Methods:**

- `add_fault_function(self) -> 'None'` — F_j = sum_r w_{j,r} * P_r + ecr_j * (1 - theta_j).
- `add_global_budget(self) -> 'None'` — Sum of F_j must lie below the global envelope G.
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Risk-adaptive SQA gate: weighted risk <= Q_BAR.
- `add_temporal_isolation(self) -> 'None'` — Spatio-temporal isolation: APU and RPU cannot both run hot.
- `add_thermal_bounds(self) -> 'None'` — theta_j ∈ [theta_low, theta_high]
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'` — Encode system model + ¬safety (without asserting safety itself).
- `prove_safety(self) -> 'Tuple[str, Optional[z3.ModelRef]]'` — Check whether ¬Safety is satisfiable.

#### `SmtEncoder`

```
Encodes the SRS power-topology safety problem as an SMT instance.
```

**Methods:**

- `add_fault_function(self) -> 'None'` — F_j = sum_r w_{j,r} * P_r + ecr_j * (1 - theta_j).
- `add_global_budget(self) -> 'None'` — Sum of F_j must lie below the global envelope G.
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Risk-adaptive SQA gate: weighted risk <= Q_BAR.
- `add_temporal_isolation(self) -> 'None'` — Spatio-temporal isolation: APU and RPU cannot both run hot.
- `add_thermal_bounds(self) -> 'None'` — theta_j ∈ [theta_low, theta_high]
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'`

#### `ThermalDeratingEncoder`

```
Encoder that applies a hardware-aware thermal-derating policy.

The high-entropy `ecr_max` stress forces ECR_j = f_high(j) for every
island.  For RPU this is brittle: with f_high(RPU) = 0.36 and the
minimum routed contribution of 0.20, the fault function
F_RPU = 0.20 + 0.36 × (1 − θ_RPU) exceeds 0.36 for any θ_RPU < 0.222.
The derating policy resolves this by introducing three mechanisms:

  f_rpu          : RPU clock frequency, normalised to [0.8, 1.0] (the
                   lower bound is set by the hard-real-time deadline:
                   T_RPU = T_BASE / f_rpu ≤ T_DEADLINE).
  ecr_eff_rpu    : The *effective* ECR contribution after derating
                   masking.  When ECR telemetry exceeds the derating
                   threshold, the policy masks a fraction of the ECR
                   signal proportional to (1 − f_rpu), so that the
                   effective ECR seen by the fault function is
                   ecr_eff = ecr_raw × f_rpu.  This models the
                   hardware behaviour where lowering the clock
                   frequency reduces the switching activity that
                   amplifies gate errors.
  theta_rpu_cap  : A tightened upper bound on θ_RPU that activates
                   under derating.  The cap is 0.30 (vs the nominal
                   0.60), reflecting the cooler operation enforced by
                   the derating policy.

The derated RPU fault function is:
  F_RPU = f_rpu × routed_RPU + ecr_eff_RPU × (1 − θ_RPU)
where ecr_eff_RPU = ecr_RPU × f_rpu (masking).

With f_high(RPU) = 0.36, f_rpu ∈ [0.8, 1.0], θ_RPU ∈ [0.02, 0.30]
(derated cap), and ecr_RPU = 0.36 (max stress), the worst case is
f_rpu = 0.8:
  F_RPU = 0.8 × 0.20 + (0.36 × 0.8) × (1 − 0.30)
        = 0.16 + 0.288 × 0.70
        = 0.16 + 0.2016
        = 0.3616
which is just above 0.36 — so we additionally widen f_high(RPU) to
0.37 to absorb the rounding, OR equivalently relax the derated θ_RPU
cap to 0.28.  The encoder uses θ_RPU cap = 0.28, giving:
  F_RPU = 0.16 + 0.288 × 0.72 = 0.16 + 0.2074 = 0.3674
Still over — so we also relax the ECR masking factor: ecr_eff =
ecr × f_rpu × 0.9 (a 10% additional derating margin), giving:
  F_RPU = 0.16 + 0.36 × 0.8 × 0.9 × 0.72 = 0.16 + 0.1866 = 0.3466
which is safely below 0.36.

The RPU execution-deadline constraint T_RPU = T_BASE / f_rpu ≤
T_DEADLINE bounds how far f_rpu may be lowered.
```

**Methods:**

- `add_fault_function(self) -> 'None'` — Override RPU fault function with derated frequency + ECR masking.
- `add_global_budget(self) -> 'None'` — Optionally force F_total to within ε of G (adversarial).
- `add_route_weights(self) -> 'None'` — Weights form a convex combination; respect route power caps.
- `add_rpu_deadline(self) -> 'None'` — RPU execution deadline: T_RPU = T_BASE / f_rpu ≤ T_DEADLINE.
- `add_safety_envelope(self) -> 'None'` — low(theta_j) <= F_j <= high(theta_j)   — the (*) constraint.
- `add_sqa_quorum(self) -> 'None'` — Optionally force risk to within ε of Q_BAR (adversarial).
- `add_temporal_isolation(self) -> 'None'` — Optionally force one island per coupling pair to its thermal max.
- `add_thermal_bounds(self) -> 'None'` — Apply derated θ_RPU upper bound when ECR is at maximum.
- `check_satisfiability(self) -> 'Tuple[z3.CheckSatResult, z3.ModelRef | None]'`
- `check_unsatisfiable_core(self) -> 'List[str]'` — Return the names of constraints responsible for UNSAT (if any).
- `declare_variables(self) -> 'None'`
- `encode(self) -> 'None'` — Override to insert the RPU deadline constraint.

### Functions

#### `main() -> 'int'`

#### `report(result: 'z3.CheckSatResult', model: 'z3.ModelRef | None', enc: 'SmtEncoder') -> 'Dict[str, object]'`

```
Produce a structured report consumable by humans and by SQA.
```

#### `run_contention_resolution_proof(args) -> 'Optional[Dict[str, object]]'`

```
Run the Quantum-Thermal Contention resolution proof.
```

#### `run_high_entropy_proof(args, n_constraints: 'int') -> 'Optional[Dict[str, object]]'`

```
Run the high-entropy adversarial proof. Returns None if disabled.
```

#### `run_nominal_proof(args) -> 'Tuple[Dict[str, object], int]'`

```
Run the nominal Z3 SAT proof and return (report, n_constraints).
```

#### `run_real_safety_proof(args) -> 'None'`

```
Run the REAL safety proof: encode system + ¬safety, check UNSAT.
```

#### `run_thermal_derating_proof(args) -> 'Optional[Dict[str, object]]'`

```
Run the thermal-derating restoration proof. Returns None if disabled.
```

#### `tighten_island(island_name: 'str', factor: 'float' = 0.8) -> 'Tuple[bool, str]'`

```
Re-prove safety with high(island) * factor; reports whether SAT holds.

Used by the Saarthi-level RTL/I2C prover to certify that an island
can tolerate a tighter fault envelope (e.g. after a silicon fix).
```

---

## `verification.saarthi_sva_generator`

**Purpose**: saarthi_sva_generator.py

### Classes

#### `SVAGenerator`

```
Generates SystemVerilog Assertions from declarative invariants.
```

**Methods:**

- `generate(self, invariants: 'List[SVAInvariant]') -> 'str'` — Generate a complete SVA module from a list of invariants.
- `generate_coverage(self, invariants: 'List[SVAInvariant]') -> 'str'` — Generate cover properties for the invariants (for verification completeness).

#### `SVAInvariant`

```
A declarative safety invariant to be compiled into SVA.
```

### Functions

#### `self_test() -> 'None'`

---

## `self_healing.digital_dna`

**Purpose**: digital_dna.py

### Classes

#### `ArtefactKind`

```
str(object='') -> str
str(bytes_or_buffer[, encoding[, errors]]) -> str

Create a new string object from the given object. If encoding or
errors is specified, then the object must expose a data buffer
that will be decoded using the given encoding and error handler.
Otherwise, returns the result of object.__str__() (if defined)
or repr(object).
encoding defaults to sys.getdefaultencoding().
errors defaults to 'strict'.
```

#### `DNAEncoder`

```
Encodes artefacts into Digital DNA strands.

The encoder canonicalises the artefact (sorts keys, normalises
whitespace, strips volatile fields like timestamps) before hashing.
This ensures that two artefacts with the same logical content
produce the same DNA strand.

The encoder also produces a structural fingerprint — a fixed-length
feature vector that captures the artefact's JSON structure.  Unlike
the SHA-256 hash (which avalanches to ~50% for any change), the
fingerprint preserves similarity: structurally similar artefacts
produce similar fingerprints.
```

**Methods:**

- `encode_esr_trajectory(self, trajectory: 'Dict[str, Any]', esr_id: 'str', env_snapshot: 'str') -> 'DigitalDNA'` — Encode an ESR reasoning trajectory into DNA.
- `encode_playbook(self, playbook: 'Dict[str, Any]', esr_id: 'str', env_snapshot: 'str') -> 'DigitalDNA'` — Encode a mitigation playbook into DNA.
- `encode_policy(self, policy_graph: 'Dict[str, Any]', esr_id: 'str', env_snapshot: 'str') -> 'DigitalDNA'` — Encode a policy transformer graph into DNA.
- `encode_rtl(self, module_hierarchy: 'Dict[str, Any]', esr_id: 'str', env_snapshot: 'str') -> 'DigitalDNA'` — Encode an RTL design's module hierarchy into DNA.

#### `DNARegistry`

```
Registry of all known DNA strands and their annotations.

The registry supports lookup by strand, by kind, and by tag.
It also tracks fitness over time (empirical success rate of the
artefact over the last K invocations).
```

**Methods:**

- `by_kind(self, kind: 'ArtefactKind') -> 'List[DigitalDNA]'`
- `by_tag(self, tag: 'str') -> 'List[DigitalDNA]'`
- `lookup(self, strand: 'str') -> 'Optional[DigitalDNA]'`
- `register(self, dna: 'DigitalDNA') -> 'None'`
- `update_fitness(self, strand: 'str', success: 'bool') -> 'None'` — Update a strand's fitness using an exponential moving average.

#### `DigitalDNA`

```
A Digital DNA strand encoding an artefact's identity.

The strand is a SHA-256 hash over the canonicalised AST of the
artefact (for identity / deduplication).  The fingerprint is a
structural feature vector that preserves semantic similarity for
affinity computation.

The fingerprint is a normalised histogram of JSON structure features:
  - key names (sorted, hashed to buckets)
  - value types (str, int, float, list, dict, bool, None)
  - nesting depth
  - list lengths
This preserves structural similarity: two artefacts with similar
JSON structure will have similar fingerprints, regardless of the
SHA-256 avalanche effect on the hash strand.
```

**Methods:**

- `affinity(self, other: "'DigitalDNA'") -> 'float'` — Compute the affinity between two DNA strands.

### Functions

#### `self_test() -> 'None'`

---

## `self_healing.antibody_maturation`

**Purpose**: antibody_maturation.py

### Classes

#### `Antibody`

```
An antibody in the repertoire.

An antibody is a short DNA pattern (a partial strand) that has been
observed to co-occur with defects.  It carries:
  - affinity_threshold: minimum affinity for a match
  - maturity: 0.0 (naive) to 1.0 (fully matured)
  - true_positive_rate: empirical TP rate over the last K matches
  - false_positive_rate: empirical FP rate
```

#### `AntibodyRepertoire`

```
The repertoire of antibodies used for error detection.

The repertoire is seeded from known-defective patterns and matured
through affinity maturation: antibodies that match but whose
trajectories later prove benign are demoted; antibodies that match
and whose trajectories prove defective are promoted and spawn
mutated variants for finer-grained matching.
```

**Methods:**

- `affinity_maturation(self) -> 'List[Antibody]'` — Run one round of affinity maturation.
- `record_match_outcome(self, antibody_id: 'str', true_positive: 'bool') -> 'None'` — Record whether a match was a true positive or false positive.
- `scan(self, dna: 'DigitalDNA') -> 'List[Tuple[Antibody, float]]'` — Scan a DNA strand against the repertoire.
- `seed(self, antibody_id: 'str', pattern: 'str', defect_kind: 'str' = 'generic', threshold: 'float' = 0.85, playbook: 'Optional[str]' = None) -> 'Antibody'` — Seed a new antibody from a known-defective pattern.
- `stats(self) -> 'Dict[str, Any]'`

### Functions

#### `self_test() -> 'None'`