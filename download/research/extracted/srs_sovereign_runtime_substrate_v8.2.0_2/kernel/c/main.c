/*
 * main.c — Omnivisor-style isolation demo
 *
 * Sets up three heterogeneous virtual domains, modeled on the paper's
 * target platform:
 *
 *   DOM_APU    — ARM Application Processing Unit  : general-purpose Linux VM
 *   DOM_RPU    — ARM Real-time Processing Unit    : hard real-time control loop
 *   DOM_RISCV  — RISC-V soft-core on FPGA fabric  : bare-metal accelerator VM
 *
 * Every transaction a domain issues is run through omnivisor_dispatch(),
 * which enforces the three isolation properties in order:
 *
 *   1. Temporal  — is this domain even scheduled right now?      (sched.*)
 *   2. Spatial   — does it own the memory it's touching?         (smpu.*)
 *   3. QoS       — is there bandwidth budget left for it?        (qos.*)
 *
 * The scenario below deliberately includes both well-behaved traffic and
 * three "misbehaving" attempts (one per isolation dimension) to prove each
 * mechanism actually holds the line, then prints a pass/fail summary.
 */

#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "smpu.h"
#include "qos.h"
#include "sched.h"

#define DOM_APU   0
#define DOM_RPU   1
#define DOM_RISCV 2

typedef enum { EV_MEM, EV_BW } event_kind_t;

typedef struct {
    double        time_ms;
    int           domain_id;
    const char   *label;
    event_kind_t  kind;
    /* EV_MEM fields */
    uint64_t      addr;
    uint64_t      size;
    smpu_access_t access;
    /* EV_BW fields */
    double        bytes_requested;
} sim_event_t;

static smpu_table_t     g_smpu;
static qos_regulator_t  g_qos;
static static_schedule_t g_sched;

static int g_temporal_violations = 0;
static int g_spatial_ok          = 0;
static int g_spatial_blocked     = 0;
static int g_qos_full_grants     = 0;
static int g_qos_throttles       = 0;

/* The single choke point every domain's traffic must pass through. */
static void omnivisor_dispatch(const sim_event_t *ev) {
    printf("t=%5.1fms  domain=%-6s  %-28s ",
           ev->time_ms,
           ev->domain_id == DOM_APU ? "APU" : ev->domain_id == DOM_RPU ? "RPU" : "RISCV",
           ev->label);

    int scheduled = sched_active_domain(&g_sched, ev->time_ms);
    if (scheduled != ev->domain_id) {
        printf("-> BLOCKED (not this domain's time slot; scheduled=%d)\n", scheduled);
        g_temporal_violations++;
        return;
    }

    if (ev->kind == EV_MEM) {
        int ok = smpu_check_access(&g_smpu, ev->domain_id, ev->addr, ev->size, ev->access);
        if (ok) {
            printf("-> ALLOWED (0x%lx, size %lu)\n", (unsigned long)ev->addr, (unsigned long)ev->size);
            g_spatial_ok++;
        } else {
            printf("-> BLOCKED (see SMPU fault line above)\n");
            g_spatial_blocked++;
        }
    } else { /* EV_BW */
        double granted = qos_request(&g_qos, ev->domain_id, ev->bytes_requested);
        if (granted >= ev->bytes_requested - 1e-9) {
            printf("-> GRANTED %.0f/%.0f B\n", granted, ev->bytes_requested);
            g_qos_full_grants++;
        } else {
            printf("-> THROTTLED to %.0f/%.0f B (see QoS line above)\n", granted, ev->bytes_requested);
            g_qos_throttles++;
        }
    }
}

