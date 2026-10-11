"""Shared record contract. Unknown measurements are null, never zero."""
import datetime, gzip, hashlib, json, math, os, pathlib, platform, subprocess, sys, time

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
VERSION = '1.0.0'
ENV = dict(os=platform.platform(), python=sys.version, machine=platform.machine(),
           processor=platform.processor(), performance_scope='host computer, not ESP32',
           packet_capture=False, seed=20261010)
try: ENV['git_commit'] = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
except Exception: ENV['git_commit'] = None

def safe(v):
    if isinstance(v, bytes): return {'$bytes': v.hex()}
    if isinstance(v, int) and abs(v) > 9007199254740991: return {'$integer': str(v)}
    if isinstance(v, dict): return {k:safe(x) for k,x in v.items()}
    if isinstance(v, (list,tuple)): return [safe(x) for x in v]
    return v

def restore(v):
    if isinstance(v,dict):
        if set(v)=={'$bytes'}: return bytes.fromhex(v['$bytes'])
        if set(v)=={'$integer'}: return int(v['$integer'])
        return {k:restore(x) for k,x in v.items()}
    if isinstance(v,list): return [restore(x) for x in v]
    return v

def dump(path,value):
    path=BASE/path; path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(safe(value),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

def record(case,stack,implementation,**settings):
    r=dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),benchmark_version=VERSION,
      protocol_category=stack.split('+')[0],protocol_stack=stack,implementation=implementation,
      implementation_version=None,specification_version=None,schema_id=case['id'],
      schema_definition=case['fields'],sample_values=safe(case['values']),precision_policy=case['precision_policy'],
      security_enabled=False,security_configuration=None,delivery_mode='none',batch_size=1,
      network_type='none',connection_mode='none',protocol_specific_settings={},
      serialized_payload_bytes=None,application_uplink_bytes=None,transport_header_bytes=None,
      network_header_bytes=None,total_uplink_bytes=None,application_downlink_bytes=None,
      total_downlink_bytes=None,handshake_bytes=None,maintenance_bytes=None,retransmission_bytes=None,
      total_network_bytes=None,effective_bytes_per_reading=None,decoding_verified=False,
      precision_error=None,measurement_type='measured',test_status='passed',source_references=[],
      environment_metadata=ENV,comparable=False,comparison_scope='serialization only',
      measurement_provenance={},decoded_values=None)
    r.update(settings)
    identity={k:r[k] for k in ('benchmark_version','protocol_stack','implementation','schema_id',
      'security_configuration','delivery_mode','batch_size','network_type','connection_mode','protocol_specific_settings')}
    r['test_id']=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()[:24]
    return r

class Writer:
    def __init__(self,name,reset=False):
        self.path=BASE/'results/raw'/f'{name}.ndjson'; self.path.parent.mkdir(parents=True,exist_ok=True)
        archived=self.path.with_suffix('.ndjson.gz')
        if not reset and not self.path.exists() and archived.exists():
            with gzip.open(archived,'rb') as src,self.path.open('wb') as dst:
                while chunk:=src.read(1024*1024):dst.write(chunk)
        if reset: self.path.write_text('')
        self.seen=set()
        if self.path.exists():
            for line in self.path.read_text(encoding='utf-8').splitlines():
                if line: self.seen.add(json.loads(line)['test_id'])
        self.file=self.path.open('a',encoding='utf-8'); self.count=0
    def write(self,r):
        if r['test_id'] in self.seen: return
        self.file.write(json.dumps(safe(r),separators=(',',':'),ensure_ascii=False)+'\n'); self.file.flush()
        self.seen.add(r['test_id']); self.count+=1
    def close(self): self.file.close()

def verify(expected,actual,tolerance=0):
    errors={}
    def walk(e,a,p):
        if isinstance(e,dict):
            assert isinstance(a,dict) and e.keys()==a.keys(), (p,e,a)
            for k in e: walk(e[k],a[k],p+'.'+k)
        elif isinstance(e,list):
            assert len(e)==len(a),(p,e,a)
            for i,(x,y) in enumerate(zip(e,a)): walk(x,y,p+f'[{i}]')
        elif isinstance(e,(float,int)) and not isinstance(e,bool):
            assert isinstance(a,(float,int)) and not isinstance(a,bool),(p,e,a)
            error=abs(e-a); errors[p]=error
            assert error<=tolerance+1e-12,(p,e,a,error,tolerance)
        else: assert type(e)==type(a) and e==a,(p,e,a)
    walk(expected,actual,'$'); return errors

def timing(fn,warmups=20,samples=100):
    for _ in range(warmups): fn()
    times=[]
    for _ in range(samples):
        start=time.perf_counter_ns(); fn(); times.append(time.perf_counter_ns()-start)
    times.sort()
    return dict(unit='ns',median=times[len(times)//2],p95=times[math.ceil(.95*len(times))-1],
                samples=samples,warmups=warmups,raw_sorted_ns=times)

def udp_totals(r,up,down,version):
    # Each list entry is an actual received UDP datagram; IP headers are calculated.
    ip=20 if version=='IPv4' else 40
    r.update(application_uplink_bytes=sum(map(len,up)),application_downlink_bytes=sum(map(len,down)),
      transport_header_bytes=8*len(up),network_header_bytes=ip*len(up),
      total_uplink_bytes=sum(map(len,up))+(8+ip)*len(up),
      total_downlink_bytes=sum(map(len,down))+(8+ip)*len(down))
    r['total_network_bytes']=r['total_uplink_bytes']+r['total_downlink_bytes']
    r['effective_bytes_per_reading']=r['total_network_bytes']/r['batch_size']
    r['measurement_provenance']={'application':'measured loopback datagrams','udp_ip':'specification_calculated',
      'ip_assumptions':'no IP options/extensions; no lower-layer framing; fragmentation not observed'}
    r['observations']={'uplink_datagrams_hex':[x.hex() for x in up], 'downlink_datagrams_hex':[x.hex() for x in down]}
