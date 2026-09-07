#ifndef SCHED_H
#define SCHED_H

/*
 * sched.h — Static partitioning scheduler
 *
 * Models the second isolation dimension: temporal isolation. Real-time
 * static-partitioning hypervisors (the class Omnivisor extends) don't
 * arbitrate cores dynamically at run time — every domain's slice of core
 * time is fixed at configuration time in a cyclic schedule, so a domain's
 * worst-case latency can be reasoned about at design time regardless of
 * what any other domain does.
 */

#define SCHED_MAX_SLOTS 16

typedef struct {
    int    domain_id;
    double start_ms;    /* offset within the major frame */
    double duration_ms;
} sched_slot_t;

typedef struct {
    sched_slot_t slots[SCHED_MAX_SLOTS];
    int          count;
    double       frame_length_ms;
} static_schedule_t;

void sched_init(static_schedule_t *s, double frame_length_ms);

int sched_add_slot(static_schedule_t *s, int domain_id,
                    double start_ms, double duration_ms);

/* Returns the domain_id scheduled at time t (mod frame length), or -1 if idle. */
int sched_active_domain(const static_schedule_t *s, double t);

#endif /* SCHED_H */
