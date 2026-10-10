# Pinned crypto compatibility subset

Legacy Arduino 2.x compatibility only. Upstream 2.28 is end-of-life. New Secure
V2 projects use Arduino 3.x and the maintained `../mbedtls3/` compatibility pin.

These `.inc` files are byte-for-byte upstream Mbed TLS 2.28.10 source files,
renamed to avoid unconditional compilation by Arduino library discovery.
`provenance.json` records their upstream paths and SHA-256 hashes. `common.h`
is also unmodified. The upstream dual license is preserved in `LICENSE.txt`;
this distribution uses its Apache-2.0 option.

The four small wrapper translation units compile these files **only** when an
Arduino ESP32 platform omits the algorithm from its precompiled mbedTLS archive.
They reuse platform headers, MD/SHA256, constant-time comparison, and secure
zeroization. On the tested Arduino ESP32 2.0.17 SDK, all four algorithms are
omitted, whereas MD/SHA256 are present. Standalone host and ESP-IDF builds use
their maintained mbedTLS libraries and require these algorithms to be enabled.
The wrapper contains integration configuration; cryptographic primitives have
not been implemented or modified by Struct.

The 2.28 compatibility branch must be reviewed/updated alongside Arduino core
upgrades. It is a dependency pin, not a claim of permanent security maintenance.
Run independent Node/C golden-vector tests, upstream known-answer tests, and the
generated ESP32-C3 build whenever changing this dependency or platform. Future
platforms with an incompatible mbedTLS ABI must use their native enabled crypto
or a separately qualified integration; do not force these sources to compile.
