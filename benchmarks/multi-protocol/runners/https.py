"""Real JSON HTTP/1.1 over verified TLS, with request/response stream accounting."""
import gzip,hashlib,http.client,http.server,json,pathlib,ssl,sys,tempfile,threading,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec
from local_network import Proxy,certificates,tls_records

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_POST(self):
        raw=self.rfile.read(int(self.headers['Content-Length']))
        plain=gzip.decompress(raw) if self.headers.get('Content-Encoding')=='gzip' else raw
        json.loads(plain);self.server.observed=plain
        body=json.dumps({'sha256':hashlib.sha256(plain).hexdigest()},separators=(',',':')).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);self.wfile.flush()

def main():
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))
    selected=[c for c in cases if c.get('family') in ['reference','preset','payload-size','compression','field-count','unicode','nested','optional']]
    writer=Writer('https',reset='--reset' in sys.argv);start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='struct-local-https-') as tmp:
        cert,key=certificates(tmp)
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            for tls in ['TLSv1.2','TLSv1.3']:
                ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key)
                ctx.minimum_version=ctx.maximum_version=ssl.TLSVersion.TLSv1_2 if tls=='TLSv1.2' else ssl.TLSVersion.TLSv1_3
                terminator=Proxy(server.server_address,tls_context=ctx)
                for net in ['IPv4','IPv6']:
                    proxy=Proxy(terminator.address,host='127.0.0.1' if net=='IPv4' else '::1')
                    for mode in ['persistent','new connection per message']:
                        cctx=ssl.create_default_context(cafile=str(cert));cctx.minimum_version=cctx.maximum_version=ctx.minimum_version
                        conn=None
                        for case in selected if mode=='persistent' else selected[:2]+[c for c in selected if c['id'] in ['ascii-1024','ascii-16384']]:
                            for name in ['json-compact','json-standard']:
                                codec=Codec(name,case)
                                for compressed in [False,True]:
                                    for batch in ([1,2,5,10,25,50,100] if case.get('family')=='reference' and mode=='persistent' else [1]):
                                        r=record(case,name+'+HTTPS/TLS','Python HTTP/1.1 + OpenSSL',implementation_version=platform.python_version()+'; '+ssl.OPENSSL_VERSION,
                                          specification_version='HTTP/1.1 RFC9112; '+tls,security_enabled=True,security_configuration=tls,delivery_mode='HTTP 200 after JSON decode',
                                          batch_size=batch,network_type=net,connection_mode=mode,protocol_specific_settings=dict(content_encoding='gzip' if compressed else 'identity',path='/telemetry'),
                                          comparison_scope='HTTP plaintext and TLS streams; TCP/IP unknown',source_references=['http11-rfc','tls13-rfc','json-rfc'])
                                        if r['test_id'] in writer.seen:continue
                                        try:
                                            fresh=conn is None or mode!='persistent'
                                            if fresh:
                                                hs=proxy.snapshot();ht=terminator.snapshot();begin=time.perf_counter_ns()
                                                conn=http.client.HTTPSConnection(proxy.address[0],proxy.address[1],context=cctx,timeout=5);conn.connect();time.sleep(.01)
                                                handshake=proxy.bytes(hs);setup_ns=time.perf_counter_ns()-begin
                                            data=codec.encode(batch);body=gzip.compress(data,mtime=0) if compressed else data
                                            before=proxy.snapshot();p_before=terminator.snapshot();begin=time.perf_counter_ns()
                                            headers={'Content-Type':'application/json','Content-Length':str(len(body))}
                                            if compressed:headers['Content-Encoding']='gzip'
                                            conn.request('POST','/telemetry',body,headers);response=conn.getresponse();reply=response.read()
                                            assert response.status==200 and json.loads(reply)['sha256']==hashlib.sha256(data).hexdigest()
                                            assert server.observed==data
                                            decoded=codec.decode(server.observed,batch);errors=verify(case['values'] if batch==1 else [case['values']]*batch,decoded,.05 if case['precision_policy']!='lossless' else 0)
                                            time.sleep(.002);wire=proxy.bytes(before);plain=terminator.bytes(p_before)
                                            r.update(serialized_payload_bytes=len(data),compressed_payload_bytes=len(body),application_uplink_bytes=len(plain['up']),application_downlink_bytes=len(plain['down']),
                                              stream_uplink_bytes=len(wire['up']),stream_downlink_bytes=len(wire['down']),handshake_bytes=sum(map(len,handshake.values())),
                                              handshake_uplink_bytes=len(handshake['up']),handshake_downlink_bytes=len(handshake['down']),
                                              connection_setup_latency_ns=setup_ns,host_exchange_latency_ns=time.perf_counter_ns()-begin,
                                              handshake_scope='TLS records only; TCP connection packets absent',decoding_verified=True,decoded_values=safe(decoded if batch==1 else decoded[:1]),
                                              decoded_readings_count=batch,precision_error=errors,security_verified=True,
                                              observations=dict(uplink_stream_hex=wire['up'].hex(),downlink_stream_hex=wire['down'].hex(),http_uplink_hex=plain['up'].hex(),http_downlink_hex=plain['down'].hex(),
                                                connection_uplink_hex=handshake['up'].hex(),connection_downlink_hex=handshake['down'].hex()),
                                              measurement_provenance=dict(application='measured HTTP relay',stream='measured TLS relay',tcp_ip='not_tested'),
                                              steady_stream_bytes_per_reading=sum(map(len,wire.values()))/batch)
                                        except Exception as e:r.update(test_status='failed',reason=repr(e))
                                        writer.write(r)
                                        if conn and mode!='persistent':conn.close();conn=None
                        if conn:conn.close()
                    proxy.close()
                terminator.close()
        finally:server.shutdown();server.server_close();thread.join(2)
    writer.close();print('HTTPS records',writer.count,'seconds',round(time.perf_counter()-start,2))
if __name__=='__main__':main()
