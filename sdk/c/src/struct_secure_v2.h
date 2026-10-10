#ifndef STRUCT_SECURE_V2_H
#define STRUCT_SECURE_V2_H
#include "struct_sdk.h"
#ifdef __cplusplus
extern "C" {
#endif

#define STRUCT_SECURE_V2_SDK_VERSION "0.3.0"
#define STRUCT_SECURE_V2_PROTOCOL_VERSION 2u
#define STRUCT_DEFAULT_INGEST_HOST "ingest.usestruct.com"
#define STRUCT_DEFAULT_UDP_PORT 8081u
#define STRUCT_V2_DEFAULT_MAX_FRAME 1200u
#define STRUCT_V2_MAX_FRAME 1400u
#define STRUCT_V2_HEADER_SIZE 9u
#define STRUCT_V2_TAG_SIZE 16u
#define STRUCT_V2_OVERHEAD 25u
#define STRUCT_V2_RECEIPT_SIZE 21u
#define STRUCT_V2_DEFAULT_RESERVATION 1024u
#define STRUCT_V2_GENERATION 0x80u
#define STRUCT_V2_GENERATION_MASK 0xc0u
#define STRUCT_V2_SLOT_MASK 0x3cu
#define STRUCT_V2_RECEIPT_REQUESTED 0x02u
#define STRUCT_V2_BATCH 0x01u
#define STRUCT_V2_RECEIPT_CONTROL 0xc0u
#define STRUCT_V2_COUNTER_LIMIT UINT64_C(4294967296)
#define STRUCT_V2_COUNTER_ERROR ((struct_result)-5)
#define STRUCT_V2_EXHAUSTED ((struct_result)-6)

/* Single owner task; never reenter from callbacks/ISRs. All buffers are consumed
 * before a callback returns. send/receive are nonblocking datagram operations.
 * reserve MUST atomically commit an exclusive high bound before returning a
 * range. Missing/corrupt state fails closed. The application must prevent rollback.
 * It must bind its record
 * to wire_id AND SHA256(uplink_key), and never initialize missing state itself.
 * Trusted manufacturing/one-time authenticated provisioning is separate.
 * Return zero on success except receive (bytes/zero/negative) and reserve:
 * zero success, -2 exhaustion, any other nonzero durable-storage failure. */
typedef struct {
  void *user;
  int (*hkdf)(void *, const uint8_t *, size_t, const uint8_t *, size_t,
              const uint8_t *, size_t, uint8_t *, size_t);
  int (*sha256)(void *, const uint8_t *, size_t, uint8_t[32]);
  int (*seal)(void *, const uint8_t[32], const uint8_t[12], const uint8_t *, size_t,
              const uint8_t *, size_t, uint8_t *, uint8_t[16]);
  int (*open)(void *, const uint8_t[32], const uint8_t[12], const uint8_t *, size_t,
              const uint8_t *, size_t, const uint8_t[16], uint8_t *);
  int (*send)(void *, const uint8_t *, size_t);
  int (*receive)(void *, uint8_t *, size_t);
  int (*reserve)(void *, uint32_t, const uint8_t[32], uint32_t, uint64_t *, uint64_t *);
} struct_v2_port;

typedef struct {
  uint8_t uplink_key[32], downlink_key[32];
  uint8_t uplink_prefix[8], downlink_prefix[8];
} struct_v2_keys;

typedef struct {
  struct_v2_port port;
  struct_v2_keys keys;
  uint8_t key_fingerprint[32];
  uint32_t wire_id, reservation_size, sequence;
  uint64_t next_sequence, reserved_end;
  size_t max_frame, frame_len;
  uint8_t frame[STRUCT_V2_MAX_FRAME];
  struct_delivery delivery;
  uint32_t started_ms, last_sent_ms, next_wait_ms;
  uint8_t retries, counter_fault;
  struct_result state;
} struct_v2_client;

/* Does not retain the root or provision/reset persistent counter state. */
struct_result struct_v2_init(struct_v2_client *, const struct_v2_port *, uint32_t,
                             const uint8_t[32], uint32_t, size_t);
struct_result struct_v2_init_hex(struct_v2_client *, const struct_v2_port *, uint32_t,
                                 const char *, uint32_t, size_t);
struct_result struct_v2_send(struct_v2_client *, uint8_t, const uint8_t *, size_t,
                             uint32_t now_ms, struct_delivery);
/* Sends the FIRST bounded chunk of count fixed-size records. encoded_count is
 * set only when a frame was produced; advance that many records after handling
 * delivery. One fresh sequence per chunk; retries preserve exact frame bytes.
 * An unknown result must never be interpreted as proof that records were lost. */
size_t struct_v2_batch_capacity(const struct_v2_client *, size_t record_size);
struct_result struct_v2_send_batch(struct_v2_client *, uint8_t, const uint8_t *,
                                   size_t record_size, size_t count, size_t *encoded_count,
                                   uint32_t now_ms, struct_delivery);
struct_result struct_v2_poll(struct_v2_client *, uint32_t now_ms);
uint32_t struct_v2_poll_delay(const struct_v2_client *, uint32_t now_ms, uint32_t cap_ms);
void struct_v2_cancel(struct_v2_client *);
void struct_v2_clear(struct_v2_client *);

/* Wire helpers/crypto primitives for interoperability tests and tooling. Device
 * applications use send, which allocates sequences safely. These low-level
 * helpers do NOT allocate/persist sequences and must not be used to resend
 * changed content under the same key/nonce. */
void struct_v2_put_u32(uint8_t *, uint32_t);
uint32_t struct_v2_get_u32(const uint8_t *);
int struct_v2_control(uint8_t slot, int confirmed, int batch, uint8_t *out);
void struct_v2_nonce(const uint8_t[8], uint32_t, uint8_t[12]);
int struct_v2_derive(const struct_v2_port *, uint32_t, const uint8_t[32], struct_v2_keys *);
int struct_v2_encode_frame(const struct_v2_port *, const struct_v2_keys *, uint32_t,
                           uint32_t, uint8_t, const uint8_t *, size_t,
                           uint8_t *, size_t, size_t *);
int struct_v2_encode_receipt(const struct_v2_port *, const struct_v2_keys *, uint32_t,
                             uint8_t[STRUCT_V2_RECEIPT_SIZE]);
int struct_v2_verify_receipt(const struct_v2_port *, const struct_v2_keys *, uint32_t,
                             const uint8_t *, size_t);
#ifdef __cplusplus
}
#endif
#endif
