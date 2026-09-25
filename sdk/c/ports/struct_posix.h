#ifndef STRUCT_POSIX_H
#define STRUCT_POSIX_H
#include "struct_sdk.h"
#include <mbedtls/entropy.h>
#include <mbedtls/ctr_drbg.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
  int fd;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context rng;
} struct_posix;
/* DNS/socket/RNG setup happens here, outside send budgets. Close after use.
 * The caller owns WiFi/modem power management. Linux/POSIX + mbedTLS. */
int struct_posix_open(struct_posix *, struct_port *, const char *host, const char *port);
void struct_posix_close(struct_posix *);
#ifdef __cplusplus
}
#endif
#endif
