#if defined(ARDUINO_ARCH_ESP32)
#include <mbedtls/version.h>
#if MBEDTLS_VERSION_MAJOR >= 3
#include <mbedtls/build_info.h>
#else
/* Inspect the actual platform configuration, not upstream's default config. */
#if defined(MBEDTLS_CONFIG_FILE)
#include MBEDTLS_CONFIG_FILE
#else
#include <mbedtls/config.h>
#endif
#endif
#if !defined(MBEDTLS_CHACHA20_C)
#undef MBEDTLS_CONFIG_FILE
#define MBEDTLS_CONFIG_FILE "struct_v2_mbedtls_config.h"
#include "struct_v2_mbedtls_config.h"
#if MBEDTLS_VERSION_MAJOR == 3 && MBEDTLS_VERSION_MINOR == 6
#include "third_party/mbedtls3/chacha20.inc"
#elif MBEDTLS_VERSION_MAJOR == 2 && MBEDTLS_VERSION_MINOR == 28
#include "third_party/mbedtls/chacha20.inc"
#else
#error Struct Secure V2 needs a qualified native crypto provider for this mbedTLS ABI
#endif
#endif
#endif
