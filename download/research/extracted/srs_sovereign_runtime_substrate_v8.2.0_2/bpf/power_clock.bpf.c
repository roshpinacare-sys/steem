// SPDX-License-Identifier: Apache-2.0
//
// power_clock.bpf.c — eBPF program for power/clock telemetry
//
// Attached to: perf-event (hardware PMU counter, CPU cycle counter)
// Output: ring buffer `telemetry_ring` (32-byte entries)
//
// Adm linkage: feeds Adm_thermal (Chapter 7.4) by streaming real
// power/clock metrics into the Unified Telemetry Bus.
//
// Compile: clang -target bpf -O2 -g -c power_clock.bpf.c -o power_clock.bpf.o
// Load:    bpftool prog load power_clock.bpf.o /sys/fs/bpf/power_clock

#include <linux/bpf.h>
#include <linux/perf_event.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

/* 32-byte telemetry entry (matches Python TelemetryEntry) */
struct telemetry_entry {
    __u64 ts_ns;        /* 8 bytes: timestamp */
    __u8  signal_class; /* 1 byte:  1 = POWER_CLOCK */
    __u8  source_id;    /* 1 byte:  island id */
    __u16 pad;           /* 2 bytes: padding */
    double value;        /* 8 bytes: normalised power consumption */
    __u64 raw;           /* 8 bytes: raw PMU counter */
    __u32 flags;         /* 4 bytes: flags */
} __attribute__((packed));

/* Ring buffer (BPF_MAP_TYPE_RINGBUF, 4 MiB) */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 4 * 1024 * 1024);
} telemetry_ring SEC(".maps");

/* Per-CPU array for the previous cycle count (for delta computation) */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key, __u32);
    __type(value, __u64);
    __uint(max_entries, 1);
} prev_cycles SEC(".maps");

/* Perf-event handler: called on PMU overflow */
SEC("perf_event")
int power_clock_probe(struct bpf_perf_event_data *ctx)
{
    struct telemetry_entry e = {};
    __u32 zero = 0;
    __u64 *prev = bpf_map_lookup_elem(&prev_cycles, &zero);

    e.ts_ns = bpf_ktime_get_ns();
    e.signal_class = 1;  /* POWER_CLOCK */
    e.source_id = 0;     /* APU */

    /* Compute normalised power from cycle counter delta */
    __u64 current = ctx->counter;
    if (prev) {
        __u64 delta = current - *prev;
        e.value = (double)delta / 1000000.0;  /* normalise */
        e.raw = current;
        *prev = current;
    } else {
        e.value = 0.0;
        e.raw = current;
        bpf_map_update_elem(&prev_cycles, &zero, &current, BPF_ANY);
    }

    /* Submit to ring buffer */
    bpf_ringbuf_output(&telemetry_ring, &e, sizeof(e), 0);
    return 0;
}

char LICENSE[] SEC("license") = "Apache-2.0";
