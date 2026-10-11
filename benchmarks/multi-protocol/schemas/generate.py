"""Deterministic semantic cases; schema optimizations are explicit."""
import json,pathlib,random,struct,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,dump,safe
R=random.Random(20261010)
cases=[]
def add(id,fields,values,policy='lossless',**extra):
    cases.append(dict(id=id,fields=fields,values=values,precision_policy=policy,**extra))
def field(name,type,**extra): return dict(name=name,type=type,**extra)
def generate():
    cases.clear()
    R.seed(20261010)
    original=[field('temp','float32'),field('humidity','float32'),field('is_active','bool')]
    add('esp32-original',original,dict(temp=23.5,humidity=61.25,is_active=True),family='reference')
    add('esp32-optimized',[field('temp','fixed',min=-40,max=125,precision=.1),
      field('humidity','fixed',min=0,max=100,precision=.1),field('is_active','bool')],
      dict(temp=23.5,humidity=61.25,is_active=True),'quantized-half-step',family='reference')
    types=['bool','uint8','uint16','uint32','uint64','int8','int16','int32','int64','uintvar','intvar','sintvar','float16','float32','float64']
    for t in types:
        bits={'uint8':8,'uint16':16,'uint32':32,'uint64':64,'int8':8,'int16':16,'int32':32,'int64':64}.get(t,64)
        unsigned=t.startswith('uint'); floating=t.startswith('float')
        values=([False,True] if t=='bool' else [0.,-0.,1.5,-23.5,61.25,65504.] if floating else
          sorted(set([0,1,127,128,255,256,16383,16384]+([] if unsigned else [-1,-127,-128,-129,-16384])+([2**bits-1] if unsigned else [-(2**(bits-1)),2**(bits-1)-1]))))
        for i,v in enumerate(values):
            if not floating and t!='bool' and not (0<=v<2**bits if unsigned else -2**(bits-1)<=v<2**(bits-1)): continue
            add(f'boundary-{t}-{i}',[field('value',t)],{'value':v},family='boundary')
    for n in [1,2,3,5,10,20,50,100]:
        for kind in ['bool','float32','uint32','mixed']:
            fs=[];vs={}
            for i in range(n):
                t= ['bool','float32','uint32'][i%3] if kind=='mixed' else kind
                f=field(f'f{i}',t);fs.append(f)
                vs[f['name']]=bool(i%2) if t=='bool' else struct.unpack('<f',struct.pack('<f',R.uniform(-50,125)))[0] if t=='float32' else R.randrange(0,100000)
            add(f'count-{n}-{kind}',fs,vs,family='field-count')
    sizes=[1,2,3,5,8,10,16,25,32,50,64,100,128,256,500,1024,2048,4096,8192,16384]
    for n in sizes:
        add(f'bytes-{n}',[field('value','bytes')],{'value':bytes(R.randrange(256) for _ in range(n))},family='payload-size',target_bytes=n)
        add(f'ascii-{n}',[field('value','string')],{'value':''.join(chr(R.randrange(32,127)) for _ in range(n))},family='payload-size',target_bytes=n)
        add(f'compressible-{n}',[field('value','string')],{'value':('temperature:23.5;'*((n+16)//17))[:n]},family='compression',target_bytes=n)
    for value in ['','é','温度🌡️','مرحبا بالعالم','a'*127,'a'*128]:
        add(f'utf8-{len(cases)}',[field('value','string')],{'value':value},family='unicode')
    for n in [0,1,2,5,10,25,50,100,1000]:
        add(f'array-{n}',[field('readings','uint32',repeated=True)],{'readings':[R.randrange(16385) for _ in range(n)]},family='array')
    nested=[field('position','nested',fields=[field('lat','float64'),field('lon','float64')]),field('name','string')]
    add('nested-gps',nested,{'position':{'lat':37.7749,'lon':-122.4194},'name':'tracker α'},family='nested')
    for present in [False,True]:
        add(f'optional-{present}',[field('value','float32',optional=True),field('active','bool')],
            dict(active=True,**({'value':23.5} if present else {})),family='optional')
    add('null',[field('value','nullable')],{'value':None},family='null')
    add('enum',[field('state','enum',values=['off','idle','active','fault'])],{'state':'active'},family='enum')
    add('bitset',[field('status','bitset',bits=12)],{'status':0xA55},family='bitset')
    add('timestamp',[field('time','timestamp')],{'time':1791676800123},family='timestamp')
    presets={
      'environment':{'temp':23.5,'humidity':61.25,'pressure':1013.25,'active':True,'battery':87},
      'gps':{'lat':37.7749,'lon':-122.4194,'speed':12.5,'heading':90.,'altitude':35.,'timestamp':1791676800,'battery':80},
      'vehicle':{'lat':37.7749,'lon':-122.4194,'speed':65.,'rpm':2300,'fuel':.75,'temp':90.,'odometer':123456,'engine':True,'fault':0},
      'industrial':{'voltage':230.5,'current':12.25,'temp':45.5,'vibration':.125,'pressure':5.25,'state':2},
      'smart-home':{'door':False,'motion':True,'temp':21.5,'humidity':45.,'battery':95,'timestamp':1791676800},
      'energy':{'voltage':230.,'current':10.5,'power':2415.,'energy':12345.5,'frequency':50.,'status':1},
      'air-quality':{'co2':650,'pm25':12.5,'temp':23.5,'humidity':61.25,'alarm':False},
      'water-meter':{'liters':12345,'flow':1.25,'pressure':4.5,'leak':False,'battery':90}}
    for name,vs in presets.items():
        fs=[field(k,'bool' if isinstance(v,bool) else 'float64' if k in ['lat','lon'] else 'float32' if isinstance(v,float) else 'uint32') for k,v in vs.items()]
        add('preset-'+name,fs,vs,family='preset')
    add('large-structured',[field('readings','float32',repeated=True),field('meta','nested',fields=[field('firmware','string'),field('site','string')])],
        {'readings':[float(i)/4 for i in range(100)],'meta':{'firmware':'1.2.3','site':'factory-west'}},family='nested')
    for i in range(100):
        fs=[];vs={}
        for j in range(R.choice([1,2,3,5,10,20,50])):
            t=R.choice(['bool','float32','int32','uint8']); name=f'f{j}'
            fs.append(field(name,t));vs[name]=R.choice([False,True]) if t=='bool' else R.randrange(256) if t=='uint8' else float(R.randrange(-1000,1000))/4 if t=='float32' else R.randrange(-100000,100000)
        add(f'random-{i:03}',fs,vs,family='seeded-random')
    dump('schemas/library.json',cases)
    return cases
if __name__=='__main__': print('Schemas:',len(generate()))
