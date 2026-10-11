/* Host-side ESP32 application simulation. Real generated serializer, C SDK and
 * mbedTLS; simulated NVS/transport callbacks. The Node runner carries the exact
 * captured bytes over loopback UDP and supplies the real gateway receipt back.
 * This does not emulate an ESP32 CPU, Wi-Fi radio, TLS bootstrap or flash. */
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "struct_secure_v2.h"
#include "struct_v2_counter.h"
#include "struct_v2_mbedtls.h"
#include "struct_packet.h"

typedef struct {
  uint8_t nvs[STRUCT_V2_COUNTER_RECORD_SIZE], frame[STRUCT_V2_MAX_FRAME];
  uint8_t receipt[STRUCT_V2_RECEIPT_SIZE];
  size_t nvs_len, frame_len, receipt_len;
  unsigned sends;
} simulation;
static int nvs_read(void *u, uint8_t *out, size_t n) {
  simulation *s=u; assert(n>=s->nvs_len);
  memcpy(out,s->nvs,s->nvs_len); return (int)s->nvs_len;
}
static int nvs_write(void *u, const uint8_t *input, size_t n) {
  simulation *s=u; assert(n==sizeof(s->nvs));
  memcpy(s->nvs,input,n); s->nvs_len=n; return 0;
}
static int reserve(void *u, uint32_t id, const uint8_t fp[32], uint32_t block,
    uint64_t *first, uint64_t *end) {
  struct_v2_counter_port p={u,nvs_read,nvs_write};
  return struct_v2_counter_reserve(&p,id,fp,block,first,end);
}
static int capture(void *u, const uint8_t *frame, size_t n) {
  simulation *s=u; assert(n<=sizeof(s->frame));
  memcpy(s->frame,frame,n); s->frame_len=n; s->sends++; return 0;
}
static int receive(void *u, uint8_t *out, size_t n) {
  simulation *s=u; size_t length=s->receipt_len; assert(n>=length);
  memcpy(out,s->receipt,length); s->receipt_len=0; return (int)length;
}
static void print_hex(const char *label, const uint8_t *bytes, size_t n) {
  printf("%s=",label); for(size_t i=0;i<n;i++)printf("%02x",bytes[i]); putchar('\n');
}
static void read_receipt(const char *hex, simulation *s) {
  assert(strlen(hex)==2*STRUCT_V2_RECEIPT_SIZE);
  for(size_t i=0;i<STRUCT_V2_RECEIPT_SIZE;i++) {
    unsigned value; assert(sscanf(hex+2*i,"%2x",&value)==1); s->receipt[i]=(uint8_t)value;
  }
  s->receipt_len=STRUCT_V2_RECEIPT_SIZE;
}
int main(int argc, char **argv) {
  assert(argc==3 || argc==4);
  simulation s={0}; struct_v2_client client;
  struct_v2_port p={&s,struct_v2_mbedtls_hkdf,struct_v2_mbedtls_sha256,
    struct_v2_mbedtls_seal,struct_v2_mbedtls_open,capture,receive,reserve};
  uint32_t id=(uint32_t)strtoul(argv[1],NULL,10);
  assert(struct_v2_init_hex(&client,&p,id,argv[2],STRUCT_V2_DEFAULT_RESERVATION,
    STRUCT_V2_DEFAULT_MAX_FRAME)==STRUCT_IDLE);
  struct_v2_counter_port storage={&s,nvs_read,nvs_write};
  /* Fresh, publicly documented TEST credential. Never production provisioning. */
  assert(!struct_v2_counter_provision(&storage,id,client.key_fingerprint,0));
  StructPacket sensor={0}; sensor.f_temp=23.5; sensor.f_humidity=61.25; sensor.f_is_active=1;
  uint8_t payload[STRUCT_PACKET_SIZE];
  size_t length=struct_pack_packet(payload,sizeof(payload),&sensor);
  assert(length==STRUCT_PACKET_SIZE); print_hex("payload",payload,length);
  for(int confirmed=0;confirmed<=1;confirmed++) {
    struct_result result=struct_v2_send(&client,STRUCT_SCHEMA_SLOT,payload,length,
      0,struct_delivery_default(confirmed));
    assert(result==(confirmed?STRUCT_PENDING:STRUCT_SENT));
    printf("mode=%s\nsequence=%u\n",confirmed?"confirmed":"unconfirmed",client.sequence);
    print_hex("frame",s.frame,s.frame_len);
    if(confirmed && argc==4) {
      read_receipt(argv[3],&s); result=struct_v2_poll(&client,1);
      assert(result==STRUCT_COMMITTED); puts("receipt_verified=1");
    }
  }
  assert(s.sends==2); struct_v2_clear(&client); return 0;
}
