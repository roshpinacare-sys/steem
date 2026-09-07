/*
 * tests.c — unit tests for smpu / qos / sched, run independently of the
 * narrative demo in main.c. Plain assert()-based; exits non-zero (aborts)
 * on the first failing assertion, prints a summary line on success.
 */

#include <assert.h>
#include <stdio.h>
#include "smpu.h"
#include "qos.h"
#include "sched.h"

static void test_smpu_owner_access_allowed(void) {
    smpu_table_t t;
    smpu_init(&t);
    smpu_add_region(&t, 0, 0x1000, 0x100, ACCESS_READ | ACCESS_WRITE);
    assert(smpu_check_access(&t, 0, 0x1000, 0x10, ACCESS_READ)  == 1);
    assert(smpu_check_access(&t, 0, 0x1000, 0x10, ACCESS_WRITE) == 1);
    assert(t.violation_count == 0);
}

static void test_smpu_cross_domain_blocked(void) {
    smpu_table_t t;
    smpu_init(&t);
    smpu_add_region(&t, 0, 0x1000, 0x100, ACCESS_READ | ACCESS_WRITE);
    smpu_add_region(&t, 1, 0x2000, 0x100, ACCESS_READ | ACCESS_WRITE);
    assert(smpu_check_access(&t, 1, 0x1000, 0x10, ACCESS_READ) == 0); /* domain 1 into domain 0's region */
    assert(t.violation_count == 1);
}

static void test_smpu_permission_bits_enforced(void) {
    smpu_table_t t;
    smpu_init(&t);
    smpu_add_region(&t, 0, 0x1000, 0x100, ACCESS_READ); /* no WRITE bit */
    assert(smpu_check_access(&t, 0, 0x1000, 0x10, ACCESS_WRITE) == 0);
    assert(t.violation_count == 1);
}

static void test_smpu_unmapped_address_blocked(void) {
    smpu_table_t t;
    smpu_init(&t);
    smpu_add_region(&t, 0, 0x1000, 0x100, ACCESS_READ | ACCESS_WRITE);
    assert(smpu_check_access(&t, 0, 0xDEAD0000, 0x10, ACCESS_READ) == 0);
    assert(t.violation_count == 1);
}

static void test_smpu_out_of_bounds_span_blocked(void) {
    smpu_table_t t;
    smpu_init(&t);
    smpu_add_region(&t, 0, 0x1000, 0x100, ACCESS_READ | ACCESS_WRITE);
    /* starts in-region but the access spans past the region's end */
    assert(smpu_check_access(&t, 0, 0x10F8, 0x10, ACCESS_READ) == 0);
}

static void test_qos_full_grant_within_budget(void) {
    qos_regulator_t q;
    qos_init(&q);
    qos_add_domain(&q, 0, 1000.0, 100.0);
    double granted = qos_request(&q, 0, 500.0);
    assert(granted == 500.0);
}

static void test_qos_throttles_over_budget(void) {
    qos_regulator_t q;
    qos_init(&q);
    qos_add_domain(&q, 0, 1000.0, 100.0);
    double granted = qos_request(&q, 0, 2000.0); /* only 1000 tokens available at start */
    assert(granted == 1000.0);
}

static void test_qos_refill_over_time(void) {
    qos_regulator_t q;
    qos_init(&q);
    qos_add_domain(&q, 0, 1000.0, 100.0);
    qos_request(&q, 0, 1000.0);           /* drain the bucket completely */
    double granted_empty = qos_request(&q, 0, 100.0);
    assert(granted_empty == 0.0);          /* nothing left, no time has passed */
    qos_tick(&q, 5.0);                     /* 5ms at 100 B/ms = 500 tokens back */
    double granted_after = qos_request(&q, 0, 100.0);
    assert(granted_after == 100.0);
}

static void test_qos_domains_are_independent(void) {
    qos_regulator_t q;
    qos_init(&q);
    qos_add_domain(&q, 0, 100.0, 10.0);
    qos_add_domain(&q, 1, 100.0, 10.0);
    qos_request(&q, 0, 100.0); /* drain domain 0 completely */
    double granted_1 = qos_request(&q, 1, 100.0);
    assert(granted_1 == 100.0); /* domain 1 unaffected by domain 0's usage */
}

static void test_sched_static_slots(void) {
    static_schedule_t s;
    sched_init(&s, 10.0);
    sched_add_slot(&s, 0, 0.0, 6.0);
    sched_add_slot(&s, 1, 6.0, 2.0);
    sched_add_slot(&s, 2, 8.0, 2.0);

    assert(sched_active_domain(&s, 0.0)  == 0);
    assert(sched_active_domain(&s, 5.9)  == 0);
    assert(sched_active_domain(&s, 6.0)  == 1);
    assert(sched_active_domain(&s, 7.9)  == 1);
    assert(sched_active_domain(&s, 8.0)  == 2);
    assert(sched_active_domain(&s, 9.9)  == 2);
}

static void test_sched_wraps_across_frames(void) {
    static_schedule_t s;
    sched_init(&s, 10.0);
    sched_add_slot(&s, 0, 0.0, 6.0);
    sched_add_slot(&s, 1, 6.0, 4.0);
    /* t=13.5 -> phase 3.5 -> domain 0, same as t=3.5 in frame 0 */
    assert(sched_active_domain(&s, 13.5) == 0);
    assert(sched_active_domain(&s, 16.5) == 1);
}

static void test_sched_idle_gap(void) {
    static_schedule_t s;
    sched_init(&s, 10.0);
    sched_add_slot(&s, 0, 0.0, 4.0);
    /* 4..10 is deliberately left unscheduled slack time */
    assert(sched_active_domain(&s, 5.0) == -1);
}

int main(void) {
    test_smpu_owner_access_allowed();
    test_smpu_cross_domain_blocked();
    test_smpu_permission_bits_enforced();
    test_smpu_unmapped_address_blocked();
    test_smpu_out_of_bounds_span_blocked();
    test_qos_full_grant_within_budget();
    test_qos_throttles_over_budget();
    test_qos_refill_over_time();
    test_qos_domains_are_independent();
    test_sched_static_slots();
    test_sched_wraps_across_frames();
    test_sched_idle_gap();

    printf("All 12 unit tests passed.\n");
    return 0;
}
