#ifndef STRUCT_QUEUE_H
#define STRUCT_QUEUE_H
#include "struct_sdk.h"
#ifdef __cplusplus
extern "C" {
#endif
#define STRUCT_QUEUE_CAPACITY 4u
#define STRUCT_QUEUE_RECORD 1309u /* id16 + schema1 + expires4 + length2 + payload1286 */
#define STRUCT_QUEUE_BYTES (40u+STRUCT_QUEUE_CAPACITY*STRUCT_QUEUE_RECORD)
#define STRUCT_QUEUE_FULL -10
#define STRUCT_QUEUE_EXPIRED -11
typedef struct {
 void *user;
 /* read: snapshot size, zero for missing, negative for I/O failure.
  * write: zero ONLY after durable commit. Two independent flash slots required.
  * A torn slot must not damage the other. Provide wear-leveling below this API. */
 int (*read)(void *,unsigned,uint8_t *,size_t);
 int (*write)(void *,unsigned,const uint8_t *,size_t);
} struct_queue_port;
typedef struct { struct_queue_port port; uint8_t bytes[STRUCT_QUEUE_BYTES]; unsigned slot; int active; } struct_queue;
int struct_queue_open(struct_queue *,const struct_queue_port *,const char key_id[16]);
int struct_queue_enqueue(struct_queue *,struct_client *,uint8_t,const uint8_t *,size_t,uint32_t expires);
int struct_queue_step(struct_queue *,struct_client *,uint32_t unix_sec,uint32_t now_ms,struct_delivery);
int struct_queue_discard_head(struct_queue *); /* Explicit loss: never automatic on expiry/full. */
#ifdef __cplusplus
}
#endif
#endif
