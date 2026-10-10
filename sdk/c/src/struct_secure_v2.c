#include "struct_secure_v2.h"
#include <string.h>

static void wipe(void *p, size_t n) { volatile uint8_t *b = (volatile uint8_t *)p; while (n--) *b++ = 0; }
void struct_v2_put_u32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24); p[1] = (uint8_t)(v >> 16); p[2] = (uint8_t)(v >> 8); p[3] = (uint8_t)v;
}
uint32_t struct_v2_get_u32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
int struct_v2_control(uint8_t slot, int confirmed, int batch, uint8_t *out) {
  if (!out || slot > 15 || (confirmed != 0 && confirmed != 1) || (batch != 0 && batch != 1)) return -1;
  *out = (uint8_t)(STRUCT_V2_GENERATION | (slot << 2) |
    (confirmed ? STRUCT_V2_RECEIPT_REQUESTED : 0u) | (batch ? STRUCT_V2_BATCH : 0u));
  return 0;
}
void struct_v2_nonce(const uint8_t prefix[8], uint32_t sequence, uint8_t out[12]) {
  memcpy(out, prefix, 8); struct_v2_put_u32(out + 8, sequence);
}
int struct_v2_derive(const struct_v2_port *port, uint32_t wire_id,
                     const uint8_t root[32], struct_v2_keys *keys) {
  static const uint8_t salt[] = "struct-secure-v2/hkdf-sha256";
  static const char *labels[] = { "struct-v2/uplink/key", "struct-v2/downlink/key",
    "struct-v2/uplink/nonce", "struct-v2/downlink/nonce" };
  uint8_t info[64]; unsigned i;
  uint8_t *outputs[4]; size_t lengths[4] = {32, 32, 8, 8};
  if (!port || !port->hkdf || !root || !keys || !wire_id) return -1;
  outputs[0] = keys->uplink_key; outputs[1] = keys->downlink_key;
  outputs[2] = keys->uplink_prefix; outputs[3] = keys->downlink_prefix;
  memset(keys, 0, sizeof(*keys));
  for (i = 0; i < 4; ++i) {
    size_t n = strlen(labels[i]);
    memcpy(info, labels[i], n); info[n] = 0; info[n + 1] = STRUCT_SECURE_V2_PROTOCOL_VERSION;
    struct_v2_put_u32(info + n + 2, wire_id);
    if (port->hkdf(port->user, salt, sizeof(salt) - 1, root, 32, info, n + 6, outputs[i], lengths[i])) {
      wipe(keys, sizeof(*keys)); wipe(info, sizeof(info)); return -1;
    }
  }
  wipe(info, sizeof(info)); return 0;
}
int struct_v2_encode_frame(const struct_v2_port *port, const struct_v2_keys *keys,
    uint32_t wire_id, uint32_t sequence, uint8_t control, const uint8_t *plain, size_t n,
    uint8_t *out, size_t cap, size_t *written) {
  uint8_t nonce[12], empty = 0; int result;
  if (written) *written = 0;
  if (!port || !port->seal || !keys || !wire_id || !out || !written ||
      (control & STRUCT_V2_GENERATION_MASK) != STRUCT_V2_GENERATION ||
      (!plain && n) || n > STRUCT_V2_MAX_FRAME - STRUCT_V2_OVERHEAD || cap < n + STRUCT_V2_OVERHEAD) return -1;
  out[0] = control; struct_v2_put_u32(out + 1, wire_id); struct_v2_put_u32(out + 5, sequence);
  struct_v2_nonce(keys->uplink_prefix, sequence, nonce);
  result = port->seal(port->user, keys->uplink_key, nonce, out, STRUCT_V2_HEADER_SIZE,
    plain ? plain : &empty, n, out + STRUCT_V2_HEADER_SIZE, out + STRUCT_V2_HEADER_SIZE + n);
  wipe(nonce, sizeof(nonce));
  if (result) { wipe(out, n + STRUCT_V2_OVERHEAD); return -1; }
  *written = n + STRUCT_V2_OVERHEAD; return 0;
}
int struct_v2_encode_receipt(const struct_v2_port *port, const struct_v2_keys *keys,
    uint32_t sequence, uint8_t out[STRUCT_V2_RECEIPT_SIZE]) {
  uint8_t nonce[12], empty = 0; int result;
  if (!port || !port->seal || !keys || !out) return -1;
  out[0] = STRUCT_V2_RECEIPT_CONTROL; struct_v2_put_u32(out + 1, sequence);
  struct_v2_nonce(keys->downlink_prefix, sequence, nonce);
  result = port->seal(port->user, keys->downlink_key, nonce, out, 5, &empty, 0, &empty, out + 5);
  wipe(nonce, sizeof(nonce));
  if (result) { wipe(out, STRUCT_V2_RECEIPT_SIZE); return -1; } return 0;
}
int struct_v2_verify_receipt(const struct_v2_port *port, const struct_v2_keys *keys,
    uint32_t sequence, const uint8_t *receipt, size_t n) {
  uint8_t nonce[12], empty = 0; int result;
  if (!port || !port->open || !keys || !receipt || n != STRUCT_V2_RECEIPT_SIZE ||
      receipt[0] != STRUCT_V2_RECEIPT_CONTROL || struct_v2_get_u32(receipt + 1) != sequence) return -1;
  struct_v2_nonce(keys->downlink_prefix, sequence, nonce);
  result = port->open(port->user, keys->downlink_key, nonce, receipt, 5, &empty, 0, receipt + 5, &empty);
  wipe(nonce, sizeof(nonce)); return result ? -1 : 0;
}
struct_result struct_v2_init(struct_v2_client *c, const struct_v2_port *port, uint32_t wire_id,
    const uint8_t root[32], uint32_t block, size_t max_frame) {
  if (!c || !port || !port->hkdf || !port->sha256 || !port->seal || !port->open ||
      !port->send || !port->reserve || !root || !wire_id || !block || block > 1048576u ||
      max_frame < STRUCT_V2_OVERHEAD + 1 || max_frame > STRUCT_V2_MAX_FRAME) return STRUCT_INVALID;
  memset(c, 0, sizeof(*c)); c->port = *port; c->wire_id = wire_id;
  c->reservation_size = block; c->max_frame = max_frame;
  if (struct_v2_derive(port, wire_id, root, &c->keys) ||
      port->sha256(port->user, c->keys.uplink_key, 32, c->key_fingerprint)) {
    struct_v2_clear(c); return STRUCT_CRYPTO_ERROR;
  }
  return STRUCT_IDLE;
}
struct_result struct_v2_init_hex(struct_v2_client *c, const struct_v2_port *port, uint32_t wire_id,
    const char *hex, uint32_t block, size_t max_frame) {
  uint8_t root[32]; size_t i; struct_result result;
  if (!hex || strlen(hex) != 64) return STRUCT_INVALID;
  for (i = 0; i < 64; ++i) {
    unsigned char b = (unsigned char)hex[i]; int nibble = b >= '0' && b <= '9' ? b - '0' :
      b >= 'a' && b <= 'f' ? b - 'a' + 10 : b >= 'A' && b <= 'F' ? b - 'A' + 10 : -1;
    if (nibble < 0) { wipe(root, sizeof(root)); return STRUCT_INVALID; }
    if (!(i & 1)) root[i / 2] = (uint8_t)(nibble << 4); else root[i / 2] |= (uint8_t)nibble;
  }
  result = struct_v2_init(c, port, wire_id, root, block, max_frame); wipe(root, sizeof(root)); return result;
}
static struct_result allocate_sequence(struct_v2_client *c) {
  uint64_t first = 0, end = 0; int result;
  if (c->counter_fault) return c->state = STRUCT_V2_COUNTER_ERROR;
  if (c->next_sequence == c->reserved_end) {
    result = c->port.reserve(c->port.user, c->wire_id, c->key_fingerprint,
      c->reservation_size, &first, &end);
    if (result == -2) return c->state = STRUCT_V2_EXHAUSTED;
    if (result || first >= end || end > STRUCT_V2_COUNTER_LIMIT || end - first > c->reservation_size ||
        (c->reserved_end && first < c->reserved_end)) {
      c->counter_fault = 1; return c->state = STRUCT_V2_COUNTER_ERROR;
    }
    c->next_sequence = first; c->reserved_end = end;
  }
  if (c->next_sequence >= STRUCT_V2_COUNTER_LIMIT) return c->state = STRUCT_V2_EXHAUSTED;
  c->sequence = (uint32_t)c->next_sequence++; return STRUCT_IDLE;
}
static struct_result send_frame(struct_v2_client *c, uint8_t slot, int batch,
    const uint8_t *plain, size_t n, uint32_t now, struct_delivery d) {
  uint8_t control; struct_result result;
  if (!c || !c->port.send || !plain || !n || n > c->max_frame - STRUCT_V2_OVERHEAD ||
      struct_v2_control(slot, d.confirmed, batch, &control) ||
      (d.confirmed && (!c->port.receive || d.retry_ms < 1000 || d.retry_ms > 30000 ||
       d.awake_budget_ms < 1 || d.awake_budget_ms > 30000 || d.max_retries > 3))) return STRUCT_INVALID;
  if (c->state == STRUCT_PENDING) return STRUCT_BUSY;
  result = allocate_sequence(c); if (result != STRUCT_IDLE) return result;
  if (struct_v2_encode_frame(&c->port, &c->keys, c->wire_id, c->sequence, control,
    plain, n, c->frame, c->max_frame, &c->frame_len)) return c->state = STRUCT_CRYPTO_ERROR;
  c->delivery = d; c->retries = 0; c->started_ms = c->last_sent_ms = now; c->next_wait_ms = d.retry_ms;
  /* A send error may have delivered the datagram: never promise non-delivery. */
  if (c->port.send(c->port.user, c->frame, c->frame_len)) return c->state = STRUCT_UNKNOWN;
  return c->state = d.confirmed ? STRUCT_PENDING : STRUCT_SENT;
}
struct_result struct_v2_send(struct_v2_client *c, uint8_t slot, const uint8_t *plain,
    size_t n, uint32_t now, struct_delivery d) { return send_frame(c, slot, 0, plain, n, now, d); }
