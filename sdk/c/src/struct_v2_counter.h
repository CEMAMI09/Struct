#ifndef STRUCT_V2_COUNTER_H
#define STRUCT_V2_COUNTER_H
#include "struct_secure_v2.h"
#ifdef __cplusplus
extern "C" {
#endif
#define STRUCT_V2_COUNTER_RECORD_SIZE 56u
/* One exclusively owned atomic record, backed by NVS or manufacturing storage.
 * read returns bytes read, zero absent, negative failure. write returns zero
 * ONLY after durable commit. A torn write must preserve the previous committed
 * value. Anti-rollback/cloning protection is platform/application-owned. */
typedef struct {
  void *user;
  int (*read)(void *, uint8_t *, size_t);
  int (*write)(void *, const uint8_t *, size_t);
} struct_v2_counter_port;
/* load: 0 valid; 1 absent; -1 corrupt/mismatch/I/O. Never resets a record. */
int struct_v2_counter_load(const struct_v2_counter_port *, uint32_t, const uint8_t[32], uint64_t *);
/* Trusted provisioning ONLY: caller has obtained an authenticated, consumed-once
 * server grant or never-used manufacturing credential. Refuses existing state. */
int struct_v2_counter_provision(const struct_v2_counter_port *, uint32_t, const uint8_t[32], uint64_t);
int struct_v2_counter_reserve(const struct_v2_counter_port *, uint32_t, const uint8_t[32],
                               uint32_t, uint64_t *, uint64_t *);
#ifdef __cplusplus
}
#endif
#endif
