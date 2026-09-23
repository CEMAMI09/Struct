#include "struct_sdk.h"
#include <string.h>
#include <float.h>

typedef char struct_float_must_be_ieee754[(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24) ? 1 : -1];
static void wipe(void *p, size_t n) { volatile uint8_t *b = (volatile uint8_t *)p; while (n--) *b++ = 0; }
static int equal(const uint8_t *a, const uint8_t *b, size_t n) {
  uint8_t diff = 0; while (n--) diff |= *a++ ^ *b++; return diff == 0;
}
void struct_put_u32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
void struct_put_f32(uint8_t *p, float v) { uint32_t bits; memcpy(&bits, &v, 4); struct_put_u32(p, bits); }
struct_delivery struct_delivery_default(int confirmed) {
  struct_delivery d = {0, 1, 3000, 7500}; d.confirmed = !!confirmed; return d;
}
struct_result struct_init(struct_client *c, const struct_port *port, const char *key, const char *secret) {
  size_t i;
  if (!c || !port || !port->random || !port->hmac || !port->send || !key || !secret ||
      strlen(key) != 16 || strlen(secret) != 64) return STRUCT_INVALID;
  for (i = 0; i < 16; ++i) if ((unsigned char)key[i] < 33 || (unsigned char)key[i] > 126) return STRUCT_INVALID;
  for (i = 0; i < 64; ++i) if (!((secret[i] >= '0' && secret[i] <= '9') ||
      (secret[i] >= 'a' && secret[i] <= 'f') || (secret[i] >= 'A' && secret[i] <= 'F'))) return STRUCT_INVALID;
  memset(c, 0, sizeof(*c)); c->port = *port;
  memcpy(c->key_id, key, 16); memcpy(c->secret, secret, 64); return STRUCT_IDLE;
}
struct_result struct_set_encryption(struct_client *c, const uint8_t *key) {
  if (!c) return STRUCT_INVALID;
  if (c->state == STRUCT_PENDING) return STRUCT_BUSY;
  if (key && !c->port.encrypt) return STRUCT_INVALID;
  wipe(c->encryption_key, 32); c->encrypted = key != NULL;
  if (key) memcpy(c->encryption_key, key, 32);
  return STRUCT_IDLE;
}
struct_result struct_set_encryption_hex(struct_client *c,const char *hex){
 uint8_t key[32];size_t i;struct_result r;
 if(!hex)return struct_set_encryption(c,NULL);
 if(strlen(hex)!=64)return STRUCT_INVALID;
 for(i=0;i<64;i++){unsigned char b=(unsigned char)hex[i];int n=b>='0'&&b<='9'?b-'0':b>='a'&&b<='f'?b-'a'+10:b>='A'&&b<='F'?b-'A'+10:-1;
  if(n<0){wipe(key,sizeof(key));return STRUCT_INVALID;}if(!(i&1))key[i/2]=(uint8_t)(n<<4);else key[i/2]|=(uint8_t)n;}
 r=struct_set_encryption(c,key);wipe(key,sizeof(key));return r;
}
static struct_result prepare(struct_client *c, uint8_t version, const uint8_t *payload,
                          size_t n, uint32_t unix_sec, uint32_t now, struct_delivery d) {
  uint8_t plain[STRUCT_MAX_PAYLOAD + 4];
  size_t body_len;
  if (!c || !c->port.send || !c->port.hmac || !c->port.random) return STRUCT_INVALID;
  if (c->state == STRUCT_PENDING) return STRUCT_BUSY;
  if (!version || !payload || !n || n > STRUCT_MAX_PAYLOAD - (c->encrypted ? 32u : 0u) ||
      !unix_sec || (d.confirmed != 0 && d.confirmed != 1) ||
      (d.confirmed && (!c->port.receive || d.retry_ms < 1000 || d.retry_ms > 30000 ||
       d.awake_budget_ms < 1 || d.awake_budget_ms > 30000 || d.max_retries > 3))) return STRUCT_INVALID;
  c->frame[0] = d.confirmed ? 3 : 2; memcpy(c->frame + 1, c->key_id, 16);
  c->frame[17] = version; struct_put_u32(c->frame + 18, unix_sec);
  if (c->port.random(c->port.user, c->frame + 22, 12) ||
      c->port.random(c->port.user, &c->jitter, 1)) return c->state = STRUCT_CRYPTO_ERROR;
  if (c->encrypted) {
    if (!c->port.encrypt) return c->state = STRUCT_INVALID;
    if (c->port.random(c->port.user, c->frame + 34, 12)) return c->state = STRUCT_CRYPTO_ERROR;
    struct_put_u32(plain, unix_sec); memcpy(plain + 4, payload, n);
    if (c->port.encrypt(c->port.user, c->encryption_key, c->frame + 34,
        plain, n + 4, c->frame + 46, c->frame + 50 + n)) {
      wipe(plain, sizeof(plain)); return c->state = STRUCT_CRYPTO_ERROR;
    }
    wipe(plain, sizeof(plain)); body_len = 66 + n;
  } else { memcpy(c->frame + 34, payload, n); body_len = 34 + n; }
  if (c->port.hmac(c->port.user, c->secret, 64, c->frame, body_len, c->frame + body_len))
    return c->state = STRUCT_CRYPTO_ERROR;
  c->frame_len = body_len + 32; c->delivery = d; c->retries = 0;
  c->started_ms = c->last_sent_ms = now;
  c->next_wait_ms = d.retry_ms + (d.retry_ms / 4u) * c->jitter / 255u;
  return c->state = STRUCT_IDLE;
}
struct_result struct_send(struct_client *c, uint8_t version, const uint8_t *payload, size_t n, uint32_t unix_sec, uint32_t now, struct_delivery d) {
  struct_result r=prepare(c,version,payload,n,unix_sec,now,d);
  if(r!=STRUCT_IDLE) return r;
  if (c->port.send(c->port.user, c->frame, c->frame_len)) return c->state = STRUCT_IO_ERROR;
  return c->state = d.confirmed ? STRUCT_PENDING : STRUCT_SENT;
}
struct_result struct_send_event(struct_client *c,const uint8_t id[16],uint8_t version,const uint8_t *payload,size_t n,uint32_t unix_sec,uint32_t now,struct_delivery d) {
  uint8_t envelope[STRUCT_MAX_PAYLOAD]; struct_result r;
  if(!id||!payload||!n||n>1286||!d.confirmed) return STRUCT_INVALID;
  memcpy(envelope,id,16);memcpy(envelope+16,payload,n);
  r=prepare(c,version,envelope,n+16,unix_sec,now,d);wipe(envelope,sizeof(envelope));
  if(r!=STRUCT_IDLE)return r;
  c->frame[0]=4;
  if(c->port.hmac(c->port.user,c->secret,64,c->frame,c->frame_len-32,c->frame+c->frame_len-32))return c->state=STRUCT_CRYPTO_ERROR;
  if(c->port.send(c->port.user,c->frame,c->frame_len))return c->state=STRUCT_IO_ERROR;
  return c->state=STRUCT_PENDING;
}
struct_result struct_poll(struct_client *c, uint32_t now) {
  uint8_t receipt[STRUCT_RECEIPT_SIZE + 1], mac[32]; int n;
  if (!c) return STRUCT_INVALID;
  if (c->state != STRUCT_PENDING) return c->state;
  // A deadline stops all I/O, even if hostile traffic is continuously readable.
  if ((uint32_t)(now - c->started_ms) >= c->delivery.awake_budget_ms) return c->state = STRUCT_UNKNOWN;
  n = c->port.receive(c->port.user, receipt, sizeof(receipt));
  if (n < 0) return c->state = STRUCT_UNKNOWN;
  if (n == STRUCT_RECEIPT_SIZE && !memcmp(receipt, "STRA", 4) && receipt[36] <= 1 &&
      equal(receipt + 4, c->frame + c->frame_len - 32, 32)) {
    if (c->port.hmac(c->port.user, c->secret, 64, receipt, 37, mac)) return c->state = STRUCT_CRYPTO_ERROR;
    if (equal(mac, receipt + 37, 32)) return c->state = STRUCT_COMMITTED;
  }
  if ((uint32_t)(now - c->last_sent_ms) >= c->next_wait_ms && c->retries < c->delivery.max_retries) {
    if (c->port.send(c->port.user, c->frame, c->frame_len)) return c->state = STRUCT_UNKNOWN;
    ++c->retries; c->last_sent_ms = now; c->next_wait_ms *= 2u;
  }
  return c->state;
}
void struct_cancel(struct_client *c) { if (c && c->state == STRUCT_PENDING) c->state = STRUCT_UNKNOWN; }
void struct_clear(struct_client *c) { if (c) wipe(c, sizeof(*c)); }
uint32_t struct_poll_delay(const struct_client *c,uint32_t now,uint32_t cap) {
  uint32_t elapsed,remaining,wait;
  if(!c||c->state!=STRUCT_PENDING)return 0;
  elapsed=now-c->started_ms;
  if(elapsed>=c->delivery.awake_budget_ms)return 0;
  remaining=c->delivery.awake_budget_ms-elapsed;
  if(c->retries<c->delivery.max_retries){
    elapsed=now-c->last_sent_ms;
    wait=elapsed>=c->next_wait_ms?0:c->next_wait_ms-elapsed;
    if(wait<remaining)remaining=wait;
  }
  return remaining<cap?remaining:cap;
}
