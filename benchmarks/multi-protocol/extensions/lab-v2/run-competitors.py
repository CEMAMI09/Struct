"""Reuse actual Paho/NanoMQ and aiocoap runners, retaining separate v2 observations."""
import sys, pathlib, json, gzip, importlib, time
BASE = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE/'runners'))
import common

class ExtensionWriter:
    def __init__(self, name, reset=False):
        self.path=pathlib.Path(__file__).parent/f'{name}-observations.ndjson.gz'
        self.file=gzip.open(self.path,'wt',encoding='utf-8'); self.seen=set(); self.count=0
    def write(self, row):
        if row['test_id'] in self.seen: return
        self.file.write(json.dumps(common.safe(row),separators=(',',':'))+'\n'); self.file.flush()
        self.seen.add(row['test_id']); self.count+=1
    def close(self): self.file.close()

def main():
    common.VERSION='2.0.0-lab-coverage'
    cases=common.restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf-8')))
    selected=[c for c in cases if c['family']=='preset' or c['id'] in ['esp32-original','esp32-optimized']]
    started=time.perf_counter()
    for name in sys.argv[1:] or ['mqtt','coap']:
        if name not in ['mqtt','coap']: raise ValueError('Choose mqtt/coap')
        importlib.import_module(name).main(cases_override=selected,writer_factory=ExtensionWriter,batch_sizes=[1,10])
    print('Extension runtime seconds',round(time.perf_counter()-started,2))
if __name__=='__main__': main()
