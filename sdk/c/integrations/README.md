# Firmware integration candidates

These are maintained source integration points, not certified board products yet.
Use sdk/compatibility.json to distinguish compiled/tested evidence from targets.
The portable C API owns packet signing/encryption, frames, receipts and retries.
Applications own network attach, trustworthy time, secure credential storage and
sleep scheduling. Command TCP I/O and a board's durable command-journal backend
remain platform integration work; telemetry UDP ports do not receive STRC commands.

## ESP-IDF

Add sdk/c to `EXTRA_COMPONENT_DIRS`; the root CMake registers the component and
lwIP/mbedTLS dependencies. See examples/esp-idf. Use `idf.py menuconfig` to configure
network and Struct settings, then `idf.py build`. Never commit generated sdkconfig
with real credentials. Enable mbedTLS ChaCha20-Poly1305 for encrypted devices;
failure to enable crypto fails configuration/send, never silently sends plaintext.
ESP hardware entropy requires a valid entropy source (active WiFi/radio in this
example). Do not call during early boot before the platform entropy requirements.

## Arduino ESP32

Install the packaged Struct Arduino ZIP, or use the PlatformIO configuration in
examples/Telemetry. Network and clock are configured in the sketch. Use the NVS
queue only after sizing/wear testing the partition. No other Arduino architecture
is claimed. Arduino SDK/toolchain versions must be recorded in release evidence.

## FreeRTOS / STM32Cube

Compile src/struct_sdk.c, struct_queue.c, struct_commands.c and
ports/struct_socket.c with `STRUCT_PORT_LWIP=1`. Link the board's lwIP and mbedTLS
targets; enable sockets and nonblocking I/O. STM32 CMake wiring is supplied in
integrations/stm32. CubeMX still configures clocks, Ethernet/WiFi, DMA/cache,
TRNG, FreeRTOS and network initialization; those cannot be guessed without a board.

Zero-initialize a `struct_socket`, supply its `entropy` callback using the board's
validated TRNG (including its error handling), then call `struct_socket_open` and
`struct_init`. entropy_user remains caller-owned. Never use rand(), tick counters,
MAC addresses or unseeded PRNGs for entropy. `struct_freertos_poll` provides an
owner-task integration; producers send measurements via a FreeRTOS queue to that
task. Do not share a client across tasks or call from interrupts. FreeRTOS+TCP is
not lwIP; it needs its own port and is not claimed by this adapter.

## Zephyr

Add sdk/c to `ZEPHYR_EXTRA_MODULES`. Its zephyr/module.yml loads the integration.
Enable networking, UDP/IPv4, BSD sockets, a real CSPRNG and PSA crypto supporting
HMAC-SHA256/ChaCha20-Poly1305. Configure the maintained PSA provider for your board.
Use `struct_socket_open`, then the same C send/poll loop from one thread. Supply
fresh Unix time and `k_uptime_get_32()` for monotonic milliseconds; `k_sleep` or
socket-readiness notification can wait between polls. No test RNG in production.
Module inclusion does not imply that every Zephyr board has the required network,
entropy or PSA driver; board build and HIL evidence are required before support.

## Cellular

There is currently no selected customer modem. Socket-offloaded platforms can use
these adapters if their nonblocking UDP contract is preserved. Otherwise supply a
struct_port adapter; do not block a send callback waiting for AT-command exchanges.
Capture modem model/firmware, carrier, RAT, PSM/eDRX, reconnect behavior and measured
radio-tail energy before adding a maintained modem driver. No universal modem or
battery-life claim is made.
