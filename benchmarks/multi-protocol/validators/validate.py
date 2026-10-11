"""Independent framing checks against measured buffers, not size-only tests."""
import gzip,json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,dump

def coap_layout(data):
    assert len(data)>=4 and data[0]>>6==1
    i=4+(data[0]&15);assert i<=len(data);number=0;options=[]
    def extended(n):
        nonlocal i
        if n<13:return n
        if n==13:result=13+data[i];i+=1;return result
        if n==14:result=269+int.from_bytes(data[i:i+2],'big');i+=2;return result
        raise AssertionError('reserved option nibble')
    while i<len(data) and data[i]!=255:
        head=data[i];i+=1;delta=extended(head>>4);length=extended(head&15);number+=delta
        value=data[i:i+length];assert len(value)==length;i+=length;options.append((number,value.hex()))
    if i<len(data):i+=1;assert i<len(data)
    return dict(header_options_bytes=i,payload_bytes=len(data)-i,options=options)

def main():
    checks=0
    for name in ['struct','coap']:
        path=BASE/'results/raw'/f'{name}.ndjson'
        opener=open if path.exists() else gzip.open
        if not path.exists():path=path.with_suffix('.ndjson.gz')
        with opener(path,'rt',encoding='utf8') as f:
            for line in f:
                r=json.loads(line)
                if r['test_status']!='passed':continue
                up=[bytes.fromhex(x) for x in r['observations']['uplink_datagrams_hex']]
                if name=='struct':
                    size=r['serialized_payload_bytes'];batch=r['batch_size'];settings=r['protocol_specific_settings']
                    expected=size*batch+25*len(up)+(len(up) if batch>1 else 0) if settings['security']=='V2' else size+66+(32 if settings['security']=='encrypted' else 0)
                    assert sum(map(len,up))==expected,r['test_id']
                    receipt_size=21 if settings['security']=='V2' else 69
                    assert r['application_downlink_bytes']==receipt_size*len(up) if settings['confirmed'] else r['application_downlink_bytes']==0
                else:
                    for data in up:
                        layout=coap_layout(data);assert layout['header_options_bytes']+layout['payload_bytes']==len(data)
                    if not r['security_enabled']:assert coap_layout(up[0])['payload_bytes']==r['serialized_payload_bytes']
                checks+=1
    with (BASE/'results/raw/lwm2m-network.ndjson').open(encoding='utf8') as f:
        for line in f:
            r=json.loads(line)
            if r['test_status']!='passed' or r['delivery_mode']!='Send 2.04 Changed':continue
            obs=r['observations'];assert len(obs['uplink_datagrams_hex'])==len(obs['downlink_datagrams_hex'])==1,'LwM2M Send window contains unrelated/background traffic'
            if not r['security_enabled']:
                data=bytes.fromhex(obs['uplink_datagrams_hex'][0]);layout=coap_layout(data)
                assert data[1]==2 and [v for n,v in layout['options'] if n==11]==['6470'],'Expected native POST /dp only'
                assert bytes.fromhex(obs['downlink_datagrams_hex'][0])[1]==68
            checks+=1
    dump('results/summaries/wire-validation.json',dict(records_validated=checks,errors=0,checks=['independent Struct overhead/batch/receipt formula versus actual bytes','independent CoAP header/token/option/payload parsing','isolated native LwM2M Send windows'],
      additional='analyzers/build_dataset.py verifies every UDP sum, independently parses MQTT Remaining Length/topic/QoS/properties and DTLS Hello/cipher/CID/record lengths'))
    print('Independent wire validation passed for',checks,'records')
if __name__=='__main__':main()
