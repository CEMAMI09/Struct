#ifndef STRUCT_COMMANDS_H
#define STRUCT_COMMANDS_H
#include "struct_sdk.h"
#ifdef __cplusplus
extern "C" {
#endif
enum { STRUCT_COMMAND_RECEIVED=16, STRUCT_COMMAND_EXECUTED=17,
  STRUCT_COMMAND_REJECTED=18, STRUCT_COMMAND_EXPIRED=19, STRUCT_COMMAND_UNKNOWN=20 };
/* Durable journal: load returns 0=absent, positive=stored result, negative=I/O
 * failure. save must durably commit before returning 0; never evict unexpired
 * IDs. If full, reject without executing. Store 16-byte ID and 32-byte MAC so
 * changed content with the same ID fails closed. Call from one task at a time. */
typedef struct {
  void *user;
  int (*load)(void *, const uint8_t[16], const uint8_t[32]);
  int (*save)(void *, const uint8_t[16], const uint8_t[32], uint32_t, int);
  int (*execute)(void *, const uint8_t[16], const uint8_t *, size_t);
} struct_command_port;
/* Accepts STRC inner envelope (TCP length prefix already removed). Only verified
 * commands reach callbacks. Returns status 16..20 or a negative SDK error. */
int struct_command_handle(struct_client *, const uint8_t *, size_t, uint32_t,
                          const struct_command_port *);
/* Build authenticated v2 command status uplink for the verified command ID. */
int struct_command_ack(struct_client *, const uint8_t[16], int, uint8_t[67]);
#ifdef __cplusplus
}
#endif
#endif
