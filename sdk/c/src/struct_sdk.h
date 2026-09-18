#ifndef STRUCT_SDK_H
#define STRUCT_SDK_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define STRUCT_MAX_FRAME 1400u
#define STRUCT_MAX_PAYLOAD (STRUCT_MAX_FRAME - 66u)
#define STRUCT_RECEIPT_SIZE 69u

typedef enum {
  STRUCT_IDLE = 0, STRUCT_PENDING = 1, STRUCT_SENT = 2,
  STRUCT_COMMITTED = 3, STRUCT_UNKNOWN = 4,
  STRUCT_INVALID = -1, STRUCT_IO_ERROR = -2, STRUCT_CRYPTO_ERROR = -3,
  STRUCT_BUSY = -4
} struct_result;

/* Callbacks return 0 on success except receive: bytes received, 0 if none,
 * negative on failure. send/receive MUST be nonblocking datagram operations.
 * random MUST use a cryptographically secure RNG; never rand().
 * HMAC uses the literal ASCII API secret, NOT its hex-decoded value. */
typedef struct {
  void *user;
  int (*random)(void *, uint8_t *, size_t);
  int (*hmac)(void *, const uint8_t *, size_t, const uint8_t *, size_t, uint8_t[32]);
  int (*send)(void *, const uint8_t *, size_t);
  int (*receive)(void *, uint8_t *, size_t);
  int (*encrypt)(void *, const uint8_t[32], const uint8_t[12],
                 const uint8_t *, size_t, uint8_t *, uint8_t[16]);
} struct_port;

typedef struct {
  int confirmed;              /* 0: v2 send once; 1: v3 signed storage receipt */
  uint8_t max_retries;        /* 0..3; each retry reuses the identical frame */
  uint32_t retry_ms;          /* >= 1000; default 3000, doubles after loss */
  uint32_t awake_budget_ms;   /* 1..30000; includes all receipt waits */
} struct_delivery;

typedef struct {
  struct_port port;
  char key_id[16];
  uint8_t secret[64];
  uint8_t encryption_key[32];
  int encrypted;
  uint8_t frame[STRUCT_MAX_FRAME];
  size_t frame_len;
  struct_delivery delivery;
  uint32_t started_ms, last_sent_ms, next_wait_ms;
  uint8_t retries, jitter;
  struct_result state;
} struct_client;

/* Use a fresh synced Unix clock for each NEW frame. Poll uses monotonic millis,
 * including across uint32 wrap. Callbacks and client are single-threaded.
 * The caller owns pacing between new samples and any persistent offline queue. */
struct_delivery struct_delivery_default(int confirmed);
struct_result struct_init(struct_client *, const struct_port *, const char *key_id, const char *api_secret);
struct_result struct_set_encryption(struct_client *, const uint8_t *key_or_null);
struct_result struct_send(struct_client *, uint8_t schema_version, const uint8_t *payload,
                          size_t payload_len, uint32_t unix_sec, uint32_t now_ms,
                          struct_delivery delivery);
struct_result struct_poll(struct_client *, uint32_t now_ms);
void struct_cancel(struct_client *); /* Ends waiting; delivery remains unknown. */
void struct_clear(struct_client *);  /* Wipes credentials and buffered telemetry. */
struct_result struct_send_event(struct_client *, const uint8_t event_id[16], uint8_t schema_version,
  const uint8_t *, size_t, uint32_t unix_sec, uint32_t now_ms, struct_delivery);

/* Explicit little-endian writers for generated schemas; no packed-struct ABI. */
void struct_put_u32(uint8_t *, uint32_t);
void struct_put_f32(uint8_t *, float);

#ifdef __cplusplus
}
#endif
#endif
