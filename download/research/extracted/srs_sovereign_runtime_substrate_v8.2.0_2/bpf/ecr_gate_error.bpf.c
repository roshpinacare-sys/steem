// SPDX-License-Identifier: Apache-2.0
//
// ecr_gate_error.bpf.c — eBPF program for ECR gate error telemetry
//
// Attached to: tracepoint (FPGA soft-IP ECR block interrupt)
// Output: ring buffer `telemetry_ring` (32-byte entries)
//
// Adm linkage: feeds Adm_thermal (Chapter 7.4) by streaming real ECR
// gate error rates. When ecr_rate > ECR_CASCADE_THRESHOLD, the Dynamic
// SMPU Controller quarantines the affected island's memory region.
//
// Compile: clang -target bpf -O2 -g -c ecr_gate_error.bpf.c -o ecr_gate_error.bpf.o
// Load:    bpftool prog load ecr_gate_error.bpf.o /sys/fs/bpf/ecr_gate_error

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

/* 32-byte telemetry entry (matches Python TelemetryEntry) */
struct telemetry_entry {
    __u64 ts_ns;
    __u8  signal_class; /* 3 = ECR_GATE_ERROR */
    __u8  source_id;    /* 2 = FPGA */
    __u16 pad;
    double value;       /* normalised error rate */
    __u64 raw;          /* raw error count */
    __u32 flags;        /* error type bitmask */
} __attribute__((packed));

/* Ring buffer (shared with power_clock.bpf.c) */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 4 * 1024 * 1024);
} telemetry_ring SEC(".maps");

/* Histogram map for error rate aggregation */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, __u32);     /* island id */
    __type(value, __u64);   /* cumulative error count */
    __uint(max_entries, 8);
} ecr_error_counts SEC(".maps");

/* Tracepoint handler: called on FPGA ECR interrupt */
/* Args: the tracepoint format (defined in /sys/kernel/debug/tracing/events/fpga_ecr/) */
struct ecr_error_args {
    __u64 unused;       /* tracepoint common fields */
    __u64 unused2;
    __u32 island_id;    /* which FPGA island */
    __u32 error_count;  /* errors since last interrupt */
    __u32 error_type;   /* error classification bitmask */
    __u32 raw_counter;  /* raw gate counter */
};

SEC("tracepoint/fpga_ecr/error_interrupt")
int ecr_gate_error_probe(struct ecr_error_args *args)
{
    struct telemetry_entry e = {};
    __u32 island = args->island_id;
    __u64 *cumulative;

    e.ts_ns = bpf_ktime_get_ns();
    e.signal_class = 3;  /* ECR_GATE_ERROR */
    e.source_id = 2;     /* FPGA */

    /* Update cumulative error count */
    cumulative = bpf_map_lookup_elem(&ecr_error_counts, &island);
    if (cumulative) {
        __u64 new_count = *cumulative + args->error_count;
        e.raw = new_count;
        /* Normalised error rate = errors / total gates (approx) */
        e.value = (double)args->error_count / 1000.0;
        *cumulative = new_count;
    } else {
        __u64 init = args->error_count;
        bpf_map_update_elem(&ecr_error_counts, &island, &init, BPF_ANY);
        e.raw = init;
        e.value = (double)args->error_count / 1000.0;
    }

    e.flags = args->error_type;

    /* Submit to ring buffer */
    bpf_ringbuf_output(&telemetry_ring, &e, sizeof(e), 0);
    return 0;
}

char LICENSE[] SEC("license") = "Apache-2.0";
