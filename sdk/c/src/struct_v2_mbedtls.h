#ifndef STRUCT_V2_MBEDTLS_H
#define STRUCT_V2_MBEDTLS_H
#include "struct_secure_v2.h"
#if defined(ARDUINO_ARCH_ESP32)
#include "struct_v2_mbedtls_config.h"
#endif
#include <mbedtls/md.h>
#include <mbedtls/hkdf.h>
#include <mbedtls/chachapoly.h>
/* Use the platform SHA256/MD and ChaChaPoly/HKDF whenever available. Arduino
 * cores missing the latter compile a pinned, unmodified upstream subset.
 * No fallback cipher, short tag, or unauthenticated decrypt is provided. */
#if defined(MBEDTLS_HKDF_C) && defined(MBEDTLS_CHACHAPOLY_C)
static inline int struct_v2_mbedtls_hkdf(void *u, const uint8_t *salt, size_t salt_n,
    const uint8_t *root, size_t root_n, const uint8_t *info, size_t info_n, uint8_t *out, size_t n) {
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256); (void)u;
  return md ? mbedtls_hkdf(md, salt, salt_n, root, root_n, info, info_n, out, n) : -1;
}
static inline int struct_v2_mbedtls_sha256(void *u, const uint8_t *input, size_t n, uint8_t out[32]) {
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256); (void)u;
  return md ? mbedtls_md(md, input, n, out) : -1;
}
static inline int struct_v2_mbedtls_seal(void *u, const uint8_t key[32], const uint8_t nonce[12],
    const uint8_t *aad, size_t aad_n, const uint8_t *plain, size_t n, uint8_t *cipher, uint8_t tag[16]) {
  mbedtls_chachapoly_context ctx; int result; (void)u;
  mbedtls_chachapoly_init(&ctx); result = mbedtls_chachapoly_setkey(&ctx, key);
  if (!result) result = mbedtls_chachapoly_encrypt_and_tag(&ctx, n, nonce, aad, aad_n, plain, cipher, tag);
  mbedtls_chachapoly_free(&ctx); return result;
}
static inline int struct_v2_mbedtls_open(void *u, const uint8_t key[32], const uint8_t nonce[12],
    const uint8_t *aad, size_t aad_n, const uint8_t *cipher, size_t n, const uint8_t tag[16], uint8_t *plain) {
  mbedtls_chachapoly_context ctx; int result; (void)u;
  mbedtls_chachapoly_init(&ctx); result = mbedtls_chachapoly_setkey(&ctx, key);
  if (!result) result = mbedtls_chachapoly_auth_decrypt(&ctx, n, nonce, aad, aad_n, tag, cipher, plain);
  mbedtls_chachapoly_free(&ctx); return result;
}
#else
#error Struct Secure V2 requires platform HKDF-SHA256 and ChaCha20-Poly1305
#endif
#endif