size_t struct_v2_batch_capacity(const struct_v2_client *c, size_t size) {
  size_t count;
  if (!c || !size || c->max_frame <= STRUCT_V2_OVERHEAD + 1) return 0;
  count = (c->max_frame - STRUCT_V2_OVERHEAD - 1) / size;
  return count > 255 ? 255 : count;
}
struct_result struct_v2_send_batch(struct_v2_client *c, uint8_t slot, const uint8_t *records,
    size_t size, size_t count, size_t *encoded, uint32_t now, struct_delivery d) {
  uint8_t payload[STRUCT_V2_MAX_FRAME - STRUCT_V2_OVERHEAD];
  size_t chunk = struct_v2_batch_capacity(c, size); struct_result result;
  if (encoded) *encoded = 0;
  if (!c || !records || !encoded || !count || !chunk || count > SIZE_MAX / size) return STRUCT_INVALID;
  if (chunk > count) chunk = count;
  payload[0] = (uint8_t)chunk; memcpy(payload + 1, records, chunk * size);
  result = send_frame(c, slot, 1, payload, 1 + chunk * size, now, d);
  wipe(payload, sizeof(payload));
  if (result == STRUCT_PENDING || result == STRUCT_SENT || result == STRUCT_UNKNOWN) *encoded = chunk;
  return result;
}
struct_result struct_v2_poll(struct_v2_client *c, uint32_t now) {
  uint8_t receipt[STRUCT_V2_RECEIPT_SIZE + 1]; int n;
  if (!c) return STRUCT_INVALID;
  if (c->state != STRUCT_PENDING) return c->state;
  if ((uint32_t)(now - c->started_ms) >= c->delivery.awake_budget_ms) return c->state = STRUCT_UNKNOWN;
  n = c->port.receive(c->port.user, receipt, sizeof(receipt));
  if (n < 0) return c->state = STRUCT_UNKNOWN;
  if (n == STRUCT_V2_RECEIPT_SIZE && !struct_v2_verify_receipt(&c->port, &c->keys,
      c->sequence, receipt, sizeof(receipt) - 1)) return c->state = STRUCT_COMMITTED;
  if ((uint32_t)(now - c->last_sent_ms) >= c->next_wait_ms && c->retries < c->delivery.max_retries) {
    if (c->port.send(c->port.user, c->frame, c->frame_len)) return c->state = STRUCT_UNKNOWN;
    ++c->retries; c->last_sent_ms = now; c->next_wait_ms *= 2;
  }
  return c->state;
}
uint32_t struct_v2_poll_delay(const struct_v2_client *c, uint32_t now, uint32_t cap) {
  uint32_t elapsed, remaining, wait;
  if (!c || c->state != STRUCT_PENDING) return 0;
  elapsed = now - c->started_ms;
  if (elapsed >= c->delivery.awake_budget_ms) return 0;
  remaining = c->delivery.awake_budget_ms - elapsed;
  if (c->retries < c->delivery.max_retries) {
    elapsed = now - c->last_sent_ms; wait = elapsed >= c->next_wait_ms ? 0 : c->next_wait_ms - elapsed;
    if (wait < remaining) remaining = wait;
  }
  return remaining < cap ? remaining : cap;
}
void struct_v2_cancel(struct_v2_client *c) { if (c && c->state == STRUCT_PENDING) c->state = STRUCT_UNKNOWN; }
void struct_v2_clear(struct_v2_client *c) { if (c) wipe(c, sizeof(*c)); }
