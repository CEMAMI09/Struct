#ifndef STRUCT_SOCKET_H
#define STRUCT_SOCKET_H
#include "struct_sdk.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Zero initialize. One owner task, no ISR calls. Numeric IPv4 avoids DNS stalls.
 * Firmware must start its network and securely synchronize time before sends.
 * entropy is needed only for generic lwIP builds (e.g. STM32Cube). */
typedef struct { int fd; int opened; void *entropy_user; int (*entropy)(void *,uint8_t *,size_t); } struct_socket;
int struct_socket_open(struct_socket *,struct_port *,const char *ipv4,uint16_t port);
void struct_socket_close(struct_socket *);
#ifdef __cplusplus
}
#endif
#endif
