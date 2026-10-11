# Protocol Lab audit — before implementation, 2026-10-11

The retained `coverage-before.json` runs the existing calculator across ten built-in presets × security × delivery × precision × batches 1/10 × IPv4/IPv6, producing 1,920 protocol results. It uses the original network-boundary default. It is calculator coverage, not new packet measurements.

Verified causes:

1. The default network boundary requests TCP/IP totals, but all archived MQTT/HTTPS records explicitly lack packet counts. Their stream bytes cannot be promoted to measured network totals. This is a measurement limitation, not an index lookup failure.
2. `lwm2m()` only accepts one original-precision IPv4 reading, matching the exact ESP32 sample. Thousands of Leshan codec records are available but the calculator has no custom SenML Send encoder/profile. TLV Read and native Send cannot be silently substituted.
3. `finalMetric()` creates a single eligibility key containing encryption algorithm/tag, identity, forward secrecy, acknowledgment and response policy. `calculate()` refuses any percentage on a mismatch, even where bytes represent identical layers/data. Semantic disclosure and size eligibility must be independent.
4. Security Off explicitly maps Struct to V1 HMAC framing (66 bytes), and disables native batching. This is an implemented fallback, not a measurement. A separate generation-marked local plaintext benchmark is necessary; production V2 must remain authenticated.
5. Defaults select original precision. Packed compiler supports only <=32-bit integers and binary32/binary16. The original compiler only supports float32/int32/uint8/bool/flags/char. GPS and common timestamp/energy presets expose actual Float64/uint64 limitations.
6. Optimized reference matching excludes all lossless records, even when optimization leaves values unchanged. Reference lookup uses the first matching schema, rather than all encoding-equivalent cases; record IDs are evidence, not a prerequisite for exact encoding calculations.
7. Struct's SDK transport is IPv4-only. This is distinct from the V2 datagram format, which can be independently tested on local IPv6. A calculated IPv6 result must disclose the device SDK transport limitation.
8. ROI repeats the all-or-nothing eligibility key. It consequently withholds valid traffic/cost differences based on security semantics. Incomplete network traffic must still remain ineligible.
9. Results initially expose thirteen technical rows. Result presentation has no independent Simple/Advanced state.
10. No TShark/dumpcap/installed Wireshark was found in this environment. New TCP network values must be explicitly modeled with stated segmentation/ACK/header assumptions, not called captures. Packet capture remains outstanding.

Changes will preserve original research, existing payload bytes and slots. New schema capabilities are additive and require publishing unused slots after gateway/SDK rollout; no migration or production publication is executed here.
