"""Actual Leshan codecs plus an isolated real Leshan client/server pilot."""
import json,pathlib,sys,subprocess,tempfile,time,urllib.request,socket,threading,select
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import transform
from local_network import free_port,wait_port

TOOLS=ROOT/'work/multi-protocol/tools'
JDK=next(TOOLS.glob('jdk*'))
JAR=TOOLS/'leshan-demo-client-2.0.0-M18-jar-with-dependencies.jar'
CLASSES=ROOT/'work/multi-protocol/classes'
CP=str(CLASSES)+os.pathsep+str(JAR)

def compile_java():
    CLASSES.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(JDK/'bin/javac.exe'),'-cp',str(JAR),'-d',str(CLASSES),str(BASE/'implementations/lwm2m/BenchmarkLwm2m.java')],check=True)

def codecs():
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))
    input=[]
    for c in cases:
        cc=dict(c)
        try: cc['transformed_values']=transform(c['fields'],c['values'])
        except Exception: cc['transformed_values']=c['values']
        input.append(cc)
    dump('results/raw/lwm2m-codec-input.json',input)
    raw=BASE/'results/raw/lwm2m-java.ndjson'
    subprocess.run([str(JDK/'bin/java.exe'),'-cp',CP,'BenchmarkLwm2m','codecs',str(BASE/'results/raw/lwm2m-codec-input.json'),str(raw)],check=True,timeout=90)
    by_id={c['id']:c for c in cases};writer=Writer('lwm2m-codecs',reset=True)
    for line in raw.read_text(encoding='utf8').splitlines():
        result=json.loads(line);case=by_id[result['schema_id']]
        r=record(case,'LwM2M '+result['format']+' serialization','Eclipse Leshan',implementation_version='2.0.0-M18',
          specification_version='LwM2M 1.1',protocol_specific_settings=dict(content_format=result['content_format'],object_id=33000,instance_id=0,resource_ids='sequential from 0'),
          source_references=['leshan','lwm2m11','senml-rfc'],test_status=result['status'])
        if result['status']=='passed':
            try:
                decoded=transform(case['fields'],restore(result['decoded']),True)
                errors=verify(case['values'],decoded,.05 if case['precision_policy']!='lossless' else 0)
                r.update(serialized_payload_bytes=result['bytes'],decoded_values=safe(decoded),precision_error=errors,decoding_verified=True,
                  payload_hex=result['hex'],measurement_provenance={'serialization':'measured real Leshan encoder/decoder'},
                  performance={'serialization_raw_ns':result['encode_ns'],'deserialization_raw_ns':result['decode_ns'],'scope':'host JVM; 20 warmups, 100 samples'})
            except Exception as e:r.update(test_status='failed',reason=repr(e))
        else:r.update(reason=result['reason'],measurement_type='unsupported' if result['status']=='unsupported' else 'measured')
        writer.write(r)
    writer.close();print('LwM2M codec records',writer.count,flush=True)

class DatagramProxy:
    def __init__(self,target):
        self.target=target;self.client=None;self.events=[];self.running=True
        self.socket=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self.socket.bind(('127.0.0.1',0));self.socket.settimeout(.1)
        self.port=self.socket.getsockname()[1];self.thread=threading.Thread(target=self.run,daemon=True);self.thread.start()
    def run(self):
        while self.running:
            try:data,remote=self.socket.recvfrom(65535)
            except (TimeoutError,OSError):continue
            if remote==self.target:
                direction='down';destination=self.client
            else:direction='up';self.client=remote;destination=self.target
            self.events.append((time.perf_counter_ns(),direction,data))
            if destination:
                try:self.socket.sendto(data,destination)
                except OSError:pass
    def close(self):self.running=False;self.socket.close();self.thread.join(1)

def http(url,data=None,method=None):
    req=urllib.request.Request(url,json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=8) as response:
        b=response.read();return json.loads(b) if b else None

