# Mbed TLS 3.6.7 compatibility subset

The ChaCha20, Poly1305 and ChaCha20-Poly1305 `.inc` files and internal headers
are byte-for-byte upstream Mbed TLS 3.6.7. `provenance.json` records paths and
SHA-256 hashes. This distribution selects the preserved Apache-2.0 license.

Arduino 3.3.12 / ESP-IDF 5.5.5 supplies HKDF, SHA-256, TLS, constant-time
comparison and secure zeroization, but omits the ChaCha algorithms from its
precompiled library. Struct's wrapper translation units compile this subset only
when those algorithms are disabled, using the platform's 3.6 headers/ABI. The
wrappers reject other unqualified ABIs. Struct does not modify the primitives.

The 3.6.7 sources include upstream's ChaCha block-counter overflow check. Struct
also bounds each operation to a maximum 1400-byte datagram. Host conformance uses
the actual upstream library and runs its known-answer tests and every frozen
Node vector. Generated ESP32-C3 and ESP32 projects are cross-compiled separately.
Physical testing and external review remain release requirements.

Review and update this pin with platform upgrades. The old sibling `mbedtls/`
directory exists only for Arduino 2.x compatibility; new starters use Arduino 3.x.
