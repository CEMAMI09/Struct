"""Versioned primary-source registry and explicit compatibility constraints."""
import json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,dump

sources=[
 ('protobuf-encoding','https://protobuf.dev/programming-guides/encoding/','Base 128 Varints; Message Structure; Packed Repeated Elements; Field Order',['wire keys, varints, zigzag, lengths, fixed32/64, repeated framing']),
 ('protobuf-languages','https://protobuf.dev/reference/','Language reference and generated code guides',['official language runtimes and code generation; not a direct MCU certification']),
 ('nanopb','https://github.com/nanopb/nanopb','README; LICENSE',['small C Protobuf implementation, researched but not benchmarked']),
 ('zephyr-lwm2m','https://docs.zephyrproject.org/latest/services/connectivity/networking/api/lwm2m.html','Overview; Security modes; Sample usage',['Zephyr LwM2M implementation and DTLS options; hardware ports not tested here']),
 ('wakaama-status','https://github.com/eclipse-wakaama/wakaama','Repository status; README',['C implementation; repository archived September15 2026; not selected as maintained benchmark implementation']),
 ('udp-guidelines','https://www.rfc-editor.org/rfc/rfc8085','3.1; 3.2',['UDP applications need congestion control and bounded message sizes; local burst loss is not a cellular model']),
 ('mqtt-311','https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html','2.2; 3.1; 3.3-3.7; 4.3',['Remaining Length, CONNECT, PUBLISH, QoS control exchanges, persistent sessions']),
 ('mqtt-5','https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html','2.2; 3.1; 3.3-3.7; 4.3',['MQTT5 property lengths, QoS, connection/session semantics']),
 ('coap-rfc','https://www.rfc-editor.org/rfc/rfc7252','3; 4; 5.3; 5.4; 6.5; 9',['4-byte base header, tokens, option deltas, payload marker, CON/NON semantics']),
 ('oscore-rfc','https://www.rfc-editor.org/rfc/rfc8613','3-6; 8-9; Appendix B',['AEAD context, partial IV/KID, inner/outer options, replay handling, sequence persistence']),
 ('cbor-rfc','https://www.rfc-editor.org/rfc/rfc8949','3; 4.2',['major types, integer/string/map/array lengths; deterministic shortest floating representations']),
 ('json-rfc','https://www.rfc-editor.org/rfc/rfc8259','2; 6-8',['JSON syntax and UTF8; bytes and 64-bit portable integers require explicit conventions']),
 ('tls13-rfc','https://www.rfc-editor.org/rfc/rfc8446','4; 5; 7; 8',['TLS1.3 handshake, record header, inner content type, AEAD, forward secrecy qualifications']),
 ('tls13-current','https://www.rfc-editor.org/info/rfc9846/','1.2; 4; 5',['2026 backward-compatible TLS1.3 revision obsoletes8446; measured libraries are not claimed audited against every revised requirement']),
 ('udp-rfc','https://www.rfc-editor.org/rfc/rfc768','Format',['8-byte UDP header']),
 ('ipv4-rfc','https://www.rfc-editor.org/rfc/rfc791','3.1',['minimum20-byte IPv4 header; options and fragmentation require separate accounting']),
 ('ipv6-rfc','https://www.rfc-editor.org/rfc/rfc8200','3-4',['40-byte IPv6 base header; extension headers excluded from simple estimates']),
 ('dtls12-rfc','https://www.rfc-editor.org/rfc/rfc6347','4.1; 4.2',['DTLS1.2 record header, epochs, sequence numbers, handshake retransmissions']),
 ('dtls-cid-rfc','https://www.rfc-editor.org/rfc/rfc9146','3-5',['DTLS1.2 connection ID negotiation, type25 variable record header, encrypted inner content type; measured6-byte CIDs']),
 ('ecdhe-psk-rfc','https://www.rfc-editor.org/rfc/rfc8442','2; 4',['ECDHE_PSK AES-GCM/CCM suites; ephemeral key exchange distinction from pure PSK']),
 ('iana-tls','https://www.iana.org/assignments/tls-parameters','TLS Cipher Suites; ContentType',['0xD001 is TLS_ECDHE_PSK_WITH_AES_128_GCM_SHA256; record type25 is DTLS1.2 CID']),
 ('dtls13-rfc','https://datatracker.ietf.org/doc/html/rfc9147','4; 5',['DTLS1.3 exists; not selected Scandium version coverage']),
 ('observe-rfc','https://www.rfc-editor.org/rfc/rfc7641','3-4',['Observe registration, notifications, cancellation']),
 ('blockwise-rfc','https://www.rfc-editor.org/rfc/rfc7959','2-3',['Block1/Block2 options and reassembly; not equal to IP fragmentation']),
 ('senml-rfc','https://www.rfc-editor.org/rfc/rfc8428','4-6',['SenML names, base names, numeric labels, JSON/CBOR formats']),
 ('http11-rfc','https://www.rfc-editor.org/rfc/rfc9112','2-3; 6; 9',['HTTP1.1 framing, Content-Length, request/response and persistent connections']),
 ('lwm2m11','https://www.openmobilealliance.org/release/LightweightM2M/V1_1-20180710-A/','Core and Transport specifications; registration, information reporting and data formats',['LwM2M1.1 registration/update, Read/Observe/Send, resource paths, content formats']),
 ('lwm2m12','https://www.openmobilealliance.org/release/LightweightM2M/V1_2-20201110-A/','Core and Transport specifications',['LwM2M1.2 is a separate target; no claim that Leshan M18 implements it']),
 ('leshan','https://github.com/eclipse-leshan/leshan','README; release leshan-2.0.0-M18; Maven artifact sources',['Java LwM2M implementation, model codecs, local demos, dual licensing']),
 ('leshan-features','https://github.com/eclipse-leshan/leshan/wiki/LWM2M-1.1-supported-features','Data formats; reporting; security; transport',['1.1 codecs and Send/Observe; experimental OSCORE/TCP; no automatic 1.2 claim']),
 ('californium','https://github.com/eclipse-californium/californium','README; bundled version 4.0.0-M6',['CoAP library and Scandium DTLS implementation']),
 ('aiocoap','https://aiocoap.codeberg.page/aiocoap/doc/installation.html','Features; extras; non-Linux transports',['Python CoAP/OSCORE, optional DTLS dependency, Windows transport limits']),
 ('paho-python','https://eclipse.dev/paho/files/paho.mqtt.python/html/','Client; network loop; TLS; QoS; known limitations',['MQTT3.1.1/5 client, QoS0/1/2, TLS context injection, session caveats']),
 ('nanomq','https://github.com/nanomq/nanomq','README; tag0.25.6; LICENSE',['portable Windows real broker; MQTT3/5; MIT license']),
 ('nanomq-windows','https://nanomq.io/docs/en/latest/installation/windows.html','Windows binaries and supported features',['Windows portable distribution; TLS build dependent']),
 ('cbor2','https://cbor2.readthedocs.io/en/latest/','Usage; canonical encoding',['actual binary serializer; canonical float minimization']),
 ('mosquitto','https://mosquitto.org/download/','Windows downloads',['researched initial broker candidate; official download DNS failure; NanoMQ used instead']),
 ('struct-source','repository:474e6b73f147c4dc4fef840ac5d0f66b46d86434','sdk/js/{index,protocol,secure-v2,secure-v2-client}.cjs; protocol/schema/bitpacked.cjs; sdk/c; tcp-server; migrations033',['actual framing, cryptography, slots, batches, counters, receipts, schema limits; source hashes in environment manifest']),
 ('roi-1nce','https://www.1nce.com/en-us/1nce-connect/pricing','US pricing and FAQ',['USD14/10years/500MB; USD10/500MB topup; flat fee is not per-message marginal billing']),
 ('roi-hologram','https://www.hologram.io/pricing/','Self-service',['USD0.03/MB plus USD1/month/SIM and USD3/SIM; contract differences']),
 ('roi-aws','https://aws.amazon.com/iot-core/pricing/','Messaging; connection; rules; region selector',['5KB message billing increments; shrinking within one increment need not reduce ingestion charges'])]