def network():
    writer=Writer('lwm2m-network',reset=True)
    case=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))[0]
    with tempfile.TemporaryDirectory(prefix='struct-local-leshan-') as directory:
        directory=pathlib.Path(directory);models=directory/'models';models.mkdir()
        xml='''<?xml version="1.0" encoding="utf-8"?><LWM2M xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://openmobilealliance.org/tech/profiles/LWM2M.xsd"><Object ObjectType="MODefinition"><Name>LocalBenchmark</Name><Description1>Local test only</Description1><ObjectID>33000</ObjectID><ObjectURN>urn:oma:lwm2m:x:33000</ObjectURN><MultipleInstances>Single</MultipleInstances><Mandatory>Optional</Mandatory><Resources>'''
        for i,(name,t) in enumerate([('temp','Float'),('humidity','Float'),('is_active','Boolean')]):
            xml+=f'<Item ID="{i}"><Name>{name}</Name><Operations>RW</Operations><MultipleInstances>Single</MultipleInstances><Mandatory>Optional</Mandatory><Type>{t}</Type><RangeEnumeration></RangeEnumeration><Units></Units><Description>Benchmark</Description></Item>'
        xml+='</Resources><Description2></Description2></Object></LWM2M>'
        (models/'33000.xml').write_text(xml)
        coapport,dtlsport,webport=[free_port() for _ in range(3)]
        slog=(directory/'server.log').open('w')
        # M18 demo uses the TCP port for TLS when an explicit TLS address is set.
        # A second LOOPBACK address avoids that upstream demo collision.
        server=subprocess.Popen([str(JDK/'bin/java.exe'),'-jar',str(TOOLS/'leshan-demo-server-2.0.0-M18-jar-with-dependencies.jar'),'-lh','127.0.0.1','-lp',str(coapport),'-slh','127.0.0.1','-slp',str(dtlsport),'-wh','127.0.0.1','-wp',str(webport),'-jh','127.0.0.1','-jp',str(free_port()),'-th','127.0.0.1','-tp',str(free_port()),'-tsh','127.0.0.2','-tsp',str(free_port()),'-m',str(models)],cwd=directory,stdout=slog,stderr=slog,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
        baseurl=f'http://127.0.0.1:{webport}/api'
        try:
            wait_port(webport,timeout=15)
            for secure in [False,True]:
                endpoint='benchmark-secure' if secure else 'benchmark-plain';proxy=DatagramProxy(('127.0.0.1',dtlsport if secure else coapport));clog=(directory/(endpoint+'.log')).open('w')
                client=None
                try:
                    if secure:http(baseurl+'/security/clients',dict(endpoint=endpoint,tls={'mode':'psk','details':{'identity':'benchmark-psk','key':'00112233445566778899aabbccddeeff'}}),method='PUT')
                    client=subprocess.Popen([str(JDK/'bin/java.exe'),'-cp',CP,'BenchmarkLwm2m','client',f'{"coaps" if secure else "coap"}://127.0.0.1:{proxy.port}',endpoint],cwd=directory,stdin=subprocess.PIPE,stdout=clog,stderr=clog,text=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
                    deadline=time.monotonic()+12
                    while time.monotonic()<deadline:
                        registrations=http(baseurl+'/clients')
                        if any(x.get('endpoint')==endpoint for x in registrations):break
                        time.sleep(.1)
                    else:raise TimeoutError('Leshan registration failed; '+(directory/(endpoint+'.log')).read_text()[-1800:])
                    initial=list(proxy.events)
                    registration=record(case,'LwM2M+CoAP'+('+DTLS' if secure else '+UDP'),'Eclipse Leshan + Californium/Scandium',implementation_version='2.0.0-M18',specification_version='LwM2M 1.1',security_enabled=secure,security_configuration='DTLS 1.2 PSK' if secure else None,network_type='IPv4',connection_mode='new registration',delivery_mode='Register 2.01 Created',source_references=['leshan','lwm2m11'],decoding_verified=True,comparison_scope='registration operation, not a sensor reading')
                    udp_totals(registration,[x[2] for x in initial if x[1]=='up'],[x[2] for x in initial if x[1]=='down'],'IPv4')
                    registration['registration_verified_by_server']=True;registration['registered_endpoint']=endpoint;writer.write(registration)
                    for content in ['TLV','SENML_JSON','SENML_CBOR','JSON']:
                        begin=len(proxy.events);t=time.perf_counter_ns()
                        result=http(baseurl+f'/clients/{endpoint}/33000/0?format={content}')
                        time.sleep(.03);events=proxy.events[begin:]
                        r=record(case,'LwM2M+CoAP'+('+DTLS' if secure else '+UDP'),'Eclipse Leshan + Californium/Scandium',implementation_version='2.0.0-M18',specification_version='LwM2M 1.1',
                          security_enabled=secure,security_configuration='DTLS 1.2 PSK' if secure else None,delivery_mode='server Read request / response',network_type='IPv4',connection_mode='registered; reused security association',
                          protocol_specific_settings=dict(content_format=content,object_id=33000,instance_id=0,resource_ids=[0,1,2]),source_references=['leshan','lwm2m11','dtls12-rfc'],comparison_scope='LwM2M server-initiated Read, not unsolicited push',comparable=False)
                        r['server_response']=result;r['host_exchange_latency_ns']=time.perf_counter_ns()-t
                        assert result['status'].startswith('CONTENT') and result['success'],result
                        resources=result['content']['resources'];decoded={['temp','humidity','is_active'][int(x['id'])]:float(x['value']) if x['type']=='FLOAT' else x['value'] for x in resources}
                        r.update(decoded_values=decoded,precision_error=verify(case['values'],decoded),decoding_verified=True,
                          handshake_bytes=sum(len(x[2]) for x in initial),handshake_scope='registration plus DTLS handshake combined; separate raw datagrams retained',
                          connection_observations=[dict(direction=x[1],hex=x[2].hex()) for x in initial])
                        udp_totals(r,[x[2] for x in events if x[1]=='up'],[x[2] for x in events if x[1]=='down'],'IPv4')
                        r['measurement_provenance']['application']='measured UDP datagram contents; includes DTLS record framing when secure'
                        writer.write(r)
                    for fmt in ['SENML_JSON','SENML_CBOR']:
                        time.sleep(.03)
                        begin=len(proxy.events);log_before=(directory/(endpoint+'.log')).stat().st_size
                        client.stdin.write('send '+fmt+'\n');client.stdin.flush()
                        deadline=time.monotonic()+6
                        while time.monotonic()<deadline:
                            # stat().st_size is a BYTE offset. Text-mode CRLF translation
                            # changes character offsets on Windows and can hide the marker,
                            # causing a false six-second wait and unrelated periodic updates.
                            text=(directory/(endpoint+'.log')).read_bytes()[log_before:].decode('utf8',errors='replace')
                            if 'BENCHMARK_SEND_RESULT:' in text:break
                            time.sleep(.02)
                        assert 'BENCHMARK_SEND_RESULT:' in text and 'CHANGED' in text,text
                        time.sleep(.03) # include any separate-response ACK before the next operation
                        events=proxy.events[begin:]
                        send=record(case,'LwM2M+CoAP'+('+DTLS' if secure else '+UDP'),'Eclipse Leshan + Californium/Scandium',implementation_version='2.0.0-M18',specification_version='LwM2M 1.1',security_enabled=secure,security_configuration='DTLS 1.2 PSK' if secure else None,network_type='IPv4',connection_mode='registered',delivery_mode='Send 2.04 Changed',protocol_specific_settings={'content_format':fmt},source_references=['leshan','lwm2m11'],decoding_verified=True,decoded_values=case['values'],comparison_scope='native Send from same validated client resources; server accepted decoded LwM2M content; no database persistence')
                        udp_totals(send,[x[2] for x in events if x[1]=='up'],[x[2] for x in events if x[1]=='down'],'IPv4');send['server_acceptance']=text;send['decode_evidence']='same resources independently read/verified above; real Leshan Send decoder returned 2.04';writer.write(send)
                    begin=len(proxy.events);client.stdin.write('update\n');client.stdin.flush();time.sleep(.4)
                    events=proxy.events[begin:]
                    dump(f'results/raw/lwm2m-{endpoint}-update.json',[dict(direction=x[1],hex=x[2].hex()) for x in events])
                    update=record(case,'LwM2M+CoAP'+('+DTLS' if secure else '+UDP'),'Eclipse Leshan + Californium/Scandium',implementation_version='2.0.0-M18',specification_version='LwM2M 1.1',security_enabled=secure,security_configuration='DTLS 1.2 PSK' if secure else None,network_type='IPv4',connection_mode='registered',delivery_mode='Update registration',source_references=['leshan','lwm2m11'],decoding_verified=True,comparison_scope='registration update, not a sensor reading')
                    assert events and any(x['direction' if isinstance(x,dict) else 1]=='down' for x in events)
                    udp_totals(update,[x[2] for x in events if x[1]=='up'],[x[2] for x in events if x[1]=='down'],'IPv4');writer.write(update)
                except Exception as e:
                    r=record(case,'LwM2M+CoAP'+('+DTLS' if secure else '+UDP'),'Eclipse Leshan',security_enabled=secure,security_configuration='DTLS 1.2 PSK' if secure else None,network_type='IPv4')
                    r.update(test_status='failed',reason=repr(e),server_log=(directory/'server.log').read_text()[-3000:]);writer.write(r);print('Leshan pilot:',repr(e),flush=True)
                finally:
                    if client:
                        try:client.communicate('quit\n',timeout=4)
                        except subprocess.TimeoutExpired:client.terminate();client.wait(4)
                    dump(f'results/raw/lwm2m-{endpoint}-diagnostics.json',{'log':(directory/(endpoint+'.log')).read_text(errors='replace'),
                      'datagrams':[dict(timestamp_ns=x[0],direction=x[1],hex=x[2].hex()) for x in proxy.events]})
                    proxy.close();clog.close()
        finally:
            server.terminate();server.wait(5);slog.close()
            dump('results/raw/lwm2m-server-diagnostics.json',{'log':(directory/'server.log').read_text(errors='replace')})
    writer.close();print('LwM2M network records',writer.count,flush=True)

if __name__=='__main__':
    compile_java()
    if '--network-only' not in sys.argv:codecs()
    network()
