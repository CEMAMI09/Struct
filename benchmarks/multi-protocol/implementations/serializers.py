"""Actual maintained serializers; explicit shared precision transformation."""
import copy,json,math,struct,sys,pathlib
import cbor2
from google.protobuf import descriptor_pb2,descriptor_pool,message_factory
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import safe,restore

T=descriptor_pb2.FieldDescriptorProto
TYPES={'bool':T.TYPE_BOOL,'uint8':T.TYPE_UINT32,'uint16':T.TYPE_UINT32,'uint32':T.TYPE_UINT32,
 'uint64':T.TYPE_UINT64,'int8':T.TYPE_INT32,'int16':T.TYPE_INT32,'int32':T.TYPE_INT32,
 'int64':T.TYPE_INT64,'uintvar':T.TYPE_UINT64,'intvar':T.TYPE_INT64,'sintvar':T.TYPE_SINT64,
 'float16':T.TYPE_FLOAT,'float32':T.TYPE_FLOAT,'float64':T.TYPE_DOUBLE,'fixed':T.TYPE_UINT32,
 'string':T.TYPE_STRING,'bytes':T.TYPE_BYTES,'timestamp':T.TYPE_UINT64,'bitset':T.TYPE_UINT32,'enum':T.TYPE_UINT32}

def transform(fields,values,inverse=False):
    result={}
    for f in fields:
        k=f['name']
        if k not in values: continue
        def one(v):
            if f['type']=='fixed':
                return f['min']+v*f['precision'] if inverse else math.floor((v-f['min'])/f['precision']+.5+1e-7)
            if f['type']=='enum': return f['values'][v] if inverse else f['values'].index(v)
            if f['type']=='nested': return transform(f['fields'],v,inverse)
            return v
        result[k]=[one(x) for x in values[k]] if f.get('repeated') else one(values[k])
    return result

class Codec:
    def __init__(self,name,case,packed=True,field_start=1):
        self.name=name;self.case=case;self.fields=case['fields']
        self.source=transform(self.fields,case['values'])
        if name=='protobuf':
            self.file=descriptor_pb2.FileDescriptorProto(name='benchmark.proto',package='bench',syntax='proto2')
            def build(msg,fields):
                for i,f in enumerate(fields,field_start):
                    p=msg.field.add(name=f['name'],number=i,label=T.LABEL_REPEATED if f.get('repeated') else T.LABEL_OPTIONAL)
                    if f['type']=='nested':
                        nested=msg.nested_type.add(name=f['name'].title()+'Message');build(nested,f['fields'])
                        p.type=T.TYPE_MESSAGE;p.type_name=nested.name
                    else:
                        if f['type'] not in TYPES: raise NotImplementedError('Protobuf scalar null requires a different declared schema')
                        p.type=TYPES[f['type']]
                        if f.get('repeated') and p.type not in [T.TYPE_STRING,T.TYPE_BYTES]: p.options.packed=packed
            msg=self.file.message_type.add(name='Reading');build(msg,self.fields)
            envelope=self.file.message_type.add(name='Batch')
            envelope.field.add(name='readings',number=1,label=T.LABEL_REPEATED,type=T.TYPE_MESSAGE,type_name='.bench.Reading')
            pool=descriptor_pool.DescriptorPool();pool.Add(self.file)
            self.message=message_factory.GetMessageClass(pool.FindMessageTypeByName('bench.Reading'))
            self.batch=message_factory.GetMessageClass(pool.FindMessageTypeByName('bench.Batch'))
    def fill(self,msg,values,fields):
        for f in fields:
            k=f['name']
            if k not in values: continue
            v=values[k]
            if f.get('repeated'):
                if f['type']=='nested':
                    for x in v: self.fill(getattr(msg,k).add(),x,f['fields'])
                else: getattr(msg,k).extend(v)
            elif f['type']=='nested': self.fill(getattr(msg,k),v,f['fields'])
            else: setattr(msg,k,v)
    def read(self,msg,fields):
        out={}
        for f in fields:
            k=f['name']
            if not f.get('repeated') and not msg.HasField(k): continue
            v=getattr(msg,k)
            out[k]=[self.read(x,f['fields']) if f['type']=='nested' else x for x in v] if f.get('repeated') else self.read(v,f['fields']) if f['type']=='nested' else v
        return out
    def encode(self,batch=1):
        if self.name=='protobuf':
            msg=self.message() if batch==1 else self.batch()
            if batch==1: self.fill(msg,self.source,self.fields)
            else:
                for _ in range(batch): self.fill(msg.readings.add(),self.source,self.fields)
            return msg.SerializeToString(deterministic=True)
        def layout(v):
            if self.name in ['cbor-array','json-array']:
                return [v.get(f['name'],cbor2.undefined if self.name=='cbor-array' else None) for f in self.fields]
            if self.name=='cbor-integer-keys':return {i:v[f['name']] for i,f in enumerate(self.fields) if f['name'] in v}
            return v
        v=layout(self.source) if batch==1 else [layout(self.source) for _ in range(batch)]
        if self.name.startswith('json'):
            # Bytes and >53-bit integers use an explicit tagged convention, not a JSON standard type.
            return json.dumps(safe(v),ensure_ascii=False,separators=(',',':') if self.name!='json-standard' else None,allow_nan=False).encode()
        return cbor2.dumps(v,canonical=self.name!='cbor')
    def decode(self,data,batch=1):
        if self.name=='protobuf':
            msg=self.message() if batch==1 else self.batch();msg.ParseFromString(data)
            v=self.read(msg,self.fields) if batch==1 else [self.read(x,self.fields) for x in msg.readings]
        elif self.name.startswith('json'): v=restore(json.loads(data))
        else: v=cbor2.loads(data)
        def unlayout(v):
            if self.name in ['cbor-array','json-array']:
                return {f['name']:x for f,x in zip(self.fields,v) if not (f.get('optional') and (x is cbor2.undefined or self.name=='json-array' and x is None))}
            if self.name=='cbor-integer-keys':return {self.fields[i]['name']:x for i,x in v.items()}
            return v
        v=unlayout(v) if batch==1 else [unlayout(x) for x in v]
        return transform(self.fields,v,True) if batch==1 else [transform(self.fields,x,True) for x in v]