dump('references/sources.json',[dict(id=i,url=u,sections=s,retrieved_date='2026-10-10',retrieval_timezone='America/Los_Angeles',claims=c,
 status='source inspected' if i!='dtls13-rfc' else 'standard reference; full feature implementation not tested') for i,u,s,c in sources])

compat=[]
def add(protocol,security,delivery,serializations,status,reason='',**more):
    compat.append(dict(protocol=protocol,security_mode=security,delivery_mode=delivery,supported_serialization=serializations,status=status,limitations=reason,**more))
add('Struct legacy V1','HMAC plaintext / optional ChaCha20-Poly1305','send once / signed receipt',['legacy-le-v1'],'measured',
 'Legacy receipt benchmark endpoint does not exercise database persistence. Native batching absent.',network_type=['IPv4'],implementation='repository JS SDK',batching='not supported by legacy SDK')
add('Struct Secure V2','mandatory ChaCha20-Poly1305','unconfirmed / authenticated commit receipt',['legacy-le-v1','bitpacked-v1'],'measured',
 '1200 B configured frame maximum; 16 immutable slots/device; codec types restricted; no native compression.',network_type=['IPv4'],batching='native count + equal-size records; SDK splits oversized batches')
add('Struct Secure V2','unencrypted','any',[],'not_supported_by_protocol','Secure V2 requires AEAD; never offer security disabled')
add('Struct JS SDK','mandatory AEAD','any',['legacy-le-v1','bitpacked-v1'],'not_supported_by_chosen_library','Selected SDK creates udp4 sockets; no IPv6 SDK claim',network_type=['IPv6'])
add('MQTT3.1.1 / MQTT5','TCP / TLS1.2 / TLS1.3','QoS0 / QoS1 / QoS2',['Protobuf','compact JSON','positional JSON','canonical CBOR','positional CBOR'],'measured',
 'Publisher leg measured; observer leg excluded; anonymous MQTT identity, certificate-verified server TLS; OpenSSL terminator explicitly part of stack.',network_type=['IPv4','IPv6'],batching='application envelope',connection_behavior=['persistent','fresh','reused 1/2/5/10/25/50/100 readings','idle PING'])
