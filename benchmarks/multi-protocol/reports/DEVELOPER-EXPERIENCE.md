# Developer experience and feature research

This compares concrete integration tasks and documented capabilities. It does not assign subjective ease/security scores. Versions/licenses are in `references/implementations.json`; sources and retrieval dates are in `references/sources.json`. Host examples below were actually executed. Hardware portability claims are deliberately separate.

## Integrations exercised

| Stack | Concrete local integration | Required artifacts/configuration | Receiver verification |
|---|---|---|---|
| Struct Secure V2 | `runners/struct.cjs`; existing C pilot | Generated schema, slot publication, local device/root enrollment, monotonic counter, actual gateway and disposable database | Stored parsed rows, authentic receipt, duplicate handling; C pilot rejects tamper |
| Protobuf + MQTT | `runners/mqtt.py` | Dynamic `.proto` equivalent, Paho client, NanoMQ broker, topic/QoS/version; TLS trust anchor for secure modes | Independent subscriber receives identical bytes and decodes values |
| JSON/CBOR + MQTT | Same real client/broker runner | JSON conventions or CBOR layout, broker settings; no code generator required | Subscriber payload/decoded values verified |
| JSON + HTTPS | `runners/https.py` | HTTP endpoint, path, headers/body, certificate trust; optional gzip | Endpoint validates JSON, echoes SHA256; original values decoded independently |
| CBOR/JSON/Protobuf + CoAP | `runners/coap.py` | Resource path, token/MID, content-format, codec; actual aiocoap wire messages and loopback resource wrapper | Resource decodes and returns2.04; wire bytes retained |
| CoAP + OSCORE | Same runner | Paired sender/recipient IDs, shared secret, algorithm, sequence/replay context | Real protect/unprotect, tamper and replay rejection |
| CoAP + DTLS | `runners/coap_dtls.py`, `implementations/coap/BenchmarkDtls.java` | Java compiler/runtime, Scandium client/server, PSK identity/key, cipher, resource | Decrypted payload verified at server and echoed to client |
| LwM2M1.1 | `runners/lwm2m.py`, `implementations/lwm2m/BenchmarkLwm2m.java` | Leshan jars, custom object model33000, Security/Server/Device objects, registration endpoint, optional PSK provisioning | Actual registration, decoded server Read, native Send acceptance, update |

Run a single integration with `scripts/run.py --phases mqtt normalize` or another phase name from the README. Tool downloads, package lock, source hashes and test credentials are reproducible locally; no service account is needed. These are working examples within benchmark runners, not production-ready sample applications or a universal setup-time study. Authoring/debugging time was not measured as user effort.

## SDKs and hardware

Struct's existing [SDK README](../../../sdk/README.md) documents C/C++, an ESP32 Arduino adapter, Node, legacy Python and legacy Rust. Secure V2 full transport support is currently C and Node. Six code-generation targets do not imply six full Secure V2 SDKs. The C pilot uses real generated ESP32 payload serializers and mbedTLS SDK code on a host WASI build; no physical ESP32, STM32 or Zephyr deployment was tested. Generic C callbacks permit ports, but writing/testing a transport/crypto adapter is work that must be counted. Raspberry Pi/Linux hosts are an appropriate target for host language SDKs; this run itself is Windows, so Pi qualification remains untested.

[Protobuf's official references](https://protobuf.dev/reference/) document C++, Java/Kotlin, Python, Go, C#, Objective-C, Ruby, PHP, Dart and Rust tooling. The measured implementation is Python's runtime with dynamic descriptors; it does not measure generated C firmware. [nanopb](https://github.com/nanopb/nanopb) is a relevant small C implementation to validate in a future MCU experiment. Installing Protobuf alone does not provide device provisioning, MQTT, encryption, cloud ingestion, firmware updates or database delivery guarantees.

The measured Paho client is Python. Embedded MQTT implementations and board support need their own pinned library and firmware run. The MQTT standard defines messaging and sessions; broker authentication policies, cloud routing, persistence and application deduplication are implementation/service decisions. NanoMQ here is a local broker; its measured TLS front end is explicitly a Python/OpenSSL terminator. No managed IoT-service feature set or ESP32 MQTT build is inferred from that stack.

aiocoap is Python, and Californium/Scandium and Leshan are Java host implementations. Their protocol measurements do not establish MCU flash/RAM consumption. [Zephyr's LwM2M documentation](https://docs.zephyrproject.org/latest/services/connectivity/networking/api/lwm2m.html) describes an embedded engine, resource models, bootstrap/registration and DTLS modes, with specification version selected by configuration. That is a documented porting route, not an executed Zephyr/STM32/ESP32 benchmark. The historically relevant C Wakaama repository is now [archived](https://github.com/eclipse-wakaama/wakaama), so this work did not treat it as the maintained implementation to choose by default. Arduino/STM32/Zephyr support should be listed per selected library and board rather than as an intrinsic guarantee of JSON, CBOR, MQTT or CoAP.

## Protocol features versus product features

| Capability | Format/protocol contribution | Actual benchmark or Struct implementation |
|---|---|---|
| Schema management | Protobuf has field definitions/evolution; JSON/CBOR permit application schemas; LwM2M has object/resource models | Struct has generated encoders and immutable V2 slots; cross-device schema rollout not benchmarked |
| Device authentication | TLS/DTLS/OSCORE can authenticate configured peers; MQTT alone does not provision identity | V2 root-derived device identity measured; local MQTT TLS only authenticates server; DTLS PSK identity measured |
| Replay/deduplication | OSCORE/DTLS/TLS provide their own context/record rules; application duplicate semantics remain separate | Actual OSCORE replay rejection and Struct gateway duplicate handling tested; DTLS negative test pending |
| Provisioning/key rotation | LwM2M defines security/bootstrap mechanisms; other stacks need provisioning integration | All benchmark credentials are local. Struct service enrollment exists; full rotation/bootstrap lifecycle not exercised |
| Firmware management | LwM2M models support management workflows; formats/MQTT/CoAP alone do not implement a fleet OTA product | No firmware update transfer, rollback or hardware validation measured |
| Cloud ingestion/routing/webhooks | Protocols transport messages; backend services provide storage/routing | Existing Struct gateway, transaction RPC, outbox/webhook code are repository product features; benchmark verifies local V2 storage only |
| Debugging | Library logs, decoded messages, raw bytes and protocol tools | Structured observations and local diagnostics supplied; production debugging UX not evaluated in this task |
| Self-hosting | Broker, CoAP endpoint or LwM2M server plus application/backend infrastructure | Portable local broker/Java services and temporary DB reproduced; production HA/operations not benchmarked |
| Licensing | Standard availability does not determine the software implementation's license | Dependencies recorded individually; Struct has no discovered top-level redistribution license; legal/commercial licensing not inferred |

Certificates, root secrets, persistent counter/replay state, expiry, revocation, resumption, fleet ownership and failure recovery must be evaluated independently of packet size. A small envelope is not proof of easier operations or enterprise readiness. Existing Struct webhook and downlink features are useful product distinctions but should not be advertised as features of its serialization format or as tested here.

## Next reproducible DX tasks

Build the same original schema on one actual ESP32 board using Struct C, nanopb+an embedded MQTT client, and an embedded CoAP/OSCORE or DTLS library. Record steps, failures, exact toolchain, flash/RAM and installation time under a defined method. Add a Zephyr LwM2M sample with the same resource values, then exercise provisioning, key rotation, reconnect and firmware management separately. Until then, future comparison UI should say “host integration verified” and “hardware port not tested” rather than assign invented ease-of-setup rankings.
