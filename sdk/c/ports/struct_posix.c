#define _POSIX_C_SOURCE 200112L
#include "struct_posix.h"
#include "struct_mbedtls.h"
#include <sys/socket.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
static int random_bytes(void *u, uint8_t *out, size_t n) {
  return mbedtls_ctr_drbg_random(&((struct_posix *)u)->rng, out, n);
}
static int send_bytes(void *u, const uint8_t *bytes, size_t n) {
  return send(((struct_posix *)u)->fd, bytes, n, 0) == (ssize_t)n ? 0 : -1;
}
static int receive_bytes(void *u, uint8_t *out, size_t cap) {
  ssize_t n = recv(((struct_posix *)u)->fd, out, cap, 0);
  return n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) ? 0 : (int)n;
}
void struct_posix_close(struct_posix *p) {
  if (p->fd >= 0) close(p->fd);
  p->fd = -1; mbedtls_ctr_drbg_free(&p->rng); mbedtls_entropy_free(&p->entropy);
}
int struct_posix_open(struct_posix *p, struct_port *callbacks, const char *host, const char *port) {
  struct addrinfo hints, *addresses = NULL, *a;
  if (!p || !callbacks || !host || !port) return -1;
  memset(p, 0, sizeof(*p)); p->fd = -1;
  memset(callbacks, 0, sizeof(*callbacks)); memset(&hints, 0, sizeof(hints));
  mbedtls_entropy_init(&p->entropy); mbedtls_ctr_drbg_init(&p->rng);
  if (mbedtls_ctr_drbg_seed(&p->rng, mbedtls_entropy_func, &p->entropy, (const unsigned char *)"struct-sdk", 10)) goto fail;
  hints.ai_family = AF_INET; hints.ai_socktype = SOCK_DGRAM;
  if (getaddrinfo(host, port, &hints, &addresses)) goto fail;
  for (a = addresses; a; a = a->ai_next) {
    p->fd = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
    if (p->fd < 0) continue;
    if (!connect(p->fd, a->ai_addr, a->ai_addrlen) && fcntl(p->fd, F_SETFL, O_NONBLOCK) >= 0) break;
    close(p->fd); p->fd = -1;
  }
  freeaddrinfo(addresses);
  if (p->fd < 0) goto fail;
  callbacks->user = p; callbacks->random = random_bytes; callbacks->hmac = struct_mbedtls_hmac;
  callbacks->send = send_bytes; callbacks->receive = receive_bytes;
#if defined(MBEDTLS_CHACHAPOLY_C)
  callbacks->encrypt = struct_mbedtls_encrypt;
#endif
  return 0;
fail:
  struct_posix_close(p); return -1;
}