add('HTTPS HTTP1.1','TLS1.2 / TLS1.3','HTTP200 after decode',['compact JSON','standard JSON','gzip JSON'],'measured',
 'HTTP1.1 local test endpoint, not a managed cloud-service benchmark; TCP packet totals unknown.',network_type=['IPv4','IPv6'],batching='JSON array',connection_behavior=['persistent','fresh'])
add('CoAP','none','CON / NON +2.04',['CBOR','JSON','Protobuf'],'measured',network_type=['IPv4','IPv6'],batching='application envelope',implementation='aiocoap0.4.17')
add('CoAP OSCORE','AES-CCM8 / AES-CCM16 / ChaCha20-Poly1305','CON / NON +2.04',['CBOR','JSON','Protobuf'],'measured',
 'Preprovisioned contexts; no EDHOC handshake; partial IV length changes; current high-volume harness uses real low-level OSCORE and local resource wrapper.',network_type=['IPv4','IPv6'])
add('CoAP DTLS','DTLS1.2 PSK AES128CCM8 / AES128CCM16','CON / NON echo',['CBOR','JSON','Protobuf'],'measured',
 'IPv4 pilot; echo responses repeat payload. Larger automatic blockwise integration timed out: <=1024 B NON and <=2048 B CON retained. Tamper/replay negative DTLS tests pending.',network_type=['IPv4'],implementation='Californium/Scandium4.0.0-M6')
add('CoAP DTLS','DTLS1.3','CON / NON',[],'not_supported_by_chosen_library','Chosen Scandium stack covers DTLS1.2; future library investigation required')
add('CoAP UDP','none','Observe / blockwise',['opaque bytes'],'measured','Actual high-level aiocoap Context handles blockwise1024..16384 B and notification; not sensor-schema comparison')
add('LwM2M1.1','none / DTLS1.2 PSK','registration / update / Read / native Send',['TLV','LwM2M JSON','SenML JSON','SenML CBOR'],'measured',
 'Network original schema pilot IPv4; wider codec library includes single-resource text/opaque. Model33000 is local vendor-test object.',implementation='Leshan2.0.0-M18',network_type=['IPv4'])