int main(void) {
    /* ---- 1. Configure static time-partitioning: 10ms major frame ---- */
    sched_init(&g_sched, 10.0);
    sched_add_slot(&g_sched, DOM_APU,   0.0, 6.0);  /* 0–6ms   : bulk Linux work   */
    sched_add_slot(&g_sched, DOM_RPU,   6.0, 2.0);  /* 6–8ms   : short, deterministic */
    sched_add_slot(&g_sched, DOM_RISCV, 8.0, 2.0);  /* 8–10ms  : accelerator burst  */

    /* ---- 2. Configure SMPU regions: one owner per region, no overlap ---- */
    smpu_init(&g_smpu);
    smpu_add_region(&g_smpu, DOM_APU,   0x80000000ULL, 0x10000000ULL, ACCESS_READ | ACCESS_WRITE | ACCESS_EXEC);
    smpu_add_region(&g_smpu, DOM_RPU,   0x90000000ULL, 0x00100000ULL, ACCESS_READ | ACCESS_WRITE);
    smpu_add_region(&g_smpu, DOM_RISCV, 0x91000000ULL, 0x00080000ULL, ACCESS_READ | ACCESS_WRITE | ACCESS_EXEC);

    /* ---- 3. Configure QoS budgets (bytes/ms sustained, plus burst cap) ---- */
    qos_init(&g_qos);
    qos_add_domain(&g_qos, DOM_APU,   4096.0, 200.0);
    qos_add_domain(&g_qos, DOM_RPU,    512.0,  64.0);
    qos_add_domain(&g_qos, DOM_RISCV,  256.0,  32.0);

    printf("=== Omnivisor-style isolation demo ===\n\n");

    /* Strict chronological order: this is a timeline simulation, and qos_tick
     * advances every bucket's clock by (this event's time - the previous
     * event's time), so time must only ever move forward. */
    sim_event_t events[] = {
        {1.0, DOM_APU,   "normal heap write",                    EV_MEM, 0x80001000ULL, 64,  ACCESS_WRITE, 0},
        {1.5, DOM_APU,   "normal bandwidth request",              EV_BW,  0, 0, 0,           800.0},

        /* --- misbehavior #1: spatial — APU reaches into the RPU's region --- */
        {2.0, DOM_APU,   "MISBEHAVE: write into RPU region",     EV_MEM, 0x90000100ULL, 8,   ACCESS_WRITE, 0},

        /* --- misbehavior #2: temporal — RPU tries to act during APU's slot --- */
        {3.0, DOM_RPU,   "MISBEHAVE: access outside own slot",   EV_MEM, 0x90000100ULL, 8,   ACCESS_WRITE, 0},

        {6.5, DOM_RPU,   "control-loop register write",          EV_MEM, 0x90000100ULL, 8,   ACCESS_WRITE, 0},
        {6.6, DOM_RPU,   "telemetry bandwidth request",           EV_BW,  0, 0, 0,           100.0},
        {8.5, DOM_RISCV, "accelerator buffer read",               EV_MEM, 0x91000200ULL, 128, ACCESS_READ, 0},

        /* --- misbehavior #3: QoS — RISC-V demands a burst far past its budget --- */
        {8.7, DOM_RISCV, "MISBEHAVE: oversized bandwidth burst", EV_BW,  0, 0, 0,           5000.0},
    };

    size_t n = sizeof(events) / sizeof(events[0]);
    double last_t = 0.0;
    for (size_t i = 0; i < n; i++) {
        assert(events[i].time_ms >= last_t && "events[] must be in non-decreasing time_ms order");
        qos_tick(&g_qos, events[i].time_ms - last_t);
        last_t = events[i].time_ms;
        omnivisor_dispatch(&events[i]);
    }

    printf("\n=== Summary ===\n");
    printf("Temporal violations blocked : %d\n", g_temporal_violations);
    printf("Spatial accesses allowed    : %d\n", g_spatial_ok);
    printf("Spatial violations blocked  : %d\n", g_spatial_blocked);
    printf("QoS requests granted in full: %d\n", g_qos_full_grants);
    printf("QoS requests throttled      : %d\n", g_qos_throttles);
    printf("SMPU fault count (internal) : %lu\n", (unsigned long)g_smpu.violation_count);

    int isolation_held =
        g_temporal_violations == 1 &&   /* the one deliberate attempt, and it was blocked */
        g_spatial_blocked   == 1 &&     /* the one deliberate attempt, and it was blocked */
        g_qos_throttles     == 1;       /* the one deliberate attempt, and it was throttled */

    printf("\nRESULT: %s\n", isolation_held
        ? "ISOLATION HELD — every misbehaving request was contained, "
          "every well-behaved request succeeded."
        : "ISOLATION FAILED — check the log above.");

    return isolation_held ? 0 : 1;
}
