"""Bounded sequential suite with phase checkpoints and process resource sampling."""
import argparse,hashlib,json,os,pathlib,subprocess,sys,time
import psutil
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,ROOT,dump

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fresh',action='store_true');parser.add_argument('--phases',nargs='*');parser.add_argument('--esp32',action='store_true')
    args=parser.parse_args();reset=['--reset'] if args.fresh else []
    phases=[('schemas',[sys.executable,str(BASE/'schemas/generate.py')]),('research',[sys.executable,str(BASE/'scripts/research.py')]),
      ('serialization',[sys.executable,str(BASE/'runners/serialization.py'),*reset]),('struct',['node',str(BASE/'runners/struct.cjs'),*reset]),
      ('coap',[sys.executable,str(BASE/'runners/coap.py'),*reset]),('mqtt',[sys.executable,str(BASE/'runners/mqtt.py'),*reset]),
      ('mqtt-connections',[sys.executable,str(BASE/'runners/mqtt_connections.py')]),('https',[sys.executable,str(BASE/'runners/https.py'),*reset]),
      ('lwm2m',[sys.executable,str(BASE/'runners/lwm2m.py')]),('coap-dtls',[sys.executable,str(BASE/'runners/coap_dtls.py')]),
      ('coap-advanced',[sys.executable,str(BASE/'runners/coap_advanced.py')]),('struct-impairment',['node',str(BASE/'runners/struct_impairment.cjs')]),
      ('struct-burst',['node',str(BASE/'runners/struct_impairment.cjs'),'--burst']),('security',[sys.executable,str(BASE/'runners/security_checks.py')])]
    if args.esp32:phases.insert(2,('esp32',['node',str(ROOT/'scripts/benchmark-secure-v2-esp32.cjs'),'--output',str(BASE/'results/raw/struct-esp32-pilot.json')]))
    logdir=ROOT/'work/multi-protocol/logs';logdir.mkdir(parents=True,exist_ok=True)
    runtime=[];start=time.monotonic()
    for name,command in phases:
        if args.phases and name not in args.phases:continue
        print('Starting',name,flush=True);begin=time.monotonic();peak=0;cpu=0
        with (logdir/(name+'.log')).open('w',encoding='utf8') as log:
            p=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=log,env={**os.environ,'PYTHONUTF8':'1'})
            proc=psutil.Process(p.pid)
            while p.poll() is None:
                rss=0;sample_cpu=0
                try:children=[proc]+proc.children(recursive=True)
                except psutil.Error:children=[]
                for child in children:
                    try:rss+=child.memory_info().rss;t=child.cpu_times();sample_cpu+=t.user+t.system
                    except psutil.Error:pass
                peak=max(peak,rss);cpu=max(cpu,sample_cpu)
                if time.monotonic()-begin>600:p.terminate();raise TimeoutError('Phase exceeded bounded10minute budget: '+name)
                time.sleep(.1)
        result=dict(phase=name,exit_code=p.returncode,wall_seconds=round(time.monotonic()-begin,3),peak_process_tree_rss_bytes=peak,
          sampled_process_tree_cpu_seconds_lower_bound=cpu,log=str(logdir/(name+'.log')),command=command)
        runtime.append(result);dump('results/raw/runtime.json',dict(phases=runtime,wall_seconds=time.monotonic()-start,sampling_interval_seconds=.1,
          limitations='CPU may miss short-lived children; RSS sum includes shared pages; not allocations or microcontroller memory'))
        print('Finished',name,result['wall_seconds'],'s; exit',p.returncode,flush=True)
        if p.returncode:raise SystemExit('Phase failed; inspect '+str(logdir/(name+'.log')))
    paths=[p for p in BASE.rglob('*') if p.is_file() and p.suffix in ['.py','.cjs','.java'] and '__pycache__' not in str(p)]
    for relative in ['sdk/js/secure-v2.cjs','sdk/js/secure-v2-client.cjs','sdk/js/index.cjs','sdk/js/protocol.cjs','protocol/schema/bitpacked.cjs','tcp-server/ingest.js','tcp-server/secure-v2.js','tcp-server/parser.js','web/shared/schemaCodegen.ts','package-lock.json','tests/database.cjs','scripts/benchmark-secure-v2-esp32.cjs']:
        paths.append(ROOT/relative)
    dump('references/source-hashes.json',[dict(path=str(p.relative_to(ROOT)).replace('\\','/'),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths if p.is_file()])
    # Normalize only after runtime.json is final, so its compressed copy and hash agree.
    if not args.phases or 'normalize' in args.phases:
        subprocess.run([sys.executable,str(BASE/'analyzers/build_dataset.py')],cwd=ROOT,check=True)
        subprocess.run([sys.executable,str(BASE/'validators/validate.py')],cwd=ROOT,check=True)
        subprocess.run([sys.executable,str(BASE/'analyzers/report.py')],cwd=ROOT,check=True)
    print('Suite wall seconds including normalization',round(time.monotonic()-start,2))
if __name__=='__main__':main()
