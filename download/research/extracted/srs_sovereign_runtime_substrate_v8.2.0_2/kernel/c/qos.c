#include "qos.h"
#include <stdio.h>
#include <string.h>

void qos_init(qos_regulator_t *q) {
    memset(q, 0, sizeof(*q));
}

int qos_add_domain(qos_regulator_t *q, int domain_id,
                    double capacity_bytes, double rate_bytes_per_ms) {
    if (q->count >= QOS_MAX_DOMAINS) return -1;
    qos_bucket_t *b = &q->buckets[q->count++];
    b->domain_id         = domain_id;
    b->capacity_bytes    = capacity_bytes;
    b->rate_bytes_per_ms = rate_bytes_per_ms;
    b->tokens            = capacity_bytes; /* start full */
    b->granted_total      = 0.0;
    return 0;
}

static qos_bucket_t *find_bucket(qos_regulator_t *q, int domain_id) {
    for (int i = 0; i < q->count; i++)
        if (q->buckets[i].domain_id == domain_id) return &q->buckets[i];
    return NULL;
}

void qos_tick(qos_regulator_t *q, double elapsed_ms) {
    if (elapsed_ms < 0.0) elapsed_ms = 0.0; /* defensive: time never runs backwards */
    for (int i = 0; i < q->count; i++) {
        qos_bucket_t *b = &q->buckets[i];
        b->tokens += b->rate_bytes_per_ms * elapsed_ms;
        if (b->tokens > b->capacity_bytes) b->tokens = b->capacity_bytes;
    }
}

double qos_request(qos_regulator_t *q, int domain_id, double requested_bytes) {
    qos_bucket_t *b = find_bucket(q, domain_id);
    if (!b) return 0.0;

    double granted = (requested_bytes <= b->tokens) ? requested_bytes : b->tokens;
    if (granted < requested_bytes) {
        fprintf(stderr,
            "[QoS THROTTLE] domain %d requested %.0f B, granted %.0f B "
            "(budget=%.0f B/ms) -> other domains' bandwidth protected\n",
            domain_id, requested_bytes, granted, b->rate_bytes_per_ms);
    }
    b->tokens -= granted;
    b->granted_total += granted;
    return granted;
}
