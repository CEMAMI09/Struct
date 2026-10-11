# Repository audit and measurement boundaries

Audited working tree based on commit `474e6b73f147c4dc4fef840ac5d0f66b46d86434`. Existing uncommitted ESP32 benchmark files are inputs and are preserved. Source hashes identify the actual audited implementation as well as the new harness.

| Area | Actual repository inputs | Benchmark reuse |
|---|---|---|
| Legacy frame/signing/receipts | `sdk/js/index.cjs`, `sdk/js/protocol.cjs`; `tcp-server/auth.js`, `crypto.js`, `parser.js` | Actual builder, HMAC verification, optional ChaCha20-Poly1305 decrypt, generated payload decoder and receipt verification |
| Secure V2 wire | `sdk/js/secure-v2.cjs` | Actual HKDF, control/slot, ID/counter, AEAD, receipt, batch builder/splitter |
| Secure V2 retry client | `sdk/js/secure-v2-client.cjs` | Actual client send/retry in controlled impairment experiments |
| C/ESP32 SDK | `sdk/c/src/struct_secure_v2.c`, ESP32 adapter and existing C benchmark | Existing WASI/mbedTLS benchmark, actual generated C header and SDK verification |
| Original schema compiler | `web/shared/schemaCodegen.ts` | Actual generated JavaScript encoder, not a manually recreated serializer |
| Packed schema compiler | `protocol/schema/bitpacked.cjs` | Actual compiler, encoder/decoder and existing generated C header path |
| Gateway | `tcp-server/ingest.js`, `secure-v2.js` | Actual V2 processing and replay/duplicate behavior |
| Database | `tests/database.cjs`, existing migration files through033 | Disposable PGlite using real transaction/RPC and schema publication/enrollment functions |
| Existing benchmarks | `scripts/benchmark-secure-v2-esp32.cjs`, `scripts/benchmark-secure-v2.cjs`, `docs/SECURE-V2-ESP32-BENCHMARK.md`, `docs/benchmarks/secure-v2-first-esp32.json` | Reproduced to a new file; existing outputs not overwritten |

The repository calls its older authenticated wire format protocol2/3. The user's historical “V1” product/schema baseline is that legacy format; it must not be confused with the new product named Struct Secure V2.

The V2 main runner creates temporary test users, an organization, devices, credentials and schema slots inside a disposable local database. These are not live Struct objects. A restricted adapter connects the existing gateway to that database's real RPC. Successful comparisons verify stored decoded rows and signed receipts. Confirmed single-record tests also verify duplicate receipt handling without duplicate rows. The C pilot independently verifies the actual gateway rejects tampered frames and the C SDK accepts authentic receipts.

The legacy network runner deliberately stops at actual codec/authentication/receipt primitives. It does not validate the whole legacy database persistence path. Its receipt byte lengths are real, but “confirmed database storage” is not claimed for that endpoint. Similarly, Struct impairment tests use an authenticated local mock sink; their confirmed outcome is sink acceptance, not a database transaction.

Production sources are imported and not rewritten. The benchmark sets local flags and a disposable credential-encryption key only in its own child process. It does not load `.env`, connect to Supabase, contact `ingest.usestruct.com`, provision a live device, change schemas on a service, or deploy anything. All test sockets bind loopback. There is no benchmark frontend.

The native gateway parser was unavailable on this host; the existing JavaScript fallback processed these cases. Performance results therefore describe that path. Physical ESP32 qualification and deployed PostgreSQL/Supabase latency are not implied by local PGlite success.

## Issues discovered while building the research harness

These are retained as diagnostics rather than hidden by a clean final run:

1. **UDP burst overload:** unpaced sequential sends can exceed this host's receive capacity even at zero injected loss. A separate burst experiment and offered-versus-observed counts preserve this result. Paced tests separate host overload from deliberate drops. This is evidence against treating every successful local `send` call as delivery.
2. **Large DTLS blockwise integration:** larger Californium echo exchanges timed out during the pilot. The harness now explicitly excludes NON payloads above1024 and CON above2048 pending diagnosis. This is an integration limitation, not a claim that DTLS/CoAP cannot transfer larger data. Actual plain CoAP blockwise reaches16KB.
3. **Windows ephemeral-port reuse:** immediately releasing temporary bound ports could return the same port to independent local endpoints. The helper now reserves uniqueness for the test process. This fixed the harness, not production code.
4. **Leshan demo TLS bind collision:** the selected milestone demo uses its TCP port when an explicit TLS bind address is supplied. A separate loopback address avoids collision while retaining actual upstream binaries. Unused transports remain loopback-bound; they are not benchmark coverage.
5. **OSCORE temporary context cleanup:** aiocoap's POSIX-oriented lock cleanup conflicted with Windows filelock deletion. A narrow local cleanup adapter releases and recreates the disposable marker before destruction. The installed library and protocol behavior are unchanged.
6. **Delayed ACK attribution and LwM2M management contamination:** DTLS/LwM2M can send a separate-response ACK asynchronously. Quiet intervals retain those within the originating exchange. An independent review also found a registration-update POST inside a SenML CBOR Send window. The Windows log reader used `stat().st_size` (bytes) to slice translated text (characters), hid the success marker, and waited six seconds; Leshan's short60-second lifetime scheduled an update after approximately7seconds. The reader now slices raw bytes and requires the actual success marker. Revalidation gives isolated CBOR Send52B up/12B down plaintext,96B up/56B down DTLS. Original mixed-window observations and timestamped diagnostics remain in raw artifacts. This corrected measurement behavior, not protocol implementation.
7. **Tool availability:** no TShark/Npcap, Docker, WSL installation or Java was initially available. Official Mosquitto binary retrieval failed; the actual maintained NanoMQ broker was used. Adoptium's API returned403; the pinned official GitHub JDK release worked. These are environment findings, not protocol failures.

Final `failed` counts describe the retained validation run. They do not erase these development failures or mean every requested setting was implemented. Explicit exclusions and remaining research are listed in compatibility and final reports.
