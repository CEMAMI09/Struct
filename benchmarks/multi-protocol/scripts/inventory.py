"""Read-only host/library and implementation inventory."""
import importlib.metadata as md,json,pathlib,platform,ssl,subprocess,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,ROOT,dump

def command(args):
    try:return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=10).strip()
    except Exception as e:return {'not_available':str(e)}

def main():
    names=[line.split('==')[0] for line in (BASE/'config/requirements.lock.txt').read_text().splitlines() if '==' in line]
    packages=[]
    for name in names:
        metadata=md.metadata(name)
        packages.append(dict(name=name,version=md.version(name),license=metadata.get('License-Expression') or metadata.get('License'),classifiers=metadata.get_all('Classifier',[])))
    jdk=next((ROOT/'work/multi-protocol/tools').glob('jdk*/bin/java.exe'),None)
    pilot=BASE/'results/raw/struct-esp32-pilot.json'
    dump('references/environment.json',dict(os=platform.platform(),machine=platform.machine(),cpu=platform.processor(),python=platform.python_version(),
      openssl=ssl.OPENSSL_VERSION,node=command(['node','--version']),java=command([str(jdk),'-version']) if jdk else None,
      packages=packages,packet_capture=False,production_access_used=False,
      c_pilot_compiler=json.loads(pilot.read_text()).get('compiler') if pilot.exists() else None,
      limitations='Host CPU/RSS only; loopback byte observations, no Npcap/TShark, physical device, radio or power measurement'))
    implementations=[
      dict(id='struct',version=command(['git','-C',str(ROOT),'rev-parse','HEAD']),license='No top-level redistribution license found; do not infer open-source licensing',
        runtime='Node24 and C/mbedTLS WASI pilot',serialization=['legacy-le-v1','bitpacked-v1'],transport=['UDP IPv4'],security=['legacy HMAC','legacy optional ChaCha20-Poly1305','SecureV2 mandatory ChaCha20-Poly1305'],
        metadata='device identity/schema reference; V2 wire ID, sequence, slot',connections='preprovisioned; no per-message handshake',limitations='V2 full SDK C/Node; Python/Rust legacy only; original/packed codec field restrictions; no physical qualification',sources=['struct-source']),
      dict(id='protobuf',version=md.version('protobuf'),license='BSD-3-Clause',runtime='google.protobuf Python',serialization=['proto2 dynamic descriptors; explicit presence'],transport='chosen separately: MQTT/CoAP',security='none provided by serialization',metadata='field tags/types and out-of-band .proto schema',connections='none at serialization layer',limitations='null unsupported by selected scalar adapter; half mapped to float32; fixed wire variants/proto3 not sampled',sources=['protobuf-encoding','protobuf-languages']),
      dict(id='json',version=platform.python_version(),license='PSF-2.0 runtime',runtime='Python json',serialization=['compact objects','standard objects','positional arrays'],transport='chosen separately: MQTT/CoAP/HTTP',security='none provided by serialization',metadata='field names or shared array ordering; explicit bytes/large-integer tags',connections='none at serialization layer',limitations='number formatting is implementation-specific; binary/absence conventions explicit',sources=['json-rfc']),
      dict(id='cbor',version=md.version('cbor2'),license='MIT',runtime='cbor2 Python',serialization=['maps','canonical maps','positional arrays','integer-keyed maps'],transport='chosen separately: MQTT/CoAP',security='none provided by serialization',metadata='major-type framing; names or shared schema',connections='none at serialization layer',limitations='canonical shortest lossless floats differ from always-float64 encoding; external schema required for compact layouts',sources=['cbor-rfc','cbor2']),
      dict(id='mqtt',version='Paho2.1.0 + NanoMQ0.25.6',license='Paho EPL-2.0 OR BSD-3-Clause; NanoMQ MIT',runtime='Python client + portable native Windows broker',serialization='opaque application payload',transport=['TCP device leg IPv4/IPv6'],security=['none','OpenSSL TLS1.2','OpenSSL TLS1.3'],metadata='topic, packet ID at QoS>0, properties at MQTT5, client ID',connections='CONNECT/CONNACK; TCP/TLS lifecycle; PING and DISCONNECT',delivery='QoS0/1/2 measured; broker acknowledgment is not durable application commit',limitations='TLS explicitly terminates at local OpenSSL proxy; observer leg excluded; anonymous publisher; persistent-session recovery/resumption not covered',sources=['mqtt-311','mqtt-5','paho-python','nanomq']),
      dict(id='coap-oscore',version=md.version('aiocoap'),license='MIT AND BSD-3-Clause',runtime='Python aiocoap',serialization=['CBOR','JSON','Protobuf'],transport=['UDP IPv4','UDP IPv6'],security=['none','OSCORE CCM8','OSCORE CCM16','OSCORE ChaCha20/Poly1305'],metadata='token, MID, URI/content-format/options; OSCORE KID/PartialIV',connections='preprovisioned OSCORE context; no EDHOC',delivery='CON piggybackACK and NON response; high-level blockwise/Observe and impairment separately',limitations='high-volume harness uses real low-level codec/security with local resource wrapper; native DTLS dependency not used on Windows',sources=['coap-rfc','oscore-rfc','aiocoap']),
      dict(id='coap-dtls',version='Californium/Scandium4.0.0-M6',license='EPL-2.0 OR BSD-3-Clause',runtime='Java21; bundled Leshan dependencies',serialization=['Protobuf','JSON','CBOR'],transport=['UDP IPv4'],security=['DTLS1.2 PSK CCM8','DTLS1.2 PSK CCM16'],metadata='CoAP options plus DTLS records/PSK identity',connections='actual DTLS handshake retained with labeled warmup',delivery='CON/NON echo returns entire payload',limitations='large blockwise integration timeout; DTLS tamper/replay negatives and DTLS1.3 untested',sources=['coap-rfc','dtls12-rfc','californium']),
      dict(id='lwm2m',version='Leshan2.0.0-M18',license='EPL-2.0 OR BSD-3-Clause; transitive dependencies have own licenses',runtime='Java21',serialization=['TLV','LwM2M JSON','SenML JSON','SenML CBOR','single-resource text/opaque'],transport=['CoAP/UDP IPv4'],security=['NoSec','DTLS1.2 PSK'],metadata='endpoint; Security/Server/Device objects; object/instance/resource IDs and registration',connections='actual registration/update; reuse DTLS security association',delivery='server Read plus native Send SenMLJSON/CBOR; actual server acceptance, no DB guarantee',limitations='1.1 target; 1.2 not supported claim; no LwM2M Observe/firmware/bootstrap lifecycle measurement; flat adapter excludes repeated/nested resources',sources=['lwm2m11','leshan','leshan-features']),
      dict(id='https',version=platform.python_version()+' / '+ssl.OPENSSL_VERSION,license='Python PSF-2.0; OpenSSL Apache-2.0',runtime='Python HTTP1.1 endpoint + TLS proxy',serialization=['JSON compact/standard','gzip JSON'],transport=['TCP device leg IPv4/IPv6'],security=['TLS1.2','TLS1.3'],metadata='HTTP headers, path, content length/encoding and certificate identity',connections='fresh/persistent TLS; response and setup measured separately',delivery='HTTP200 after JSON decode; no database persistence',limitations='HTTP2/3, certificate-chain variants, mTLS and capture-level TCP totals not measured',sources=['http11-rfc','tls13-rfc'])]
    dump('references/implementations.json',implementations)

if __name__=='__main__':main()
