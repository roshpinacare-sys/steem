# Evaluation and Observability

## Evaluation record

Each result records workload and dataset versions, code revision, model artifact and
quantization, provider, prompt, skill, policy, tool versions, configuration, hardware,
seed where applicable, budget, outputs, criterion results, latency, usage, and reviewer.

## Metric layers

- Product outcomes: completion, correctness, operator effort, recovery, trust.
- Agent quality: plan validity, tool correctness, citation correctness, uncertainty,
  policy compliance, and regression rate.
- Reliability: success, retry, duplicate prevention, recovery, queue, and SLOs.
- Performance: latency, throughput, saturation, tokens, model and tool calls.
- Resource: CPU, RAM, GPU, VRAM, storage, network, and full-system energy where measured.

## Telemetry privacy

Prompts and artifacts are not default trace attributes. Use identifiers, hashes,
classifications, sizes, counts, and approved summaries. Apply redaction, sampling,
retention, access control, and export policies.

## Judge policy

Prefer deterministic checks and executable tests. LLM judges may supplement human review
only when their model, prompt, rubric, calibration, and disagreement are recorded.