add('LwM2M1.2','any','any',[],'not_supported_by_chosen_library','Leshan M18 target is1.1; no1.2 measurement claimed')
add('LwM2M1.1','OSCORE / TCP / TLS','Observe and additional secure transports',[],'not_implemented_in_harness','Leshan documents experimental OSCORE/TCP and supports Send/Observe; network coverage must be extended before exposing these settings')
add('Any stack','any','any',[],'not_tested','Physical ESP32 timing, energy, radio framing, cellular billing, capture-level TCP segmentation/ACKs, DNS, TLS resumption/0RTT, certificate chains/mTLS not measured')
add('LwM2M1.1','none / DTLS1.2 PSK','Observe / Notify',[],'not_implemented_in_harness','Chosen library supports it; generic CoAP Observe measurements must not substitute for LwM2M notification costs')
add('CoAP OSCORE','all tested algorithms','blockwise / Observe',[],'not_implemented_in_harness','Secure high-level integration remains untested; plain CoAP tests do not establish these interactions')
add('CoAP DTLS','CID disabled / alternate CID lengths','CON / NON',[],'not_tested','Measured handshakes negotiate6-byte CIDs. CID toggles, lengths and NAT migration remain untested')
add('MQTT','TLS resumption / mTLS','session recovery',[],'not_tested','Persistent TCP is measured; durable-session recovery and client certificate identity are separate')
add('Struct Secure V2','mandatory AEAD','alternate maximum / all slots',[],'not_tested','Source supports25..1400-byte configured maximum and16slots; benchmark uses1200 and selected slots')
for item in compat:
    for key,default in [('network_type',[]),('connection_behavior',[]),('batching','see stack adapter; not universal'),('implementation',None)]:item.setdefault(key,default)
dump('config/compatibility.json',compat)

security=[
 dict(mode='Struct legacy authenticated plaintext',confidentiality=False,integrity='HMAC-SHA256',tag_bytes=32,nonce_transmitted_bytes=12,identity='device shared API secret',replay='timestamp + nonce gateway policy; network harness does not exercise full legacy replay store',forward_secrecy=False,key_rotation='separate service provisioning',scope='message'),
 dict(mode='Struct legacy encrypted',confidentiality=True,integrity='ChaCha20-Poly1305 plus outer HMAC',tag_bytes=16,outer_mac_bytes=32,nonce_transmitted_bytes=24,identity='device API secret plus encryption key',forward_secrecy=False,scope='message'),
 dict(mode='Struct Secure V2',confidentiality=True,integrity='ChaCha20-Poly1305',tag_bytes=16,nonce_transmitted_bytes=0,nonce='HKDF direction-specific8B prefix plus BE32sequence',wire_id_bytes=4,sequence_bytes=4,identity='device root secret; gateway receipt possession of root-derived key',replay='PostgreSQL monotonic replay state and duplicate-commit handling',forward_secrecy=False,key_rotation='re-enrollment/root-secret lifecycle; sequence exhaustion must not reuse nonce',scope='message',negative_tests='C pilot tamper; broader wire tag tamper; gateway tests in repository'),
 dict(mode='OSCORE AES-CCM8',confidentiality=True,integrity='AES-CCM',tag_bytes=8,nonce='derived; Partial IV and sender KID transmitted as needed',identity='preprovisioned paired context',replay='sliding replay window',forward_secrecy=False,key_rotation='replace context before sequence/key exhaustion; EDHOC not tested',scope='message end-to-end',negative_tests='real aiocoap tamper and replay rejection'),
 dict(mode='OSCORE AES-CCM16 / ChaCha20-Poly1305',confidentiality=True,tag_bytes=16,nonce='derived Partial IV',identity='paired context',replay='sliding replay window',forward_secrecy=False,scope='message end-to-end',negative_tests='real aiocoap tamper and replay rejection'),
 dict(mode='TLS1.2 / TLS1.3 measured',confidentiality=True,integrity='negotiated AEAD; parse ServerHello cipher from raw connection records',tag_bytes=16,identity='server certificate verified against temporary local trust anchor; MQTT publisher is anonymous',replay='connection record sequence; application replay/dedup separate',forward_secrecy='ephemeral key exchange for selected certificate handshakes; inspect negotiated cipher; not same as static Struct/OSCORE PSK',scope='connection terminating at local gateway',key_rotation='certificates/trust/client credentials separately managed',negative_tests='wrong CA and corrupted ciphertext rejected by same OpenSSL library'),
 dict(mode='DTLS1.2 PSK CCM8 / CCM16',confidentiality=True,tag_bytes=[8,16],identity='shared PSK identity',nonce='8-byte record explicit nonce plus implicit context',connection_id_bytes=6,record_header_bytes=19,inner_content_type_bytes=1,configuration='actual Scandium default CID negotiation; parse per-connection Hello, not universal DTLS constant',replay='DTLS record replay filtering; application guarantees separate',forward_secrecy=False,scope='connection',negative_tests='not_tested; successful real authenticated encryption/decryption only')]
