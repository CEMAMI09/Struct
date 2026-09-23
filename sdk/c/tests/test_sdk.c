#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "struct_sdk.h"
#include "struct_mbedtls.h"

static const char *secret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static uint8_t sent[STRUCT_MAX_FRAME], incoming[70];
static size_t sent_size;
static int sends, received, random_fail, send_fail;
static int rng(void *u, uint8_t *out, size_t n) { (void)u; memset(out, 7, n); return random_fail ? -1 : 0; }
static int transmit(void *u, const uint8_t *data, size_t n) {
  (void)u; if (send_fail) return -1;
  if (sends > 0) assert(n == sent_size && !memcmp(sent, data, n));
  memcpy(sent, data, n); sent_size = n; sends++; return 0;
}
static int receive(void *u, uint8_t *out, size_t cap) {
  int n = received; (void)u; assert(cap >= (size_t)n);
  memcpy(out, incoming, (size_t)n); received = 0; return n;
}
static void receipt(int duplicate) {
  memcpy(incoming, "STRA", 4); memcpy(incoming + 4, sent + sent_size - 32, 32);
  incoming[36] = (uint8_t)duplicate;
  assert(!struct_mbedtls_hmac(NULL, (const uint8_t *)secret, 64, incoming, 37, incoming + 37));
  received = 69;
}
int main(void) {
  struct_client c;
  struct_port p = {NULL, rng, struct_mbedtls_hmac, transmit, receive, struct_mbedtls_encrypt};
  struct_delivery d = struct_delivery_default(1);
  uint8_t payload[9], key[32], bad[32];
  struct_put_f32(payload, 23.5f); struct_put_u32(payload + 4, (uint32_t)-42); payload[8] = 1;
  assert(struct_init(&c, &p, "short", secret) == STRUCT_INVALID);
  assert(struct_init(&c, &p, "0123456789abcdef", secret) == STRUCT_IDLE);
  assert(struct_send(&c, 0, payload, 9, 1700000000, 0, d) == STRUCT_INVALID);
  assert(struct_send(&c, 1, payload, STRUCT_MAX_PAYLOAD + 1, 1700000000, 0, d) == STRUCT_INVALID);
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_PENDING);
  assert(sent_size == 75 && sent[0] == 3);
  // Golden frame is consumed by Node/Python cross-language tests.
  printf("plain="); for (size_t i = 0; i < sent_size; i++) printf("%02x", sent[i]); puts("");
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_BUSY);
  assert(struct_set_encryption(&c, key) == STRUCT_BUSY);
  receipt(0); incoming[68] ^= 1;
  assert(struct_poll(&c, 100) == STRUCT_PENDING); // forged receipt
  receipt(0); incoming[4] ^= 1;
  assert(struct_poll(&c, 200) == STRUCT_PENDING); // another packet's receipt
  assert(struct_poll(&c, 4000) == STRUCT_PENDING && sends == 2);
  receipt(1); assert(struct_poll(&c, 4500) == STRUCT_COMMITTED);

  sends = 0;
  assert(struct_send(&c, 1, payload, 9, 1700000000, UINT32_MAX - 1000, d) == STRUCT_PENDING);
  assert(struct_poll(&c, 2999) == STRUCT_PENDING && sends == 2);
  assert(struct_poll(&c, 6499) == STRUCT_UNKNOWN);
  assert(struct_poll(&c, 20000) == STRUCT_UNKNOWN && sends == 2);
  sends = 0; d.max_retries = 0; d.awake_budget_ms = 500;
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_PENDING);
  assert(struct_poll_delay(&c,490,100)==10);
  assert(struct_poll_delay(&c,500,100)==0);
  assert(struct_poll(&c, 500) == STRUCT_UNKNOWN && sends == 1);

  sends = 0; d = struct_delivery_default(0);
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_SENT);
  assert(struct_poll(&c, 1000) == STRUCT_SENT && sends == 1 && sent[0] == 2);
  sends = 0; memset(key, 0x22, sizeof(key));
  assert(struct_set_encryption_hex(&c,"not a key")==STRUCT_INVALID);
  assert(struct_set_encryption_hex(&c,"2222222222222222222222222222222222222222222222222222222222222222")==STRUCT_IDLE);
  assert(struct_set_encryption(&c, key) == STRUCT_IDLE);
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_SENT);
  assert(sent_size == 107);
  printf("encrypted="); for (size_t i = 0; i < sent_size; i++) printf("%02x", sent[i]); puts("");
  random_fail = 1;
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_CRYPTO_ERROR);
  random_fail = 0; send_fail = 1;
  assert(struct_send(&c, 1, payload, 9, 1700000000, 0, d) == STRUCT_IO_ERROR);
  memset(bad, 0, 32); struct_clear(&c); assert(!memcmp(c.encryption_key, bad, 32));
  puts("C SDK tests passed (mbedTLS HMAC and ChaCha20-Poly1305)");
  return 0;
}
