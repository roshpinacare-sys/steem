#include "sched.h"
#include <string.h>
#include <math.h>

void sched_init(static_schedule_t *s, double frame_length_ms) {
    memset(s, 0, sizeof(*s));
    s->frame_length_ms = frame_length_ms;
}

int sched_add_slot(static_schedule_t *s, int domain_id,
                    double start_ms, double duration_ms) {
    if (s->count >= SCHED_MAX_SLOTS) return -1;
    sched_slot_t *sl = &s->slots[s->count++];
    sl->domain_id   = domain_id;
    sl->start_ms    = start_ms;
    sl->duration_ms = duration_ms;
    return 0;
}

int sched_active_domain(const static_schedule_t *s, double t) {
    double phase = fmod(t, s->frame_length_ms);
    for (int i = 0; i < s->count; i++) {
        const sched_slot_t *sl = &s->slots[i];
        if (phase >= sl->start_ms && phase < sl->start_ms + sl->duration_ms)
            return sl->domain_id;
    }
    return -1; /* idle slack time in the frame */
}
