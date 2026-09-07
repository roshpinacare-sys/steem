#ifndef QOS_H
#define QOS_H

/*
 * qos.h — QoS-aware bandwidth regulator
 *
 * Models the third isolation dimension in the Omnivisor design: even once
 * a domain is allowed to touch its own memory, it must not be able to
 * starve other domains of shared interconnect/DRAM bandwidth. Each domain
 * gets a token bucket (capacity = max burst, refill rate = sustained
 * budget); requests beyond the available tokens are throttled rather than
 * denied outright, mirroring how ARM QoS-400 / MPAM-style interconnects
 * regulate shared-bus bandwidth per master ID.
 */

#define QOS_MAX_DOMAINS 8

typedef struct {
    int    domain_id;
    double capacity_bytes;    /* bucket capacity: max burst          */
    double rate_bytes_per_ms; /* sustained allocation                */
    double tokens;            /* currently available tokens          */
    double granted_total;     /* running total granted (for auditing)*/
} qos_bucket_t;

typedef struct {
    qos_bucket_t buckets[QOS_MAX_DOMAINS];
    int          count;
} qos_regulator_t;

void qos_init(qos_regulator_t *q);

int qos_add_domain(qos_regulator_t *q, int domain_id,
                    double capacity_bytes, double rate_bytes_per_ms);

/* Refills every bucket's tokens for the elapsed time. */
void qos_tick(qos_regulator_t *q, double elapsed_ms);

/*
 * Requests `requested_bytes` of bandwidth for `domain_id`. Returns the
 * number of bytes actually granted (<= requested_bytes); logs a throttle
 * line whenever a request is only partially satisfied.
 */
double qos_request(qos_regulator_t *q, int domain_id, double requested_bytes);

#endif /* QOS_H */
