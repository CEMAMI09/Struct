#include "struct_v2_counter.h"
#include <string.h>

static void put64(uint8_t *out, uint64_t value) {
  unsigned i; for (i = 0; i < 8; ++i) out[i] = (uint8_t)(value >> (56 - 8 * i));
}
static uint64_t get64(const uint8_t *in) {
  uint64_t result = 0; unsigned i; for (i = 0; i < 8; ++i) result = (result << 8) | in[i]; return result;
}
static void encode(uint8_t out[STRUCT_V2_COUNTER_RECORD_SIZE], uint32_t id, const uint8_t fp[32], uint64_t next) {
  memcpy(out, "SV2C", 4); struct_v2_put_u32(out + 4, id); memcpy(out + 8, fp, 32);
  put64(out + 40, next); put64(out + 48, ~next);
}
int struct_v2_counter_load(const struct_v2_counter_port *port, uint32_t id,
    const uint8_t fp[32], uint64_t *next) {
  uint8_t record[STRUCT_V2_COUNTER_RECORD_SIZE]; int n; uint64_t value;
  if (!port || !port->read || !id || !fp || !next) return -1;
  n = port->read(port->user, record, sizeof(record));
  if (!n) return 1;
  if (n != (int)sizeof(record) || memcmp(record, "SV2C", 4) ||
      struct_v2_get_u32(record + 4) != id || memcmp(record + 8, fp, 32)) return -1;
  value = get64(record + 40);
  if (value > STRUCT_V2_COUNTER_LIMIT || get64(record + 48) != ~value) return -1;
  *next = value; return 0;
}
int struct_v2_counter_provision(const struct_v2_counter_port *port, uint32_t id,
    const uint8_t fp[32], uint64_t next) {
  uint8_t record[STRUCT_V2_COUNTER_RECORD_SIZE]; uint64_t existing;
  if (!port || !port->write || next >= STRUCT_V2_COUNTER_LIMIT ||
      struct_v2_counter_load(port, id, fp, &existing) != 1) return -1;
  encode(record, id, fp, next); return port->write(port->user, record, sizeof(record)) ? -1 : 0;
}
int struct_v2_counter_reserve(const struct_v2_counter_port *port, uint32_t id,
    const uint8_t fp[32], uint32_t block, uint64_t *first, uint64_t *end) {
  uint8_t record[STRUCT_V2_COUNTER_RECORD_SIZE]; uint64_t next, limit;
  if (!port || !port->write || !block || block > 1048576u || !first || !end ||
      struct_v2_counter_load(port, id, fp, &next)) return -1;
  if (next == STRUCT_V2_COUNTER_LIMIT) return -2;
  limit = next + block; if (limit > STRUCT_V2_COUNTER_LIMIT) limit = STRUCT_V2_COUNTER_LIMIT;
  encode(record, id, fp, limit);
  if (port->write(port->user, record, sizeof(record))) return -1;
  *first = next; *end = limit; return 0;
}
