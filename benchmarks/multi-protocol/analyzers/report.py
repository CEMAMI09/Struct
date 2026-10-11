"""Generate the final narrative/tables from the validated dataset, never size constants."""
import csv,gzip,hashlib,json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,ROOT,dump

def load(path):return json.loads((BASE/path).read_text(encoding='utf8'))
def table(headers,rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
      ['| '+' | '.join('—' if x is None else str(x) for x in row)+' |' for row in rows])

def main():
    coverage=load('results/summaries/coverage.json');artifacts=load('results/summaries/artifacts.json');runtime=load('results/raw/runtime.json')
    with gzip.open(BASE/'results/normalized/records.ndjson.gz','rt',encoding='utf8') as f:rows=[json.loads(line) for line in f]
    good=[r for r in rows if r['test_status']=='passed']
    def first(predicate):return next(r for r in good if predicate(r))
    chosen=[]
    def add(label,predicate):
        r=first(predicate);chosen.append((label,r));return r
    def ref(r):return r['schema_id']=='esp32-original' and r['batch_size']==1 and r['network_type']=='IPv4'
    for security,label in [('HMAC-SHA256; no confidentiality','Legacy plaintext / HMAC'),('ChaCha20-Poly1305 + HMAC-SHA256','Legacy encrypted / HMAC')]:
        add(label,lambda r,s=security:ref(r) and r['protocol_category']=='Struct' and r['security_configuration']==s and r['delivery_mode']=='confirmed')
    original=add('Secure V2 original / commit receipt',lambda r:ref(r) and r['protocol_stack']=='Struct Secure V2' and r['delivery_mode']=='confirmed' and r['protocol_specific_settings']['codec']=='legacy-le-v1')
    optimized=add('Secure V2 optimized / commit receipt',lambda r:r['schema_id']=='esp32-optimized' and r['batch_size']==1 and r['protocol_stack']=='Struct Secure V2' and r['delivery_mode']=='confirmed')
    for codec in ['protobuf','json-compact','cbor-canonical','cbor-array']:
        add(codec+' + CoAP plain',lambda r,c=codec:ref(r) and r['protocol_stack']==c+'+CoAP+UDP' and r['delivery_mode'].startswith('CON piggyback') and r['protocol_specific_settings']['token_length']==2 and r['protocol_specific_settings']['uri_path']==['t'])
    for alg,label in [('AES-CCM-16-64-128','CCM8'),('AES-CCM-16-128-128','CCM16'),('ChaCha20/Poly1305','ChaCha20')]:
        add('CBOR array + CoAP/OSCORE '+label,lambda r,a=alg:ref(r) and r['protocol_stack']=='cbor-array+CoAP+OSCORE+UDP' and r['security_configuration']==a and r['delivery_mode'].startswith('CON piggyback') and r['protocol_specific_settings']['token_length']==2 and r['protocol_specific_settings']['uri_path']==['t'])
    for cipher,label in [('TLS_PSK_WITH_AES_128_CCM_8','CCM8'),('TLS_PSK_WITH_AES_128_CCM','CCM16')]:
        add('Protobuf + CoAP/DTLS '+label+' echo',lambda r,c=cipher:ref(r) and r['protocol_stack']=='protobuf+CoAP+DTLS' and r['security_configuration']==c and r['delivery_mode'].startswith('CON'))
    for secure in [False,True]:
        add('LwM2M Send SenML CBOR '+('DTLS' if secure else 'plain'),lambda r,s=secure:ref(r) and r['protocol_category']=='LwM2M' and r['delivery_mode']=='Send 2.04 Changed' and r['security_enabled']==s and r['protocol_specific_settings']['content_format']=='SENML_CBOR')
    udp_table=table(['Actual configuration','Payload B','Datagrams up B','Datagrams down B','IPv4 uplink B*','Exchange B*'],
      [[label,*[r.get(k) for k in ['serialized_payload_bytes','application_uplink_bytes','application_downlink_bytes','total_uplink_bytes','total_network_bytes']]] for label,r in chosen])
    mqtt=[]
    for name in ['protobuf','json-compact','cbor-array']:
        for tls in [None,'TLSv1.3']:
            r=first(lambda r,n=name,t=tls:ref(r) and r['protocol_stack']==n+('+MQTT+TLS' if t else '+MQTT+TCP') and r['security_configuration']==t and r['delivery_mode']=='QoS 1' and r['connection_mode']=='persistent' and r['protocol_specific_settings']['mqtt_version']==5 and not r['protocol_specific_settings']['properties'])
            mqtt.append((name+' MQTT5 QoS1 '+(tls or 'TCP'),r))
    r=first(lambda r:ref(r) and r['protocol_stack']=='json-compact+HTTPS/TLS' and r['security_configuration']=='TLSv1.3' and r['connection_mode']=='persistent' and r['protocol_specific_settings']['content_encoding']=='identity');mqtt.append(('Compact JSON HTTPS TLS1.3',r))
    stream_table=table(['Configuration','Payload B','Plain up/down B','Stream up/down B','Setup stream B†'],
      [[label,r['serialized_payload_bytes'],f"{r['application_uplink_bytes']}/{r['application_downlink_bytes']}",f"{r['stream_uplink_bytes']}/{r['stream_downlink_bytes']}",r['handshake_bytes']] for label,r in mqtt])
    serializer_table=[]
    for name in ['protobuf','json-compact','json-standard','json-array','cbor','cbor-canonical','cbor-array','cbor-integer-keys']:
        r=first(lambda r,n=name:r['schema_id']=='esp32-original' and r['protocol_stack']==n and r['batch_size']==1)
        serializer_table.append([name,r['serialized_payload_bytes']])
    sizes=[]
    for size in [1,16,64,256,1024,4096,16384]:
        sizes.append([size]+[first(lambda r,n=name,s=size:r['schema_id']==f'bytes-{s}' and r['protocol_stack']==n and r['batch_size']==1)['serialized_payload_bytes'] for name in ['protobuf','cbor-canonical','cbor-array','json-compact']])
    struct_sizes=[]
    for n in [1,2,3,5,10,20,50,100]:
        r=first(lambda r,n=n:r['schema_id']==f'count-{n}-float32' and r['protocol_stack']=='Struct Secure V2' and r['delivery_mode']=='unconfirmed' and r['protocol_specific_settings']['codec']=='legacy-le-v1')
        struct_sizes.append([n,r['serialized_payload_bytes'],r['application_uplink_bytes'],r['total_uplink_bytes']])
    blockwise=[]
    for r in good:
        if r['protocol_stack']=='CoAP+UDP blockwise':blockwise.append([r['serialized_payload_bytes'],r['application_uplink_bytes'],r['application_downlink_bytes'],r['total_network_bytes']])
    batch=[]
    for n in [1,2,5,10,25,50,100]:
        r=first(lambda r,n=n:r['schema_id']=='esp32-original' and r['protocol_stack']=='Struct Secure V2' and r['delivery_mode']=='confirmed' and r['batch_size']==n and r['protocol_specific_settings']['codec']=='legacy-le-v1')
        batch.append([n,r['application_uplink_bytes'],r['application_downlink_bytes'],r['total_network_bytes'],round(r['effective_bytes_per_reading'],2)])
    loss=[]
    for r in good:
        if r['protocol_stack']=='Struct Secure V2 impairment' and not r['protocol_specific_settings']['burst']:
            loss.append([r['protocol_specific_settings']['loss_probability'],r['delivery_mode'],f"{r['unique_readings_received']}/{r['logical_readings']}",r['actual_retransmitted_datagrams'],r['sink_unobserved_attempts']])
    status=coverage['test_status_counts'];passed=status.get('passed',0);failed=status.get('failed',0);unsupported=status.get('unsupported',0)
    counts_table=table(['Runner','Passed','Unsupported','Failed'],[[n,*[c.get(k,0) for k in ['passed','unsupported','failed']]] for n,c in coverage['per_runner'].items()])
    wall=sum(x['wall_seconds'] for x in runtime['phases']);peak=max(x['peak_process_tree_rss_bytes'] for x in runtime['phases'])
    size=artifacts['total_compressed_dataset_bytes'];raw=artifacts['total_raw_uncompressed_bytes']
    implementation_table=table(['Implementation','Version','Role'],[[x['id'],x['version'],x.get('runtime')] for x in load('references/implementations.json')])
    report=f'''# Multi-protocol benchmark final report — dataset1.0.0

## Outcome and scope

Executed **{coverage['total_configurations']:,} retained configurations: {passed:,} passed, {failed:,} failed, {unsupported:,} explicitly unsupported**. The library contains **{coverage['unique_schema_value_cases']} tested schema/value cases and {coverage['distinct_schema_definitions']} distinct field definitions**. Cases sharing a schema at different boundary values are not counted as different definitions. Configuration rows are not individual readings, packets or a complete cross-product. The final dataset contains raw serialization tests as well as actual network exchanges.

{counts_table}

Four actual C/mbedTLS gateway modes, four C-pilot tamper rejections and two TLS negative-test configurations are supplemental validation, outside those configuration counts. Unsupported rows are real mapping/capability exclusions; they are not successful transmissions. Earlier failed development attempts are documented in the repository audit, including the DTLS timeout and LwM2M mixed-traffic investigation. Zero failures in the retained run does not mean every requested option is supported.

All services ran locally with disposable credentials and database state. No production services, live devices, Supabase, credentials, gateway configuration, website, landing page or calculator were modified. No cloud benchmark service was purchased. Production implementations were reused, not rewritten for benchmark convenience.

## Implementations and coverage

{implementation_table}

Standards include Protobuf wire encoding; JSON/CBOR; MQTT3.1.1/5; CoAP, OSCORE, Observe and blockwise; TLS1.2/1.3 and DTLS1.2; LwM2M1.1 and its content formats. Current standards research also records the backward-compatible TLS1.3 revision RFC9846 and the separate unmeasured DTLS1.3/LwM2M1.2 targets. Actual package/tool hashes and licenses are retained. Leshan/Californium are pinned milestone builds, not an assertion that every standard feature is complete or that these versions should be deployed in production.

Security coverage: legacy HMAC plaintext, legacy ChaCha20-Poly1305 plus HMAC, mandatory Secure V2 ChaCha20-Poly1305, OSCORE AES-CCM tags8/16 and ChaCha20-Poly1305, certificate-verified server TLS1.2/1.3, DTLS1.2 PSK CCM tags8/16, LwM2M DTLS1.2 ECDHE_PSK AES128GCM, and insecure CoAP/LwM2M reference modes. There is no unencrypted Secure V2. Device identity, forward secrecy, replay, tag/nonce framing and key lifecycle differ; see the separate security matrix. MQTT/HTTPS server-only TLS is not the same device-authentication guarantee as Struct PSKs. Struct/OSCORE and the direct pure-PSK CCM experiments have no forward secrecy. The LwM2M pilot negotiates ECDHE_PSK AES128GCM (0xD001), whose ephemeral exchange supports forward secrecy under proper key handling; it must not be collapsed into the pure-PSK category.

Delivery coverage: Struct unconfirmed and authenticated receipts; MQTT QoS0/1/2; CoAP CON/piggyback ACK and NON/application response; actual CoAP retries, Observe and blockwise; HTTPS200; LwM2M registration/update/Read/native Send. Struct's main V2 gateway receipt follows a real local database transaction. MQTT PUBACK/PUBCOMP, CoAP2.04, HTTP200 and the impairment mock sink do not establish database persistence.

Batch sizes **1/2/5/10/25/50/100** are covered where meaningful. Struct uses native equal-size batches with actual splitter behavior. Competitors use explicit application array/repeated-message envelopes. LwM2M's measured multi-resource values are one reading; broader time-series batching is not claimed.

Network coverage: IPv4 and IPv6 device legs for MQTT/HTTPS/CoAP/OSCORE; IPv4 for current Struct SDK, DTLS and LwM2M. TLS/broker backhaul is local IPv4 and excluded from the device-leg measurement. Persistent/fresh/reused connections,1/2/5/10/25/50/100 readings per MQTT connection and actual idle PING traffic are recorded. DNS, session recovery after outage, TLS resumption/0RTT and alternative certificate chains are not measured.

## Original ESP32 schema: actual reference comparisons

All rows use temp23.5, humidity61.25 and active=true at original precision except the explicitly optimized V2 row. CoAP reference settings: token2, URI `/t`, content format, CON with2.04 response. OSCORE costs use the recorded sender sequence/context. These are observed configurations, not a universal ranking.

{udp_table}

*Datagram content lengths are measured. IPv4 totals add calculated UDP8+IPv4 minimum20 per actual datagram; they are not packet captures. Exchange totals are steady-state and exclude separately recorded initialization. DTLS echo returns the whole payload, unlike the empty CoAP2.04 or Struct receipt. LwM2M Send has a separate lifecycle and SenML structure; see raw diagnostics and the calculation rules. Payload sizes are blank when the network runner did not separately instrument decrypted serialization; codec tests are separate rather than silently substituted.

The actual DTLS handshakes negotiate6-byte connection IDs in both directions. Their visible record headers are19bytes, and the true content type is inside encryption. The analyzer parses the Hello/cipher/CID extensions and validates record lengths, retaining these settings in normalized records. These are actual selected-stack defaults, not a universal DTLS fixed overhead. CID-disabled or migration/reconnection comparisons need additional tests.

The legacy75-byte baseline is authenticated but **unencrypted**, so its103-byte estimated IPv4 uplink is not an equivalent-security comparison. V2 original is **{original['serialized_payload_bytes']}B payload, {original['application_uplink_bytes']}B application uplink, {original['total_uplink_bytes']}B estimated IPv4 uplink**; optimized is **{optimized['serialized_payload_bytes']}B, {optimized['application_uplink_bytes']}B, {optimized['total_uplink_bytes']}B**, respectively. Both have21-byte receipts. Relative to the unencrypted103-byte historical baseline, estimated uplink reductions are **{(1-original['total_uplink_bytes']/103)*100:.2f}%** and **{(1-optimized['total_uplink_bytes']/103)*100:.2f}%**. These percentages combine different security/precision choices and must be labeled accordingly. The real V2 implementation meets the25-byte fixed-overhead target.

The optimized schema is explicitly temp[-40,125] step0.1, humidity[0,100] step0.1, boolean. Humidity becomes61.3, error0.05; this meets the declared precision but is not lossless. The same quantization transform is offered to competitor serializers in separate optimized cases.

{table(['Raw serializer, original semantics','Measured payload B'],serializer_table)}

**CBOR positional arrays encode these original values in8 bytes without losing precision**, less than Struct's original9-byte encoding and Protobuf's12. With an8-byte OSCORE tag, this selected CBOR/CoAP uplink can also be smaller than original V2, but its tag and response/commit semantics differ. With a16-byte tag, compare the actual corresponding row instead. Field-name CBOR maps and positional CBOR have different metadata assumptions; both are retained. The evidence does not support a claim that Struct always produces the smallest payload or that every encrypted mode is security-equivalent.

## MQTT and HTTPS reference streams

MQTT rows use version5, QoS1, topic `telemetry/t`, established connection and no optional properties. HTTPS uses compact JSON, HTTP1.1 `/telemetry`, identity content encoding and an established TLS1.3 connection.

{stream_table}

†Setup is separately measured TLS/MQTT connection bytes, or TLS-only for HTTPS. It excludes TCP SYN/ACK and must not be added once per message on a reused connection. TLS response records and HTTP header/body writes can split differently across runs. These actual stream observations are valid for the captured run; they are not full TCP/IP or cellular totals. All corresponding network-header totals are null. Publisher subscriber-leg traffic is excluded. No stream recv chunk is counted as a TCP packet.

## Multiple sizes and batching

The following actual encodings wrap one deterministic binary field of the stated length. JSON uses an explicit hexadecimal `$bytes` convention; its cost is not ordinary numeric sensor JSON.

{table(['Input binary B','Protobuf B','CBOR named-map B','CBOR array B','JSON tagged bytes B'],sizes)}

Current Struct does not support a native arbitrary byte-array schema, so assigning it an invented16KB encoding would be invalid. Supported float32 field-count sweeps give actual Struct sizes:

{table(['float32 fields','Struct payload B','V2 unconfirmed app B','Estimated IPv4 uplink B'],struct_sizes)}

Actual aiocoap high-level blockwise exchanges reassemble these payloads and verify a SHA256 response:

{table(['Opaque input B','Application up B','Application down B','Estimated IPv4 exchange B'],blockwise)}

These exchanges include Block options and real multiple datagrams; they are not a one-header approximation for a large message. Separate low-level large datagram cases flag1500-byte-path MTU exceedance; actual IP fragmentation was not captured.

Actual native confirmed V2 batches of the original9-byte reading:

{table(['Readings','App up B','App receipt B','Estimated exchange B','Estimated B/reading'],batch)}

Repeated logical readings are not counted as independently transmitted packets. Other stacks' application-envelope and fragmentation behavior remains in the raw/configuration data.

## Impairment, performance and anomalies

Actual seeded UDP drops were injected at0/0.1/1/2/5/10%, not modeled by scaling bytes. Both directions are independently eligible for loss. CoAP high-level experiments use100 CON or1000 NON readings per rate and accelerated50ms ACK timing/max3 retransmissions; these are explicitly not production defaults. Four20-reading latency/jitter scenarios add0,10,25±5 and50±10ms one-way delays.

Struct's real client uses20 confirmed or1000 unconfirmed readings per rate,2 retries,1000ms initial retry setting and4500ms budget. Its sink receipt verifies authenticated acceptance only, not persistence. Requested1ms pacing is subject to Windows timer scheduling. The paced run recorded:

{table(['Injected probability','Delivery','Unique readings received','Actual retried datagrams','Sender attempts unseen at sink'],loss)}

A separate unpaced run preserves host receive overload, including losses with zero injected loss where observed. Raw sender-attempt, sink-ingress and pre-send receipt-drop accounting are separate; no fabricated complete network total is assigned to that experiment. A0.1% configured rate can produce zero observed drops in a short seeded sample; that is not evidence of zero real-world loss.

Python serialization/deserialization and Java LwM2M codec timings retain20 warmups/100 samples with median/p95; compression uses30 samples. Struct host encode/decode and frame encryption/decryption including HKDF retain1000 samples. Protocol exchange, connection and repeated publish latencies are retained where instrumented. These are host/JVM measurements, not ESP32 speed or energy. Process-tree RSS/CPU sampling reports phase resource use, not per-message allocations. No MCU flash/RAM, battery life, radio-tail energy or meaningful cross-language throughput ranking is invented.

Independent validation checks unique IDs, source references, successful decode flags, received-byte sums, UDP/IP formulas, MQTT framing, and separately parses Struct/CoAP wire framing. OSCORE actually rejects altered/replayed messages; Struct C pilot and broader gateway/wire tests cover tamper and duplicate handling; same OpenSSL stack rejects wrong trust anchors and corrupted encrypted records. DTLS tamper/replay negative tests remain unimplemented, so its byte data is labeled provisional for a security-validated public comparison.

## Missing coverage and publication readiness

The retained sampled matrix is broad but intentionally incomplete. Missing work is explicit:

* Packet-captured TCP/IP segments, ACKs, SYN/FIN, retransmissions, real path fragmentation, DNS and any physical-link/cellular framing.
* LwM2M1.2; LwM2M Observe notifications, broader native time-series Send batching, alternate real object layouts, IPv6 network pilot, OSCORE/TCP/TLS transports, bootstrap, rotation and firmware management.
* DTLS1.3; large DTLS blockwise diagnosis; DTLS negative tests; DTLS loss/reconnect/CID/resumption variants.
* MQTT persistent-session recovery, broker crash/persistence semantics, client-ID length sweeps, topic aliases, more property combinations, TLS resumption, mTLS and certificate-chain variations. Persistent TCP connection is not proof of durable MQTT session recovery.
* Protobuf proto3/editions default-presence alternatives and fixed32/sfixed32/fixed64 variants; timestamp-specific well-known-type alternatives; nested/optional semantics beyond this declared library.
* OSCORE EDHOC, context-ID and KID-length sweeps, sequence boundary-focused tests, OSCORE blockwise/Observe interactions; current sequence state is retained and already varies during the actual run.
* Struct all-slot/counter-boundary sweeps, firmware counter persistence/restart behavior and alternative frame maxima; native compression and unsupported schema types are not invented.
* Whole-stack throughput/load, per-message allocation profiles, host-independent performance conclusions, physical ESP32/STM32/Zephyr runs and real power measurements.
* Exhaustive cross-product or mathematically verified pairwise sampling. Current selections are systematic boundary/representative/critical-interaction sweeps, exactly documented in each runner and test matrix.

**Ready for a public reference dataset with disclosures:** actual serialization sizes/precision, actual Struct envelopes and local gateway receipt behavior, single-exchange plain CoAP/OSCORE measurements under recorded options/state, measured MQTT/HTTP plaintext and TLS stream reference cases, and supported LwM2M codec examples. Publish source versions, response guarantees, external-schema assumptions, initialization exclusions and calculated-network labels beside each result.

**Requires further evidence before strong public claims:** complete TCP/cellular traffic savings, broad LwM2M-vs-Struct lifecycle superiority, DTLS behavior outside the validated bounds, universal performance/security/ease ratings and hardware energy/enterprise ROI. The future tool should reject unsupported combinations instead of filling missing cells with optimistic numbers. Calculation readiness is detailed in [CALCULATION-RULES.md](CALCULATION-RULES.md), with exact encoder rules separated from live-test/model requirements.

## Runtime, size and artifacts

The clean sequential execution measured **{wall:.2f} seconds ({wall/60:.2f} minutes)** before normalization; the recorded complete invocation including normalization/validation was approximately7 minutes on this host. Peak sampled summed process-tree RSS was **{peak:,} bytes ({peak/1024**2:.1f}MiB)**. Shared pages can be double-counted and short-lived children missed. Downloads/installations and subsequent targeted investigation reruns are additional. Expect about7–10 minutes on this machine, with different hosts and retry outcomes changing runtime; the first installation additionally downloads a205MB JDK and other tools.

The final LwM2M network pilot was revalidated in5.59seconds after fixing the Windows log-offset contamination issue; that targeted run replaces its earlier network records and is separately recorded in runtime.json. The full-suite timing includes the earlier slower pilot. It is not presented as timing a second full run of unrelated stacks.

The compressed raw+normalized dataset is **{size:,} bytes ({size/1024**2:.2f}MiB)**; raw originals total **{raw:,} bytes ({raw/1024**2:.2f}MiB)**. Both copies remain locally, so disk use exceeds the compressed release size. Original raw files are gitignored to avoid duplication; their full compressed contents are versioned as checksum-verified20MiB chunks in [archive/](../archive/manifest.json). See [START-HERE.md](../START-HERE.md) for restoration. Compact normalized data and compressed CSV summaries are directly versioned. [artifacts.json](../results/summaries/artifacts.json) lists exact sizes/hashes. Raw captures are byte observations, not pcap files.

* [README and reproduction commands](../README.md)
* [Normalized NDJSON.gz](../results/normalized/records.ndjson.gz)
* [All configuration CSV.gz](../results/summaries/all.csv.gz), [reference CSV](../results/summaries/representative.csv), [payload sizes CSV.gz](../results/summaries/payload-sizes.csv.gz)
* [Coverage/counts](../results/summaries/coverage.json), [failed/unsupported report](../results/summaries/failed-unsupported.json), [wire validation](../results/summaries/wire-validation.json)
* [Schema/value library](../schemas/library.json), [test selectors](../config/test-matrix.json), [compatibility matrix](../config/compatibility.json)
* [Security matrix](../references/security-matrix.json), [implementation/license inventory](../references/implementations.json), [sources](../references/sources.json)
* [Environment](../references/environment.json), [source hashes](../references/source-hashes.json), [runtime observations](../results/raw/runtime.json)
* [Repository audit/diagnostics](REPOSITORY-AUDIT.md), [developer experience](DEVELOPER-EXPERIENCE.md), [pricing examples](../references/roi-pricing.json)

ROI research is separate from measurements: published cellular bundles, per-MB plans, minimum fees and cloud5KB message billing are recorded with dates and unknowns. No speculative customer savings were labeled measured. Extend schemas/adapters using the README's validation workflow; do not build a future calculator by looking up only these example sizes.
'''
    reports=BASE/'reports';reports.mkdir(exist_ok=True);(reports/'FINAL-REPORT.md').write_text(report,encoding='utf8')
    pilot=load('results/raw/struct-esp32-pilot.json') if (BASE/'results/raw/struct-esp32-pilot.json').exists() else None
    if pilot:
        content=['# Actual generated C Secure V2 bytes','',
          'These are the actual C/mbedTLS SDK outputs from the reproduced local ESP32-schema pilot. Public disposable test root and the full decoder/receipt/tamper evidence are retained in `results/raw/struct-esp32-pilot.json`. No production credentials were used.','']
        for case in pilot['cases']:
            content += [f"## {case['schema']}, {'confirmed' if case['confirmed'] else 'unconfirmed'}",'',
              'Payload: `'+case['payloadHex']+'`','',
              'Complete application datagram:','', '```text',case['frameHex'],'```','',
              table(['Region','Offset','Bytes','Actual hex'],[[x['name'],x['offset'],x['bytes'],x['hex']] for x in case['layout']]),'']
            if case['receiptHex']:content += ['Receipt: `'+case['receiptHex']+'`','']
            content += ['Decoded: `'+json.dumps(case['decoded'])+'`','']
        (reports/'STRUCT-C-PACKET-BYTES.md').write_text('\n'.join(content),encoding='utf8')
    dump('results/summaries/report-reference-records.json',[dict(label=label,test_id=r['test_id'],raw_artifact=r['raw_artifact'],raw_line=r['raw_line']) for label,r in chosen+mqtt])
    # Source manifest includes harness code and imported production modules.
    paths=[p for p in BASE.rglob('*') if p.is_file() and p.suffix in ['.py','.cjs','.java'] and '__pycache__' not in str(p)]
    for relative in ['sdk/js/secure-v2.cjs','sdk/js/secure-v2-client.cjs','sdk/js/index.cjs','sdk/js/protocol.cjs','protocol/schema/bitpacked.cjs','tcp-server/ingest.js','tcp-server/secure-v2.js','tcp-server/parser.js','web/shared/schemaCodegen.ts','package-lock.json','tests/database.cjs','scripts/benchmark-secure-v2-esp32.cjs']:
        paths.append(ROOT/relative)
    dump('references/source-hashes.json',[dict(path=str(p.relative_to(ROOT)).replace('\\','/'),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(set(paths)) if p.is_file()])
    print('Final report generated from',len(rows),'records')

if __name__=='__main__':main()