security.append(dict(mode='LwM2M measured DTLS1.2 ECDHE_PSK AES128GCM',confidentiality=True,integrity='AES-GCM',tag_bytes=16,
  negotiated_cipher='TLS_ECDHE_PSK_WITH_AES_128_GCM_SHA256',cipher_code='0xD001',identity='PSK-authenticated ephemeral key exchange',
  nonce='8-byte explicit record nonce plus implicit context',connection_id_bytes=6,record_header_bytes=19,inner_content_type_bytes=1,
  forward_secrecy='ECDHE suite supports forward secrecy with fresh ephemeral secrets and proper erasure; unlike direct pure-PSK CCM benchmark',
  scope='connection',negative_tests='DTLS negative tamper/replay not tested',sources=['ecdhe-psk-rfc','iana-tls','dtls-cid-rfc']))
dump('references/security-matrix.json',security)
dump('references/roi-pricing.json',[
 dict(provider='1NCE',region='US public page',currency='USD',retrieved_date='2026-10-10',publication_date=None,plan='Lifetime Flat',upfront=14,term_years=10,included_MB=500,topup_USD=10,topup_MB=500,billing_increment_bytes=None,source_reference='roi-1nce',limitations='Bundle, taxes/shipping/coverage/contract limits apply. Do not treat14/500 as marginal per-MB charge.'),
 dict(provider='Hologram',region='global self-service subject to coverage',currency='USD',retrieved_date='2026-10-10',publication_date=None,per_MB=.03,monthly_per_SIM=1,SIM_card=3,billing_increment_bytes=None,source_reference='roi-hologram',limitations='Public self-service example; negotiated and regional plans differ; session rounding not established.'),
 dict(provider='AWS IoT Core',currency='USD',retrieved_date='2026-10-10',publication_date=None,region='region-specific pricing selector',billing_unit='message in5KB increments',billing_increment_bytes=5120,unit_price=None,source_reference='roi-aws',limitations='Separate connectivity, ingestion/fanout, rules, actions and other services; no price inferred without region/tier. Reducing below5KB may save zero billed messages.'),
])
dump('config/test-matrix.json',dict(version='1.0.0',strategy='Explicit runner selections; not a full cross product and not claimed to be formal pairwise coverage',
 library='schemas/library.json',runners={
 'serialization':'all367cases x8serializers; reference/preset batches; selected packed and field16Protobuf variants',
 'struct':'allcases attempted against2realcodecs; supported schemas xconfirmed/unconfirmed; legacy plaintext/encrypted where applicable; reference/preset batches',
 'coap':'allcases x6serializers xCON/NON xIPv4/IPv6;3OSCORE algorithms for all nonrandom cases plus20random; reference batches and token/path variations',
 'mqtt':'reference/preset/payload-size/field-count/unicode/nested/array/optional and10random x5serializers x2versions x3QoS x3security x2network; reference batches/topic/properties',
 'mqtt_connections':'original schema x3serializers x2versions x3QoS x3security x2network x7connection-reuse counts;3idlePINGcases',
 'https':'representative families x2JSONstyles x2compression x2TLS x2network; reference batches; selected fresh sessions',
 'lwm2m':'allcases x6codecformats with explicitunsupportedmapping; network originalvalues x4Readformats,2nativeSendformats,registration/update xNoSec/DTLS',
 'coap_dtls':'representative113cases x3serializers xCON/NON x2PSKciphers; reference batches; explicitlargeintegrationlimits',
 'impairment':'realCoAPContext sixlossrates xCON/NON,100/1000readings;4latency/jitter scenarios; actualStructSDK sixlossrates,20/1000readings; separateburstoverload run'},
 remaining='See compatibility.json and reports/FINAL-REPORT.md'))
print('Research registries written:',len(sources),'sources')
from inventory import main as inventory
inventory()
