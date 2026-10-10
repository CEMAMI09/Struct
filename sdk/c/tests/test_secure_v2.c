#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "struct_secure_v2.h"
#include "struct_v2_counter.h"
#include "struct_v2_mbedtls.h"
#include "secure_v2_vectors.h"

typedef struct {
  uint8_t durable[STRUCT_V2_COUNTER_RECORD_SIZE], sent[STRUCT_V2_MAX_FRAME], incoming[22];
  size_t durable_n, sent_n; int sends, incoming_n, writes, fail_before_write, fail_after_write, crypto_fail, send_fail;
} fixture_state;
static fixture_state state;
static int read_state(void *u, uint8_t *out, size_t n) {
  fixture_state *s = u; assert(n >= s->durable_n); memcpy(out, s->durable, s->durable_n); return (int)s->durable_n;
}
static int write_state(void *u, const uint8_t *input, size_t n) {
  fixture_state *s = u; ++s->writes;
  if (s->fail_before_write) return -1;
  assert(n == sizeof(s->durable)); memcpy(s->durable, input, n); s->durable_n = n;
  return s->fail_after_write ? -1 : 0;
}
static int reserve(void *u, uint32_t id, const uint8_t fp[32], uint32_t block, uint64_t *first, uint64_t *end) {
  struct_v2_counter_port port = {u, read_state, write_state}; return struct_v2_counter_reserve(&port, id, fp, block, first, end);
}
static int send_bytes(void *u, const uint8_t *bytes, size_t n) {
  fixture_state *s = u; assert(n <= sizeof(s->sent)); memcpy(s->sent, bytes, n); s->sent_n = n; ++s->sends;
  return s->send_fail ? -1 : 0;
}
static int receive_bytes(void *u, uint8_t *out, size_t n) {
  fixture_state *s = u; assert(n >= (size_t)s->incoming_n);
  memcpy(out, s->incoming, (size_t)s->incoming_n); int result = s->incoming_n; s->incoming_n = 0; return result;
}
static int seal(void *u, const uint8_t key[32], const uint8_t nonce[12], const uint8_t *aad,
    size_t aad_n, const uint8_t *plain, size_t n, uint8_t *cipher, uint8_t tag[16]) {
  return ((fixture_state *)u)->crypto_fail ? -1 : struct_v2_mbedtls_seal(u, key, nonce, aad, aad_n, plain, n, cipher, tag);
}
static struct_v2_port callbacks(void) {
  struct_v2_port p = {&state, struct_v2_mbedtls_hkdf, struct_v2_mbedtls_sha256,
    seal, struct_v2_mbedtls_open, send_bytes, receive_bytes, reserve}; return p;
}
static unsigned nibble(char c) { return c >= '0' && c <= '9' ? (unsigned)(c - '0') : (unsigned)(c - 'a' + 10); }
static size_t unhex(const char *hex, uint8_t *out) {
  size_t n = strlen(hex); assert(!(n & 1)); for (size_t i = 0; i < n / 2; ++i) out[i] = (uint8_t)((nibble(hex[2*i]) << 4) | nibble(hex[2*i+1])); return n / 2;
}
static void assert_hex(const uint8_t *bytes, size_t n, const char *expected) {
  assert(strlen(expected) == 2*n);
  for (size_t i = 0; i < n; ++i) assert(bytes[i] == (uint8_t)((nibble(expected[2*i]) << 4) | nibble(expected[2*i+1])));
}
static void print_hex(const char *label, const uint8_t *bytes, size_t n) {
  printf("%s=", label); for (size_t i = 0; i < n; ++i) printf("%02x", bytes[i]); putchar('\n');
}
static void vectors(void) {
  struct_v2_port p = callbacks(); struct_v2_keys keys;
  uint8_t root[32], plain[STRUCT_V2_MAX_FRAME], frame[STRUCT_V2_MAX_FRAME], decrypted[STRUCT_V2_MAX_FRAME], nonce[12], receipt[21]; size_t written;
  for (size_t i = 0; i < sizeof(struct_v2_test_vectors)/sizeof(struct_v2_test_vectors[0]); ++i) {
    const struct_v2_test_vector *v = &struct_v2_test_vectors[i];
    assert(unhex(v->rootSecret, root) == 32); size_t n = unhex(v->plaintext, plain);
    assert(!struct_v2_derive(&p, v->wireDeviceId, root, &keys));
    assert_hex(keys.uplink_key, 32, v->uplinkKey); assert_hex(keys.downlink_key, 32, v->downlinkKey);
    assert_hex(keys.uplink_prefix, 8, v->uplinkPrefix); assert_hex(keys.downlink_prefix, 8, v->downlinkPrefix);
    struct_v2_nonce(keys.uplink_prefix, v->sequence, nonce); assert_hex(nonce, 12, v->nonce);
    assert(!struct_v2_encode_frame(&p, &keys, v->wireDeviceId, v->sequence, v->control, plain, n, frame, sizeof(frame), &written));
    assert(written == n + 25); assert_hex(frame, 9, v->aad); assert_hex(frame + 9, n, v->ciphertext);
    assert_hex(frame + 9 + n, 16, v->tag); assert_hex(frame, written, v->frame);
    assert(!struct_v2_mbedtls_open(NULL, keys.uplink_key, nonce, frame, 9, frame + 9, n, frame + 9 + n, decrypted));
    assert(!memcmp(plain, decrypted, n));
    /* Every byte of header, ciphertext and tag is authenticated. */
    for (size_t byte = 0; byte < written; ++byte) {
      frame[byte] ^= 1;
      assert(struct_v2_mbedtls_open(NULL, keys.uplink_key, nonce, frame, 9, frame + 9, n, frame + 9 + n, decrypted));
      frame[byte] ^= 1;
    }
    keys.uplink_key[0] ^= 1;
    assert(struct_v2_mbedtls_open(NULL, keys.uplink_key, nonce, frame, 9, frame + 9, n, frame + 9 + n, decrypted)); keys.uplink_key[0] ^= 1;
    nonce[0] ^= 1; assert(struct_v2_mbedtls_open(NULL, keys.uplink_key, nonce, frame, 9, frame + 9, n, frame + 9 + n, decrypted));
    assert(!struct_v2_encode_receipt(&p, &keys, v->sequence, receipt)); assert_hex(receipt, 21, v->receipt);
    assert(!struct_v2_verify_receipt(&p, &keys, v->sequence, receipt, 21));
    for (size_t byte = 0; byte < 21; ++byte) { receipt[byte] ^= 1; assert(struct_v2_verify_receipt(&p, &keys, v->sequence, receipt, 21)); receipt[byte] ^= 1; }
    assert(struct_v2_verify_receipt(&p, &keys, v->sequence, receipt, 20)); assert(struct_v2_verify_receipt(&p, &keys, v->sequence + 1, receipt, 21));
    printf("vector=%s\n", v->name); print_hex("frame", frame, written); print_hex("receipt", receipt, 21);
    struct_v2_nonce(keys.downlink_prefix, v->sequence, nonce); assert_hex(nonce, 12, v->downlinkNonce);
  }
  assert(struct_v2_encode_frame(&p, &keys, 1, 0, 0x40, plain, 1, frame, sizeof(frame), &written));
  uint8_t control; assert(struct_v2_control(16, 0, 0, &control)); assert(struct_v2_control(0, 2, 0, &control));
}
static void provision(struct_v2_client *c, uint64_t initial) {
  struct_v2_counter_port port = {&state, read_state, write_state};
  assert(!struct_v2_counter_provision(&port, c->wire_id, c->key_fingerprint, initial));
}
static void persistence(void) {
  struct_v2_client a, b; struct_v2_port p = callbacks(); uint8_t root[32] = {0}, payload[1] = {7};
  struct_delivery once = struct_delivery_default(0); struct_v2_counter_port storage = {&state, read_state, write_state};
  memset(&state, 0, sizeof(state)); assert(struct_v2_init(&a, &p, 1, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&a, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); assert(state.sends == 0);
  assert(struct_v2_init(&a, &p, 1, root, 1024, 1200) == STRUCT_IDLE); provision(&a, 0);
  assert(struct_v2_counter_provision(&storage, 1, a.key_fingerprint, 0)); // Cannot reset surviving state.
  for (int i = 0; i < 20; ++i) { assert(struct_v2_send(&a, 0, payload, 1, 0, once) == STRUCT_SENT); assert(a.sequence == (uint32_t)i); }
  assert(state.writes == 2); // One initialization + one range, not 20 flash writes.
  assert(struct_v2_init(&b, &p, 1, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_SENT); assert(b.sequence == 1024); // Simulated reboot burns range.
  state.fail_after_write = 1; b.next_sequence = b.reserved_end;
  int before = state.sends; assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); assert(state.sends == before);
  state.fail_after_write = 0;
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); // Fault is latched in RAM.
  assert(struct_v2_init(&b, &p, 1, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_SENT); assert(b.sequence == 3072); // Ambiguous committed write also burns range.
  state.durable[48] ^= 1; assert(struct_v2_init(&b, &p, 1, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); state.durable[48] ^= 1;
  root[0] = 1; assert(struct_v2_init(&b, &p, 1, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); // Changed root cannot reset old namespace.
  assert(struct_v2_init(&b, &p, 2, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); // New wire ID requires separate fresh provisioning.
  memset(&state, 0, sizeof(state)); provision(&b, UINT64_C(4294967295));
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); // Prior fault latch prevents accidental resume.
  assert(struct_v2_init(&b, &p, 2, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_SENT); assert(b.sequence == UINT32_MAX);
  before = state.sends; assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_EXHAUSTED); assert(state.sends == before);
  memset(&state, 0, sizeof(state)); assert(struct_v2_init(&b, &p, 2, root, 1024, 1200) == STRUCT_IDLE);
  assert(struct_v2_send(&b, 0, payload, 1, 0, once) == STRUCT_V2_COUNTER_ERROR); // Factory erase does not reset zero.
  struct_v2_clear(&a); struct_v2_clear(&b);
  for (size_t i = 0; i < sizeof(a); ++i) assert(!((const uint8_t *)&a)[i]);
}
static void delivery(void) {
  struct_v2_client c; struct_v2_port p = callbacks(); uint8_t root[32] = {9}, payload[9] = {0}, original[1400];
  struct_delivery confirmed = struct_delivery_default(1), once = struct_delivery_default(0);
  memset(&state, 0, sizeof(state)); assert(struct_v2_init(&c, &p, 10, root, 4, 1200) == STRUCT_IDLE); provision(&c, 0);
  assert(struct_v2_send(&c, 0, payload, 9, UINT32_MAX - 500, confirmed) == STRUCT_PENDING);
  assert(c.frame_len == 34 && c.frame[0] == 0x82); memcpy(original, c.frame, c.frame_len);
  assert(struct_v2_send(&c, 1, payload, 9, 0, once) == STRUCT_BUSY);
  assert(struct_v2_poll_delay(&c, UINT32_MAX - 400, 10) == 10);
  assert(!struct_v2_encode_receipt(&p, &c.keys, c.sequence, state.incoming)); state.incoming[20] ^= 1; state.incoming_n = 21;
  assert(struct_v2_poll(&c, 100) == STRUCT_PENDING); // Forged tag ignored.
  assert(struct_v2_poll(&c, 2500) == STRUCT_PENDING); assert(state.sends == 2); assert(!memcmp(original, state.sent, c.frame_len));
  assert(!struct_v2_encode_receipt(&p, &c.keys, c.sequence, state.incoming)); state.incoming_n = 21;
  assert(struct_v2_poll(&c, 2600) == STRUCT_COMMITTED); assert(state.writes == 2);
  assert(struct_v2_send(&c, 0, payload, 9, 0, confirmed) == STRUCT_PENDING); assert(c.sequence == 1);
  assert(struct_v2_poll(&c, 7500) == STRUCT_UNKNOWN); assert(state.sends == 3); // No I/O after deadline.
  state.crypto_fail = 1; assert(struct_v2_send(&c, 0, payload, 9, 0, once) == STRUCT_CRYPTO_ERROR); assert(c.sequence == 2);
  state.crypto_fail = 0; assert(struct_v2_send(&c, 0, payload, 9, 0, once) == STRUCT_SENT); assert(c.sequence == 3); // Failed crypto burns sequence.
  state.send_fail = 1; assert(struct_v2_send(&c, 0, payload, 9, 0, once) == STRUCT_UNKNOWN); assert(c.sequence == 4);
  state.send_fail = 0; assert(struct_v2_send(&c, 0, payload, 9, 0, confirmed) == STRUCT_PENDING);
  struct_v2_cancel(&c); assert(c.state == STRUCT_UNKNOWN);
  assert(struct_v2_send(&c, 16, payload, 9, 0, once) == STRUCT_INVALID);
  assert(struct_v2_send(&c, 0, payload, 0, 0, once) == STRUCT_INVALID);
  assert(struct_v2_send(&c, 0, payload, 1200, 0, once) == STRUCT_INVALID);
}
static void batching(void) {
  struct_v2_client c; struct_v2_port p = callbacks(); uint8_t root[32] = {2}, records[260*9], plain[1400], nonce[12];
  size_t encoded; struct_delivery d = struct_delivery_default(0); memset(records, 7, sizeof(records)); memset(&state, 0, sizeof(state));
  assert(struct_v2_init(&c, &p, 99, root, 1024, 1200) == STRUCT_IDLE); provision(&c, 0);
  assert(struct_v2_batch_capacity(&c, 9) == 130); assert(struct_v2_batch_capacity(&c, 1) == 255);
  assert(struct_v2_send_batch(&c, 2, records, 9, 260, &encoded, 0, d) == STRUCT_SENT); assert(encoded == 130 && c.sequence == 0);
  assert(c.frame_len == 1196 && c.frame[0] == 0x89);
  struct_v2_nonce(c.keys.uplink_prefix, 0, nonce);
  assert(!struct_v2_mbedtls_open(NULL, c.keys.uplink_key, nonce, c.frame, 9, c.frame + 9, c.frame_len - 25, c.frame + c.frame_len - 16, plain));
  assert(plain[0] == 130 && !memcmp(plain + 1, records, 130*9));
  assert(struct_v2_send_batch(&c, 2, records + encoded*9, 9, 130, &encoded, 0, d) == STRUCT_SENT); assert(encoded == 130 && c.sequence == 1);
  assert(struct_v2_send_batch(&c, 2, records, 0, 1, &encoded, 0, d) == STRUCT_INVALID);
  assert(struct_v2_send_batch(&c, 2, records, 2000, 1, &encoded, 0, d) == STRUCT_INVALID);
}
int main(void) {
#if defined(MBEDTLS_SELF_TEST)
  assert(!mbedtls_chacha20_self_test(0)); assert(!mbedtls_poly1305_self_test(0)); assert(!mbedtls_chachapoly_self_test(0));
#endif
  vectors(); persistence(); delivery(); batching();
  puts("Secure V2 C: golden crypto, tampering, durable reservation, reboot/erase/rotation, retries and batches passed"); return 0;
}
