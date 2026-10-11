"""Actual fresh MQTT sessions, amortization groups and idle PING traffic."""
import json,pathlib,queue,ssl,subprocess,sys,tempfile,threading,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec
from local_network import Proxy,certificates,free_port,wait_port
import paho.mqtt.client as mqtt

def main():
    case=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))[0]
    writer=Writer('mqtt-connections',reset=True);start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='struct-mqtt-sessions-') as tmp:
        tmp=pathlib.Path(tmp);port=free_port();conf=tmp/'broker.conf'
        conf.write_text(f'listeners.tcp {{ bind = "127.0.0.1:{port}" }}\nauth {{ allow_anonymous = true }}\nlog {{ to = [console] level = error }}\n')
        log=(tmp/'broker.log').open('w');broker=subprocess.Popen([str(ROOT/'work/multi-protocol/tools/nanomq/bin/nanomq.exe'),'start','--conf',str(conf),'-t','2','-T','4','-n','4'],stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
        try:
            wait_port(port);cert,key=certificates(tmp/'certs')
            for ver in [mqtt.MQTTv311,mqtt.MQTTv5]:
                received=queue.Queue();sub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='session-observer',protocol=ver)
                ready=threading.Event();sub.on_subscribe=lambda *a:ready.set();sub.on_message=lambda c,u,m:received.put(bytes(m.payload))
                sub.connect('127.0.0.1',port);sub.loop_start();sub.subscribe('t',2);assert ready.wait(5)
                for tls in [None,'TLSv1.2','TLSv1.3']:
                    terminator=None
                    if tls:
                        sc=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);sc.load_cert_chain(cert,key)
                        sc.minimum_version=sc.maximum_version=ssl.TLSVersion.TLSv1_2 if tls=='TLSv1.2' else ssl.TLSVersion.TLSv1_3
                        terminator=Proxy(('127.0.0.1',port),tls_context=sc)
                    for net in ['IPv4','IPv6']:
                        proxy=Proxy(terminator.address if tls else ('127.0.0.1',port),host='127.0.0.1' if net=='IPv4' else '::1')
                        for qos in [0,1,2]:
                            for n in [1,2,5,10,25,50,100]:
                                for name in ['protobuf','json-compact','cbor-canonical']:
                                    codec=Codec(name,case);data=codec.encode();ready=threading.Event()
                                    pub=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='session-benchmark',protocol=ver);pub.on_connect=lambda *a:ready.set()
                                    if tls:
                                        cc=ssl.create_default_context(cafile=str(cert));cc.minimum_version=cc.maximum_version=sc.minimum_version;pub.tls_set_context(cc)
                                    all_start=proxy.snapshot();plain_start=terminator.snapshot() if tls else all_start;t=time.perf_counter_ns()
                                    pub.connect(proxy.address[0],proxy.address[1],keepalive=1 if n==1 else 30);pub.loop_start();assert ready.wait(5)
                                    time.sleep(.005);setup_ns=time.perf_counter_ns()-t
                                    handshake=proxy.bytes(all_start);plain_h=terminator.bytes(plain_start) if tls else handshake
                                    data_start=proxy.snapshot();plain_data_start=terminator.snapshot() if tls else data_start
                                    latencies=[]
                                    for _ in range(n):
                                        t=time.perf_counter_ns();info=pub.publish('t',data,qos);info.wait_for_publish(5);assert info.is_published()
                                        actual=received.get(timeout=5);assert actual==data;verify(case['values'],codec.decode(actual));latencies.append(time.perf_counter_ns()-t)
                                    time.sleep(.002);traffic=proxy.bytes(data_start);plain=terminator.bytes(plain_data_start) if tls else traffic
                                    maintenance_start=proxy.snapshot()
                                    idle=ver==mqtt.MQTTv5 and qos==0 and n==1 and name=='protobuf' and net=='IPv4'
                                    if idle:time.sleep(2.2)
                                    maintenance=proxy.bytes(maintenance_start);close_start=proxy.snapshot()
                                    pub.disconnect();pub.loop_stop();time.sleep(.005);termination=proxy.bytes(close_start);all_bytes=proxy.bytes(all_start)
                                    r=record(case,f'{name}+MQTT'+('+TLS' if tls else '+TCP'),'Paho Python + NanoMQ'+(' + OpenSSL TLS terminator' if tls else ''),implementation_version='2.1.0 / 0.25.6',
                                      specification_version='MQTT 5.0' if ver==mqtt.MQTTv5 else 'MQTT 3.1.1',security_enabled=bool(tls),security_configuration=tls,
                                      delivery_mode=f'QoS {qos}',network_type=net,connection_mode='new connection per message' if n==1 else f'connection reused for {n} readings',
                                      protocol_specific_settings=dict(mqtt_version=int(ver),qos=qos,readings_per_connection=n,topic='t',idle_seconds=2.2 if idle else 0,keepalive=1 if n==1 else 30),
                                      serialized_payload_bytes=len(data),application_uplink_bytes=len(plain['up']),application_downlink_bytes=len(plain['down']),decoding_verified=True,decoded_values=case['values'],precision_error=verify(case['values'],codec.decode(data)),
                                      source_references=['mqtt-5','mqtt-311','paho-python','nanomq','tls13-rfc'],comparison_scope='publisher/broker session streams; TCP packets and observer leg excluded')
                                    r.update(logical_readings=n,stream_uplink_bytes=len(traffic['up']),stream_downlink_bytes=len(traffic['down']),
                                      handshake_bytes=sum(map(len,handshake.values())),maintenance_bytes=sum(map(len,maintenance.values())),termination_bytes=sum(map(len,termination.values())),
                                      total_session_stream_bytes=sum(map(len,all_bytes.values())),amortized_session_stream_bytes_per_reading=sum(map(len,all_bytes.values()))/n,
                                      connection_setup_latency_ns=setup_ns,publish_latency_raw_ns=latencies,
                                      observations={label:{d:b.hex() for d,b in values.items()} for label,values in [('handshake',handshake),('publish',traffic),('maintenance',maintenance),('termination',termination)]},
                                      measurement_provenance=dict(application='measured MQTT plaintext relay',session='measured complete socket streams; no TCP handshake/ACK/FIN',tcp_ip='not_tested'))
                                    writer.write(r)
                        proxy.close()
                    if terminator:terminator.close()
                sub.disconnect();sub.loop_stop()
        finally:
            broker.terminate();broker.wait(5);log.close()
    writer.close();print('MQTT session records',writer.count,'seconds',round(time.perf_counter()-start,2))
if __name__=='__main__':main()
