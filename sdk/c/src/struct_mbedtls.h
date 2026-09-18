#ifndef STRUCT_MBEDTLS_H
#define STRUCT_MBEDTLS_H
#include "struct_sdk.h"
#include <mbedtls/md.h>
#include <mbedtls/chachapoly.h>
/* Uses the platform's maintained crypto implementation. Never substitutes a
 * custom cipher if the board's mbedTLS lacks ChaCha20-Poly1305 support. */
static inline int struct_mbedtls_hmac(void *u, const uint8_t *key, size_t key_len,
    const uint8_t *data, size_t n, uint8_t out[32]) {
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  (void)u;
  return info ? mbedtls_md_hmac(info, key, key_len, data, n, out) : -1;
}
#if defined(MBEDTLS_CHACHAPOLY_C)
static inline int struct_mbedtls_encrypt(void *u, const uint8_t key[32], const uint8_t nonce[12],
    const uint8_t *plain, size_t n, uint8_t *cipher, uint8_t tag[16]) {
  mbedtls_chachapoly_context ctx; int rc; (void)u;
  mbedtls_chachapoly_init(&ctx);
  rc = mbedtls_chachapoly_setkey(&ctx, key);
  if (!rc) rc = mbedtls_chachapoly_encrypt_and_tag(&ctx, n, nonce, NULL, 0, plain, cipher, tag);
  mbedtls_chachapoly_free(&ctx); return rc;
}
#endif
#endif
