import gzip,hashlib,json,pathlib,sys,time,zlib,brotli
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec

def main():
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf-8')))
    writer=Writer('serialization',reset='--reset' in sys.argv)
    start=time.perf_counter()
    import importlib.metadata as md
    versions={n:md.version(n) for n in ['protobuf','cbor2','brotli']}
    for case in cases:
        for name in ['protobuf','json-compact','json-standard','json-array','cbor','cbor-canonical','cbor-array','cbor-integer-keys']:
            variants=[dict(packed=True,field_start=1)]
            if name=='protobuf' and (case['id'].startswith('array-') or case['id']=='esp32-original'):
                variants += [dict(packed=False,field_start=1),dict(packed=True,field_start=16)]
            for variant in variants:
                for batch in ([1,2,5,10,25,50,100] if case.get('family') in ['reference','preset'] else [1]):
                    r=record(case,name,'google.protobuf' if name=='protobuf' else 'Python json' if name.startswith('json') else 'cbor2',
                      implementation_version=versions['protobuf' if name=='protobuf' else 'cbor2'] if not name.startswith('json') else platform.python_version(),
                      batch_size=batch,protocol_specific_settings=variant if name=='protobuf' else {'canonical':name=='cbor-canonical'},
                      source_references=['protobuf-encoding'] if name=='protobuf' else ['json-rfc'] if name.startswith('json') else ['cbor-rfc'])
                    if r['test_id'] in writer.seen: continue
                    try:
                        codec=Codec(name,case,**variant); data=codec.encode(batch); decoded=codec.decode(data,batch)
                        expected=case['values'] if batch==1 else [case['values']]*batch
                        errors=verify(expected,decoded,.05 if case['precision_policy']!='lossless' else 0)
                        r.update(serialized_payload_bytes=len(data),decoded_values=safe(decoded if batch==1 else decoded[:1]),
                          decoded_readings_count=batch,decoding_verified=True,precision_error=errors,
                          payload_sha256=hashlib.sha256(data).hexdigest(),payload_hex_prefix=data[:256].hex(),
                          measurement_provenance={'serialized_payload_bytes':'measured actual serializer output'},
                          performance={'serialization':timing(lambda:codec.encode(batch)),
                                       'deserialization':timing(lambda:codec.decode(data,batch))})
                        if case.get('family')=='compression' and batch==1:
                            r['compression_experiments']=[]
                            for algorithm,fn,reverse in [('gzip',lambda d:gzip.compress(d,mtime=0),gzip.decompress),('zlib',zlib.compress,zlib.decompress),('brotli',brotli.compress,brotli.decompress)]:
                                out=fn(data);assert reverse(out)==data
                                r['compression_experiments'].append(dict(algorithm=algorithm,original_bytes=len(data),compressed_bytes=len(out),
                                  scope='payload only; no claim of native protocol support',performance=timing(lambda:fn(data),samples=30)))
                    except NotImplementedError as e: r.update(test_status='unsupported',measurement_type='unsupported',reason=str(e))
                    except Exception as e: r.update(test_status='failed',reason=repr(e))
                    writer.write(r)
    writer.close();print('Serialization records added:',writer.count,'seconds:',round(time.perf_counter()-start,2))
if __name__=='__main__': main()
