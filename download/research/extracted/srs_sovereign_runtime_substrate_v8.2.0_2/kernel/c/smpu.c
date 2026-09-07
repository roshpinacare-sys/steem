#include "smpu.h"
#include <stdio.h>
#include <string.h>

void smpu_init(smpu_table_t *t) {
    memset(t, 0, sizeof(*t));
}

int smpu_add_region(smpu_table_t *t, int domain_id, uint64_t base,
                     uint64_t size, uint8_t perms) {
    if (t->count >= SMPU_MAX_REGIONS) return -1;
    smpu_region_t *r = &t->regions[t->count++];
    r->domain_id = domain_id;
    r->base      = base;
    r->size      = size;
    r->perms     = perms;
    r->valid     = 1;
    return 0;
}

static int region_contains(const smpu_region_t *r, uint64_t addr, uint64_t size) {
    return addr >= r->base && (addr + size) <= (r->base + r->size);
}

static const char *access_name(smpu_access_t a) {
    if (a == ACCESS_WRITE) return "WRITE";
    if (a == ACCESS_EXEC)  return "EXEC";
    return "READ";
}

int smpu_check_access(smpu_table_t *t, int domain_id, uint64_t addr,
                       uint64_t size, smpu_access_t access) {
    for (int i = 0; i < t->count; i++) {
        smpu_region_t *r = &t->regions[i];
        if (!r->valid || !region_contains(r, addr, size)) continue;

        if (r->domain_id != domain_id) {
            t->violation_count++;
            fprintf(stderr,
                "[SMPU FAULT] domain %d attempted %s at 0x%lx (size %lu) "
                "owned by domain %d -> BLOCKED (spatial isolation held)\n",
                domain_id, access_name(access),
                (unsigned long)addr, (unsigned long)size, r->domain_id);
            return 0;
        }
        if (!(r->perms & access)) {
            t->violation_count++;
            fprintf(stderr,
                "[SMPU FAULT] domain %d permission violation (%s) at 0x%lx "
                "region perms=0x%x -> BLOCKED\n",
                domain_id, access_name(access), (unsigned long)addr, r->perms);
            return 0;
        }
        return 1; /* allowed: owned by this domain and permission bit set */
    }

    /* Address isn't covered by any known region at all. */
    t->violation_count++;
    fprintf(stderr,
        "[SMPU FAULT] domain %d accessed unmapped address 0x%lx -> BLOCKED\n",
        domain_id, (unsigned long)addr);
    return 0;
}
