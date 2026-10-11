import json,pathlib,sys,subprocess,tempfile,time,threading,queue
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec
from lwm2m import DatagramProxy,JDK,JAR,CP,CLASSES
from local_network import free_port

def read(stream):
    while True:
        line=stream.readline()
        if not line:raise RuntimeError('Java endpoint exited')
        if line.startswith('BENCH:'):return json.loads(line[6:])

def main():
    CLASSES.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(JDK/'bin/javac.exe'),'-cp',str(JAR),'-d',str(CLASSES),str(BASE/'implementations/coap/BenchmarkDtls.java')],check=True)
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))
    selected=[c for c in cases if c.get('family') in ['reference','preset','payload-size','field-count','unicode','array','nested','optional']]
    writer=Writer('coap-dtls',reset=True)
    with tempfile.TemporaryDirectory(prefix='struct-local-dtls-') as tmp:
        for cipher in ['TLS_PSK_WITH_AES_128_CCM_8','TLS_PSK_WITH_AES_128_CCM']:
            port=free_port();proxy=DatagramProxy(('127.0.0.1',port));log=open(pathlib.Path(tmp)/'dtls.log','w')
            server=subprocess.Popen([str(JDK/'bin/java.exe'),'-cp',CP,'BenchmarkDtls','server',str(port),cipher],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
            client=None
            try:
                assert read(server.stdout)['ready']
                client=subprocess.Popen([str(JDK/'bin/java.exe'),'-cp',CP,'BenchmarkDtls','client','0',cipher,f'coaps://127.0.0.1:{proxy.port}/t'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
                assert read(client.stdout)['ready']
                # Establish security association with a labeled warmup, retaining its full traffic.
                client.stdin.write(json.dumps(dict(hex='00',format=42,con=True))+'\n');client.stdin.flush()
                assert read(client.stdout)['hex']=='00';assert read(server.stdout)['received_hex']=='00';time.sleep(.01)
                initial=list(proxy.events)
                for case in selected:
                    for name in ['protobuf','json-compact','cbor-canonical']:
                        try:codec=Codec(name,case)
                        except NotImplementedError:continue
                        for con in [False,True]:
                            for batch in ([1,2,5,10,25,50,100] if case.get('family')=='reference' else [1]):
                                data=codec.encode(batch);begin=len(proxy.events)
                                if len(data)>(2048 if con else 1024):
                                    r=record(case,name+'+CoAP+DTLS','Californium/Scandium',security_enabled=True,security_configuration=cipher,
                                      delivery_mode='CON 2.04 response' if con else 'NON 2.04 response',batch_size=batch,network_type='IPv4',connection_mode='established DTLS association',
                                      protocol_specific_settings=dict(content_format=name,resource='/t'),source_references=['coap-rfc','dtls12-rfc','californium'])
                                    r.update(test_status='unsupported',measurement_type='unsupported',reason='Chosen DTLS echo integration timed out for larger blockwise exchanges in pilot; bounded to 1024 B NON / 2048 B CON pending diagnosis. Plain UDP blockwise tested separately.',serialized_payload_bytes=len(data));writer.write(r);continue
                                client.stdin.write(json.dumps(dict(hex=data.hex(),format={'protobuf':42,'json-compact':50,'cbor-canonical':60}[name],con=con))+'\n');client.stdin.flush()
                                response=read(client.stdout);accepted=read(server.stdout)
                                assert bytes.fromhex(response['hex'])==data and bytes.fromhex(accepted['received_hex'])==data
                                decoded=codec.decode(bytes.fromhex(response['hex']),batch);errors=verify(case['values'] if batch==1 else [case['values']]*batch,decoded,.05 if case['precision_policy']!='lossless' else 0)
                                # Include asynchronously emitted separate-response ACKs.
                                # A quiet interval prevents attributing them to the next case.
                                until=time.monotonic()+.3
                                while time.monotonic()<until:
                                    time.sleep(.005)
                                    if proxy.events and time.perf_counter_ns()-proxy.events[-1][0]>=20000000:break
                                events=proxy.events[begin:]
                                r=record(case,name+'+CoAP+DTLS','Californium/Scandium',implementation_version='4.0.0-M6 (bundled with Leshan M18)',specification_version='CoAP RFC7252 / DTLS1.2 RFC6347',security_enabled=True,security_configuration=cipher,
                                  delivery_mode='CON 2.04 response' if con else 'NON 2.04 response',batch_size=batch,network_type='IPv4',connection_mode='established DTLS association',protocol_specific_settings=dict(content_format=name,resource='/t'),
                                  serialized_payload_bytes=len(data),decoding_verified=True,decoded_values=safe(decoded if batch==1 else decoded[:1]),decoded_readings_count=batch,precision_error=errors,host_exchange_latency_ns=response['latency_ns'],
                                  source_references=['coap-rfc','dtls12-rfc','californium'],comparison_scope='echo endpoint; response repeats payload; not database persistence',comparable=False)
                                udp_totals(r,[x[2] for x in events if x[1]=='up'],[x[2] for x in events if x[1]=='down'],'IPv4')
                                r.update(connection_observations=[dict(direction=x[1],hex=x[2].hex()) for x in initial],handshake_bytes=sum(len(x[2]) for x in initial),handshake_scope='DTLS handshake PLUS one-byte warmup exchange; raw datagrams allow separation',
                                  security_verified=True,tamper_test_status='not_tested',replay_test_status='not_tested',
                                  measurement_provenance={'application':'measured encrypted DTLS datagrams at loopback proxy','udp_ip':'specification_calculated'},actual_fragmentation='not captured; real Californium blockwise used where selected automatically')
                                writer.write(r)
            finally:
                if client:
                    try:client.communicate('quit\n',timeout=5)
                    except subprocess.TimeoutExpired:client.terminate();client.wait(5)
                try:server.communicate('quit\n',timeout=5)
                except subprocess.TimeoutExpired:server.terminate();server.wait(5)
                proxy.close();log.close()
    writer.close();print('CoAP DTLS records',writer.count)
if __name__=='__main__':main()
