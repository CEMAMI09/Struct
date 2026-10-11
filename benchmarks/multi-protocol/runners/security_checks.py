"""Actual OpenSSL bad-certificate and ciphertext-tamper rejection checks."""
import json,pathlib,queue,socket,ssl,sys,tempfile,threading,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from local_network import Proxy,certificates

def main():
    results=[]
    with tempfile.TemporaryDirectory(prefix='struct-tls-negative-') as tmp:
        cert,key=certificates(pathlib.Path(tmp)/'server');wrong,_=certificates(pathlib.Path(tmp)/'wrong')
        for version in [ssl.TLSVersion.TLSv1_2,ssl.TLSVersion.TLSv1_3]:
            server_ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);server_ctx.load_cert_chain(cert,key)
            server_ctx.minimum_version=server_ctx.maximum_version=version
            listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(.2)
            accepted=[];errors=[];running=True
            def serve():
                while running:
                    try:raw,_=listener.accept()
                    except (TimeoutError,OSError):continue
                    try:
                        with server_ctx.wrap_socket(raw,server_side=True) as conn:
                            conn.settimeout(2)
                            while True:
                                b=conn.recv(1000)
                                if not b:break
                                accepted.append(b);conn.sendall(b)
                    except (ssl.SSLError,OSError) as e:errors.append(str(e))
            worker=threading.Thread(target=serve,daemon=True);worker.start()
            proxy=Proxy(listener.getsockname())
            try:
                badctx=ssl.create_default_context(cafile=str(wrong));badctx.minimum_version=badctx.maximum_version=version
                rejected=False
                try:
                    with badctx.wrap_socket(socket.create_connection(proxy.address),server_hostname='localhost'):pass
                except ssl.SSLCertVerificationError:rejected=True
                assert rejected
                ctx=ssl.create_default_context(cafile=str(cert));ctx.minimum_version=ctx.maximum_version=version
                with ctx.wrap_socket(socket.create_connection(proxy.address),server_hostname='localhost') as conn:
                    conn.settimeout(2);conn.sendall(b'valid');assert conn.recv(1000)==b'valid'
                    modified=[]
                    def mutate(data,direction):
                        if direction=='up' and not modified:
                            bad=data[:-1]+bytes([data[-1]^1]);modified.append(dict(original_hex=data.hex(),tampered_hex=bad.hex()));return bad
                        return data
                    proxy.mutator=mutate;conn.sendall(b'tampered-must-not-arrive')
                    rejection=False
                    try:rejection=conn.recv(1000)==b''
                    except (ssl.SSLError,ConnectionError):rejection=True
                    time.sleep(.02)
                    assert modified and rejection and accepted==[b'valid'],(modified,rejection,accepted)
                    results.append(dict(tls_version=version.name,openssl=ssl.OPENSSL_VERSION,bad_certificate_rejected=True,
                      tampered_ciphertext_rejected=True,accepted_plaintext_hex=[b.hex() for b in accepted],mutations=modified,server_errors=errors,
                      scope='actual same OpenSSL TLS library used by MQTT/HTTPS terminator; isolated echo channel negative test'))
            finally:
                running=False;proxy.close();listener.close();worker.join(3)
    dump('results/raw/tls-negative-tests.json',results);print('TLS negative configurations verified',len(results))
if __name__=='__main__':main()
