#ifndef STRUCT_V2_MBEDTLS_CONFIG_H
#define STRUCT_V2_MBEDTLS_CONFIG_H
/* Reuse platform SHA256/MD and enabled algorithms. Compile the pinned upstream
 * compatibility subset only for algorithms absent from the precompiled archive.
 * All other mbedTLS platform configuration remains authoritative. */
#include <mbedtls/version.h>
#if MBEDTLS_VERSION_MAJOR >= 3
#include <mbedtls/build_info.h>
#elif defined(MBEDTLS_CONFIG_FILE)
#include MBEDTLS_CONFIG_FILE
#else
#include <mbedtls/config.h>
#endif
#ifndef MBEDTLS_CHACHA20_C
#define MBEDTLS_CHACHA20_C
#endif
#ifndef MBEDTLS_POLY1305_C
#define MBEDTLS_POLY1305_C
#endif
#ifndef MBEDTLS_CHACHAPOLY_C
#define MBEDTLS_CHACHAPOLY_C
#endif
#ifndef MBEDTLS_HKDF_C
#define MBEDTLS_HKDF_C
#endif
#endif
