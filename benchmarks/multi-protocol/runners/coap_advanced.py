"""Real aiocoap Context: blockwise, Observe, and seeded UDP loss/latency.
Loss is applied to datagrams in a loopback proxy, never inferred by multiplication.
"""
import asyncio,collections,hashlib,json,pathlib,random,socket,sys,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from local_network import free_port
import aiocoap
from aiocoap import resource
from aiocoap.numbers.constants import TransportTuning

class FastTuning(TransportTuning):
    ACK_TIMEOUT=.05
    ACK_RANDOM_FACTOR=1
    MAX_RETRANSMIT=3

class Sensor(resource.ObservableResource):
    def __init__(self):super().__init__();self.accepted=[];self.payload=b''
    async def render_post(self,request):
        self.accepted.append(bytes(request.payload));self.payload=request.payload
        return aiocoap.Message(code=aiocoap.CHANGED,payload=hashlib.sha256(request.payload).digest())
    async def render_get(self,request):return aiocoap.Message(payload=self.payload)

class Proxy(asyncio.DatagramProtocol):
    def __init__(self,target):self.target=target;self.client=None;self.events=[];self.loss=0;self.latency=0;self.jitter=0;self.rng=random.Random(20261010)
    def connection_made(self,transport):self.transport=transport
    def datagram_received(self,data,remote):
        direction='down' if remote==self.target else 'up'
        if direction=='up':self.client=remote
        destination=self.client if direction=='down' else self.target
        drop=self.rng.random()<self.loss
        self.events.append(dict(timestamp_ns=time.perf_counter_ns(),direction=direction,hex=data.hex(),dropped=drop))
        delay=max(0,self.latency+self.rng.uniform(-self.jitter,self.jitter))
        if not drop and destination:asyncio.get_running_loop().call_later(delay,self.transport.sendto,data,destination)

