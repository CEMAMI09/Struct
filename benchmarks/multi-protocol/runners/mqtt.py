"""Paho + NanoMQ over actual TCP or certificate-verified OpenSSL TLS.
Counts publisher/broker leg; subscriber leg is separate and excluded explicitly.
TCP packetization, TCP ACKs and IP bytes cannot be inferred from stream reads.
"""
import collections,hashlib,json,pathlib,queue,ssl,subprocess,sys,tempfile,threading,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec
from local_network import Proxy,certificates,free_port,wait_port,tls_records
import paho.mqtt.client as mqtt

def main():
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))
    # All payload-size cases + representative boundaries/field counts/presets.
    selected=[c for c in cases if c.get('family') in ['reference','preset','payload-size','field-count','unicode','nested','array','optional'] or c['id'].startswith('random-00')]
    writer=Writer('mqtt',reset='--reset' in sys.argv);start=time.perf_counter()
    broker=ROOT/'work/multi-protocol/tools/nanomq/bin/nanomq.exe'
    with tempfile.TemporaryDirectory(prefix='struct-local-mqtt-') as tmp:
        tmp=pathlib.Path(tmp);port=free_port()
        config=tmp/'broker.conf';config.write_text(f'listeners.tcp {{ bind = "127.0.0.1:{port}" }}\nauth {{ allow_anonymous = true }}\nlog {{ to = [console] level = error }}\n')
        log=(tmp/'broker.log').open('w');process=subprocess.Popen([str(broker),'start','--conf',str(config),'-t','2','-T','4','-n','4'],stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
        active=[]
        try:
            wait_port(port)
            cert,key=certificates(tmp/'certs')
            for version in [mqtt.MQTTv311,mqtt.MQTTv5]:
                for tls in [None,'TLSv1.2','TLSv1.3']:
                    for net in ['IPv4','IPv6']:
                        for qos in [0,1,2]:
                            host='127.0.0.1' if net=='IPv4' else '::1'
                            terminator=None
                            if tls:
                                sctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);sctx.load_cert_chain(cert,key)
                                sctx.minimum_version=sctx.maximum_version=ssl.TLSVersion.TLSv1_2 if tls=='TLSv1.2' else ssl.TLSVersion.TLSv1_3
                                terminator=Proxy(('127.0.0.1',port),tls_context=sctx);active.append(terminator)
                            proxy=Proxy(terminator.address if tls else ('127.0.0.1',port),host=host);active.append(proxy)
                            received=queue.Queue();sub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='bench-observer',protocol=version)
                            subscribed=threading.Event();sub.on_subscribe=lambda *a:subscribed.set()
                            sub.on_message=lambda client,userdata,msg:received.put(bytes(msg.payload))
                            sub.connect('127.0.0.1',port);sub.loop_start();sub.subscribe('telemetry/#',qos=2)
                            assert subscribed.wait(5),'subscriber did not subscribe'
                            pub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='benchmark-publisher',protocol=version)
                            connected=threading.Event();pub.on_connect=lambda *a:connected.set()
                            if tls:
                                cctx=ssl.create_default_context(cafile=str(cert));cctx.minimum_version=cctx.maximum_version=sctx.minimum_version
                                pub.tls_set_context(cctx)
                            begin=time.perf_counter_ns();pub.connect(host,proxy.address[1],keepalive=30);pub.loop_start()
                            assert connected.wait(5),'publisher did not connect'
                            time.sleep(.02);handshake=proxy.bytes();handshake_plain=terminator.bytes() if tls else handshake
                            connection_ns=time.perf_counter_ns()-begin
                            for case in selected:
                                for name in ['protobuf','json-compact','cbor-canonical','cbor-array','json-array']:
                                    try: codec=Codec(name,case)
                                    except NotImplementedError: continue
                                    for batch in ([1,2,5,10,25,50,100] if case.get('family')=='reference' else [1]):
                                        variations=[('telemetry/t',False)]
                                        if case['id']=='esp32-original' and batch==1:
                                            variations += [('telemetry/device-0000000000000000000000000001/environment',True)]
                                        for topic,properties in variations:
                                            r=record(case,f'{name}+MQTT'+('+TLS' if tls else '+TCP'),'Paho Python + NanoMQ'+(' + Python/OpenSSL TLS terminator' if tls else ''),
                                              implementation_version='paho 2.1.0; NanoMQ 0.25.6; '+ssl.OPENSSL_VERSION,specification_version='MQTT 5.0' if version==mqtt.MQTTv5 else 'MQTT 3.1.1',
                                              security_enabled=bool(tls),security_configuration=tls,delivery_mode=f'QoS {qos}',batch_size=batch,
                                              network_type=net,connection_mode='persistent',protocol_specific_settings=dict(mqtt_version=int(version),qos=qos,topic=topic,properties=properties,client_id='benchmark-publisher',keepalive=30),
                                              comparison_scope='publisher/broker byte stream only; subscriber leg excluded; TCP/IP totals unknown',
                                              source_references=['mqtt-5','mqtt-311','paho-python','nanomq','tls13-rfc'],comparable=False)
                                            if r['test_id'] in writer.seen: continue
                                            try:
                                                data=codec.encode(batch);pstart=proxy.snapshot();tstart=terminator.snapshot() if tls else pstart
                                                props=None
                                                if properties and version==mqtt.MQTTv5:
                                                    from paho.mqtt.properties import Properties
                                                    from paho.mqtt.packettypes import PacketTypes
                                                    props=Properties(PacketTypes.PUBLISH);props.UserProperty=[('schema','environment-v1')];props.ContentType='application/octet-stream'
                                                t=time.perf_counter_ns();info=pub.publish(topic,data,qos=qos,properties=props)
                                                info.wait_for_publish(5);assert info.is_published()
                                                actual=received.get(timeout=5);assert actual==data
                                                decoded=codec.decode(actual,batch);errors=verify(case['values'] if batch==1 else [case['values']]*batch,decoded,.05 if case['precision_policy']!='lossless' else 0)
                                                time.sleep(.002);wire=proxy.bytes(pstart);plain=terminator.bytes(tstart) if tls else wire
                                                r.update(serialized_payload_bytes=len(data),application_uplink_bytes=len(plain['up']),application_downlink_bytes=len(plain['down']),
                                                  stream_uplink_bytes=len(wire['up']),stream_downlink_bytes=len(wire['down']),
                                                  handshake_bytes=len(handshake['up'])+len(handshake['down']),handshake_uplink_bytes=len(handshake['up']),handshake_downlink_bytes=len(handshake['down']),
                                                  handshake_scope='TLS plus MQTT CONNECT/CONNACK; TCP SYN/ACK absent',
                                                  connection_setup_latency_ns=connection_ns,host_publish_latency_ns=time.perf_counter_ns()-t,
                                                  decoding_verified=True,decoded_values=safe(decoded if batch==1 else decoded[:1]),decoded_readings_count=batch,precision_error=errors,
                                                  payload_sha256=hashlib.sha256(data).hexdigest(),security_verified=bool(tls),
                                                  delivery_guarantee='subscriber decoded; MQTT acknowledgment is broker acceptance, not database persistence',
                                                  measurement_provenance={'application':'measured plaintext relay','stream':'measured transparent relay','tcp_ip':'not_tested'},
                                                  observations={'uplink_stream_hex':wire['up'].hex(),'downlink_stream_hex':wire['down'].hex(),
                                                    'mqtt_uplink_hex':plain['up'].hex(),'mqtt_downlink_hex':plain['down'].hex(),
                                                    'connection_uplink_hex':handshake['up'].hex(),'connection_downlink_hex':handshake['down'].hex()},
                                                  tls_records={'up':tls_records(wire['up']),'down':tls_records(wire['down'])} if tls else None,
                                                  steady_stream_bytes_per_reading=(len(wire['up'])+len(wire['down']))/batch)
                                            except Exception as e: r.update(test_status='failed',reason=repr(e))
                                            writer.write(r)
                            pub.disconnect();pub.loop_stop();sub.disconnect();sub.loop_stop();proxy.close()
                            if terminator: terminator.close()
                            print('MQTT complete:',int(version),tls,net,qos,'records',writer.count,flush=True)
        finally:
            for proxy in active: proxy.close()
            process.terminate()
            try: process.wait(5)
            except subprocess.TimeoutExpired: process.kill();process.wait()
            log.close()
            if process.returncode and not writer.count: print((tmp/'broker.log').read_text()[-5000:])
    writer.close();print('MQTT records added:',writer.count,'seconds:',round(time.perf_counter()-start,2))
if __name__=='__main__': main()
