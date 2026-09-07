#ifndef SMPU_H
#define SMPU_H

/*
 * smpu.h — System Memory Protection Unit model
 *
 * Models the spatial-isolation half of the Omnivisor design: a table of
 * physical memory regions, each owned by exactly one virtual domain
 * (APU / RPU / RISC-V soft-core VM), with read/write/exec permission bits.
 * Every memory transaction is checked against this table before it is
 * allowed to proceed — the same role played in real hardware by an SMPU /
 * SMMU / firewall peripheral sitting between a core and the shared bus.
 */

#include <stdint.h>

#define SMPU_MAX_REGIONS 16

typedef enum {
    ACCESS_READ  = 0x1,
    ACCESS_WRITE = 0x2,
    ACCESS_EXEC  = 0x4
} smpu_access_t;

typedef struct {
    int      domain_id;   /* owning virtual domain            */
    uint64_t base;        /* physical base address            */
    uint64_t size;        /* region size in bytes              */
    uint8_t  perms;       /* bitmask of smpu_access_t          */
    int      valid;
} smpu_region_t;

typedef struct {
    smpu_region_t regions[SMPU_MAX_REGIONS];
    int           count;
    uint64_t      violation_count;
} smpu_table_t;

void smpu_init(smpu_table_t *t);

/* Returns 0 on success, -1 if the table is full. */
int smpu_add_region(smpu_table_t *t, int domain_id, uint64_t base,
                     uint64_t size, uint8_t perms);

/*
 * Checks whether `domain_id` may perform `access` on [addr, addr+size).
 * Returns 1 if allowed, 0 if blocked. Any blocked access increments
 * t->violation_count and prints a fault line (mirroring an SMPU trap
 * into the hypervisor on real hardware).
 */
int smpu_check_access(smpu_table_t *t, int domain_id, uint64_t addr,
                       uint64_t size, smpu_access_t access);

#endif /* SMPU_H */