async def main():
    writer=Writer('coap-advanced',reset=True)
    case=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))[0]
    port=free_port();site=resource.Site();sensor=Sensor();site.add_resource(['t'],sensor)
    server=await aiocoap.Context.create_server_context(site,bind=('127.0.0.1',port),transports=['simplesocketserver'])
    client=await aiocoap.Context.create_client_context(transports=['simple6'])
    proxy=Proxy(('127.0.0.1',port));transport,_=await asyncio.get_running_loop().create_datagram_endpoint(lambda:proxy,local_addr=('127.0.0.1',0))
    uri=f'coap://127.0.0.1:{transport.get_extra_info("sockname")[1]}/t'
    def finish(r,events):
        up=[bytes.fromhex(x['hex']) for x in events if x['direction']=='up'];down=[bytes.fromhex(x['hex']) for x in events if x['direction']=='down']
        udp_totals(r,up,down,'IPv4');r['proxy_observations']=events
        r['measurement_provenance']['application']='measured proxy ingress datagrams, including deliberately dropped attempts; forwarded leg not double counted'
    try:
        for size in [1024,2048,4096,8192,16384]:
            data=bytes((i%251 for i in range(size)));begin=len(proxy.events)
            request=aiocoap.Message(code=aiocoap.POST,uri=uri,payload=data)
            response=await asyncio.wait_for(client.request(request).response,5)
            assert response.payload==hashlib.sha256(data).digest() and sensor.accepted[-1]==data
            r=record(case,'CoAP+UDP blockwise','aiocoap',implementation_version='0.4.17',specification_version='RFC7959',network_type='IPv4',
              delivery_mode='CON with blockwise reassembly',protocol_specific_settings=dict(payload_bytes=size),source_references=['coap-rfc','blockwise-rfc'],
              serialized_payload_bytes=size,decoding_verified=True,comparison_scope='opaque byte-transfer experiment, not ESP32 sensor encoding')
            finish(r,proxy.events[begin:]);r['logical_readings']=1;r['reassembled_sha256']=hashlib.sha256(data).hexdigest();writer.write(r)
        # Actual Observe subscription and subsequent resource-change notification.
        begin=len(proxy.events);sensor.payload=b'initial'
        observation=client.request(aiocoap.Message(code=aiocoap.GET,uri=uri,observe=0))
        response=await asyncio.wait_for(observation.response,3);assert response.payload==b'initial'
        notification=asyncio.get_running_loop().create_future()
        observation.observation.register_callback(lambda message:notification.set_result(message) if not notification.done() else None)
        sensor.payload=b'updated';sensor.updated_state()
        update=await asyncio.wait_for(notification,3);assert update.payload==b'updated'
        observation.observation.cancel();await asyncio.sleep(.03)
        r=record(case,'CoAP+UDP Observe','aiocoap',implementation_version='0.4.17',specification_version='RFC7641',network_type='IPv4',delivery_mode='Observe subscription + notification',decoding_verified=True,
          protocol_specific_settings={'initial_payload_hex':b'initial'.hex(),'notification_payload_hex':b'updated'.hex()},source_references=['observe-rfc'])
        finish(r,proxy.events[begin:]);writer.write(r)
        for loss in [0,.001,.01,.02,.05,.1]:
            for con in [False,True]:
                await asyncio.sleep(.1)
                proxy.loss=loss;proxy.rng.seed(20261010);begin=len(proxy.events);accepted_begin=len(sensor.accepted);success=0;latencies=[];outcomes=[]
                n=100 if con else 1000
                experiment_prefix=f'{loss}:{con}:'.encode()
                for i in range(n):
                    data=experiment_prefix+i.to_bytes(4,'big')+b'sensor-test';t=time.perf_counter_ns()
                    request=aiocoap.Message(code=aiocoap.POST,uri=uri,payload=data,mtype=aiocoap.CON if con else aiocoap.NON,transport_tuning=FastTuning())
                    exchange=client.request(request)
                    try:
                        response=await asyncio.wait_for(exchange.response,.9 if con else .015)
                        assert response.payload==hashlib.sha256(data).digest();success+=1;outcomes.append(True)
                    except (asyncio.TimeoutError,aiocoap.error.NetworkError):outcomes.append(False)
                    latencies.append(time.perf_counter_ns()-t)
                await asyncio.sleep(.1)
                events=proxy.events[begin:];accepted=[x for x in sensor.accepted[accepted_begin:] if x.startswith(experiment_prefix)]
                unique=len(set(accepted));ups=[x['hex'] for x in events if x['direction']=='up'];duplicates=len(ups)-len(set(ups))
                r=record(case,'CoAP+UDP impairment','aiocoap',implementation_version='0.4.17',network_type='IPv4',delivery_mode='CON retries' if con else 'NON',
                  protocol_specific_settings=dict(loss_probability=loss,seed=20261010,ack_timeout_seconds=.05,max_retransmit=3,ack_random_factor=1,
                    readings=n,timeout_seconds=.9 if con else .015),source_references=['coap-rfc'],decoding_verified=True,
                  comparison_scope='controlled proxy loss; accelerated retry timing is NOT production CoAP defaults')
                finish(r,events)
                r.update(logical_readings=n,responses_verified=success,unique_readings_received=unique,delivery_success_rate=unique/n,
                  observed_dropped_datagrams=sum(x['dropped'] for x in events),actual_retransmitted_datagrams=duplicates,
                  retransmission_bytes=sum(len(bytes.fromhex(h))+28 for h,count in collections.Counter(ups).items() for _ in range(count-1)),
                  latency_raw_ns=latencies,response_outcomes=outcomes,effective_bytes_per_reading=r['total_network_bytes']/n)
                writer.write(r);print('CoAP loss',loss,'CON',con,'received',unique,'/',n,flush=True)
        proxy.loss=0
        for latency,jitter in [(0,0),(.01,0),(.025,.005),(.05,.01)]:
            proxy.latency=latency;proxy.jitter=jitter;begin=len(proxy.events);times=[]
            for _ in range(20):
                t=time.perf_counter_ns();response=await asyncio.wait_for(client.request(aiocoap.Message(code=aiocoap.POST,uri=uri,payload=b'latency')).response,2)
                assert response.payload==hashlib.sha256(b'latency').digest();times.append(time.perf_counter_ns()-t)
            r=record(case,'CoAP+UDP latency','aiocoap',network_type='IPv4',delivery_mode='CON',protocol_specific_settings=dict(one_way_latency_seconds=latency,jitter_seconds=jitter,readings=20),decoding_verified=True,source_references=['coap-rfc'])
            finish(r,proxy.events[begin:]);r.update(logical_readings=20,latency_raw_ns=times,effective_bytes_per_reading=r['total_network_bytes']/20);writer.write(r)
    finally:
        await client.shutdown();await server.shutdown();transport.close();writer.close()
    print('Advanced CoAP records',writer.count)
if __name__=='__main__':asyncio.run(main())
