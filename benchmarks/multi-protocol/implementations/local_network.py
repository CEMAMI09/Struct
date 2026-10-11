"""Loopback stream instrumentation. recv chunks are NOT TCP packets."""
import datetime,ipaddress,pathlib,select,socket,ssl,threading,time
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import ec

def certificates(directory):
    directory=pathlib.Path(directory);directory.mkdir(parents=True,exist_ok=True)
    key=ec.generate_private_key(ec.SECP256R1()); name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Struct local benchmark only')])
    now=datetime.datetime.now(datetime.timezone.utc)
    cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
      .not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1))
      .add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True)
      .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1')),x509.IPAddress(ipaddress.ip_address('::1'))]),critical=False)
      .sign(key,hashes.SHA256()))
    (directory/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (directory/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    return directory/'cert.pem',directory/'key.pem'

class Proxy:
    def __init__(self,target,host='127.0.0.1',tls_context=None):
        self.target=target;self.tls_context=tls_context;self.events=[];self.running=True;self.sockets=[];self.threads=[]
        self.mutator=None
        self.listener=socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET,socket.SOCK_STREAM)
        self.listener.bind((host,0));self.listener.listen();self.listener.settimeout(.2)
        self.address=self.listener.getsockname()[:2]
        self.thread=threading.Thread(target=self.accept,daemon=True);self.thread.start()
    def accept(self):
        while self.running:
            try: client,_=self.listener.accept()
            except (TimeoutError,OSError): continue
            t=threading.Thread(target=self.relay,args=(client,),daemon=True);t.start();self.threads.append(t)
    def relay(self,client):
        server=None
        try:
            if self.tls_context: client=self.tls_context.wrap_socket(client,server_side=True)
            server=socket.create_connection(self.target,timeout=3);client.setblocking(False);server.setblocking(False)
            self.sockets += [client,server]
            while self.running:
                ready,_,_=select.select([client,server],[],[],.1)
                for source in ready:
                    try: data=source.recv(262144)
                    except (ssl.SSLWantReadError,BlockingIOError): continue
                    if not data: return
                    direction='up' if source is client else 'down'
                    self.events.append((time.perf_counter_ns(),direction,data))
                    target=server if source is client else client
                    forwarded=self.mutator(data,direction) if self.mutator else data
                    target.setblocking(True);target.sendall(forwarded);target.setblocking(False)
        except (OSError,ssl.SSLError): pass
        finally:
            client.close()
            if server: server.close()
    def snapshot(self): return len(self.events)
    def bytes(self,start=0,end=None):
        events=self.events[start:end]
        return {direction:b''.join(x[2] for x in events if x[1]==direction) for direction in ['up','down']}
    def close(self):
        self.running=False;self.listener.close()
        for s in self.sockets:
            try: s.shutdown(socket.SHUT_RDWR);s.close()
            except OSError: pass
        self.thread.join(1)
        for t in self.threads: t.join(1)

_allocated_ports=set()
def free_port(host='127.0.0.1'):
    # Windows may immediately hand the same ephemeral port back after close.
    # Keep simultaneous reservations until a distinct port is selected.
    held=[]
    try:
        while True:
            s=socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET);held.append(s)
            s.bind((host,0));port=s.getsockname()[1]
            if port not in _allocated_ports:
                _allocated_ports.add(port);return port
    finally:
        for s in held:s.close()

def wait_port(port,host='127.0.0.1',timeout=10):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            with socket.create_connection((host,port),timeout=.2): return
        except OSError: time.sleep(.05)
    raise TimeoutError('Local service not listening: '+str(port))

def tls_records(data):
    result=[];offset=0
    while offset+5<=len(data):
        length=int.from_bytes(data[offset+3:offset+5],'big')
        if offset+5+length>len(data): break
        result.append(dict(type=data[offset],legacy_version=data[offset+1:offset+3].hex(),record_bytes=5+length))
        offset+=5+length
    return dict(records=result,unparsed_bytes=len(data)-offset)
