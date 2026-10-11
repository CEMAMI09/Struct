"""Real aiocoap wire/OSCORE implementation over isolated loopback UDP.

This low-level resource endpoint measures one exchange, not automatic blockwise,
Observe scheduling or library retransmissions. Those remain separate coverage.
"""
import hashlib,json,pathlib,socket,sys,tempfile,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'implementations'))
from common import *
from serializers import Codec
import aiocoap
from aiocoap import oscore
from aiocoap.message import Direction

def contexts(directory,algorithm):
    result=[]
    for side,sender,recipient in [('client','01','02'),('server','02','01')]:
        path=pathlib.Path(directory)/side;path.mkdir(parents=True)
        (path/'secret.json').write_text(json.dumps({'secret_hex':os.urandom(32).hex(), 'sender-id_hex':sender,'recipient-id_hex':recipient,'algorithm':algorithm}))
        result.append(path)
    # One fresh public test secret per pair; keys never leave this local benchmark.
    secret=os.urandom(32).hex()
    for path in result:
        data=json.loads((path/'secret.json').read_text());data['secret_hex']=secret
        (path/'secret.json').write_text(json.dumps(data))
    return [oscore.FilesystemSecurityContext(str(path)) for path in result]

def main():
    import importlib.metadata as md
    cases=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))
    writer=Writer('coap',reset='--reset' in sys.argv);start=time.perf_counter()
    security_modes=[None,'AES-CCM-16-64-128','AES-CCM-16-128-128','ChaCha20/Poly1305']
    with tempfile.TemporaryDirectory(prefix='struct-local-oscore-') as tmp:
        pairs={alg:contexts(pathlib.Path(tmp)/str(i),alg) for i,alg in enumerate(security_modes[1:])}
        for case in cases:
            # Full schema coverage for plain UDP; secure sampling covers all boundary families,
            # all field counts, all presets, all payload sizes, plus 20 randomized cases.
            selected=case.get('family')!='seeded-random' or int(case['id'].split('-')[-1])<20
            modes=security_modes if selected else [None]
            for codec_name in ['cbor-canonical','cbor-array','cbor-integer-keys','json-compact','json-array','protobuf']:
                try: codec=Codec(codec_name,case)
                except NotImplementedError: continue
                for algorithm in modes:
                    for net in ['IPv4','IPv6']:
                        for confirmed in [False,True]:
                            batches=[1,2,5,10,25,50,100] if case['id'] in ['esp32-original','esp32-optimized'] else [1]
                            for batch in batches:
                                # Short vs 8-byte tokens and longer URI affect the critical reference.
                                variations=[(2,('t',))]
                                if case['id']=='esp32-original' and batch==1: variations += [(0,('t',)),(4,('telemetry','device-0001')),(8,('telemetry','device-0001'))]
                                for tokenlen,path in variations:
                                    r=record(case,f'{codec_name}+CoAP'+('+OSCORE' if algorithm else '')+'+UDP','aiocoap',
                                      implementation_version=md.version('aiocoap'),specification_version='RFC7252 / RFC8613' if algorithm else 'RFC7252',
                                      security_enabled=bool(algorithm),security_configuration=algorithm,
                                      delivery_mode='CON piggyback 2.04 ACK' if confirmed else 'NON 2.04 response',batch_size=batch,
                                      network_type=net,connection_mode='connectionless; preprovisioned context' if algorithm else 'connectionless',
                                      protocol_specific_settings=dict(token_length=tokenlen,uri_path=path,content_format=42 if codec_name=='protobuf' else 50 if codec_name.startswith('json') else 60),
                                      comparison_scope='device/resource endpoint exchange; UDP/IP calculated',source_references=['coap-rfc','oscore-rfc','cbor-rfc'],comparable=True)
                                    if r['test_id'] in writer.seen: continue
                                    client=server=None
                                    try:
                                        data=codec.encode(batch)
                                        message=aiocoap.Message(code=aiocoap.POST,mtype=aiocoap.CON if confirmed else aiocoap.NON,mid=100,token=b'\x51'*tokenlen,payload=data)
                                        message.opt.uri_path=path;message.opt.content_format=r['protocol_specific_settings']['content_format']
                                        request_id=None
                                        if algorithm:
                                            cctx,sctx=pairs[algorithm]
                                            r['oscore_sender_sequence']=cctx.sender_sequence_number
                                            protected,request_id=cctx.protect(message)
                                            protected.mid=message.mid;protected.token=message.token;protected.mtype=message.mtype
                                            outbound=protected.encode()
                                            # Authentication rejection tested BEFORE valid delivery, using the actual unprotector.
                                            bad=bytearray(outbound);bad[-1]^=1
                                            try: sctx.unprotect(aiocoap.Message.decode(bytes(bad)));raise AssertionError('Tampered OSCORE accepted')
                                            except (oscore.ProtectionInvalid,oscore.DecodeError,oscore.ReplayError): pass
                                        else: outbound=message.encode()
                                        family=socket.AF_INET if net=='IPv4' else socket.AF_INET6;host='127.0.0.1' if net=='IPv4' else '::1'
                                        server=socket.socket(family,socket.SOCK_DGRAM);client=socket.socket(family,socket.SOCK_DGRAM)
                                        server.settimeout(3);client.settimeout(3);server.bind((host,0));client.bind((host,0))
                                        t=time.perf_counter_ns();client.sendto(outbound,server.getsockname());received,remote=server.recvfrom(65535)
                                        assert received==outbound
                                        incoming=aiocoap.Message.decode(received)
                                        if algorithm: plain,server_id=sctx.unprotect(incoming)
                                        else: plain=incoming
                                        decoded=codec.decode(plain.payload,batch)
                                        expected=case['values'] if batch==1 else [case['values']]*batch
                                        errors=verify(expected,decoded,.05 if case['precision_policy']!='lossless' else 0)
                                        response=aiocoap.Message(code=aiocoap.CHANGED,mtype=aiocoap.ACK if confirmed else aiocoap.NON,mid=100 if confirmed else 101,token=message.token)
                                        if algorithm:
                                            secured_response,_=sctx.protect(response,server_id)
                                            secured_response.mid=response.mid;secured_response.token=response.token;secured_response.mtype=response.mtype
                                            reply=secured_response.encode()
                                        else: reply=response.encode()
                                        server.sendto(reply,remote);reply_in,_=client.recvfrom(65535);response_in=aiocoap.Message.decode(reply_in)
                                        if algorithm:
                                            clear_response,_=cctx.unprotect(response_in,request_id)
                                            assert clear_response.code==aiocoap.CHANGED
                                            try: sctx.unprotect(aiocoap.Message.decode(received));raise AssertionError('Replay accepted')
                                            except oscore.ReplayError: pass
                                        else: assert response_in.code==aiocoap.CHANGED
                                        elapsed=time.perf_counter_ns()-t
                                        udp_totals(r,[received],[reply_in],net)
                                        r.update(serialized_payload_bytes=len(data),decoded_values=safe(decoded if batch==1 else decoded[:1]),decoded_readings_count=batch,
                                          decoding_verified=True,precision_error=errors,handshake_bytes=0,maintenance_bytes=0,retransmission_bytes=0,
                                          security_verified=bool(algorithm),tamper_rejected=True if algorithm else None,replay_rejected=True if algorithm else None,
                                          host_exchange_latency_ns=elapsed,coap_plain_datagram_bytes=len(message.encode()),
                                          security_increment_bytes=len(outbound)-len(message.encode()),
                                          assumed_1500_mtu_exceeded=len(outbound)+8+(20 if net=='IPv4' else 40)>1500,
                                          actual_fragmentation='not captured; counts assume unfragmented loopback IP',
                                          delivery_guarantee='resource decoded and returned 2.04; no durable database persistence')
                                    except Exception as e:
                                        r.update(test_status='failed',reason=repr(e))
                                    finally:
                                        if server: server.close()
                                        if client: client.close()
                                    writer.write(r)
        # Release context file locks and flush sequence reservations before temporary cleanup.
        for pair in pairs.values():
            for ctx in pair:
                # aiocoap unlinks before releasing its lock (POSIX behavior).
                # Release first on Windows; only disposable test contexts use this adapter.
                ctx.lockfile.release()
                # filelock 4 on Windows removes the path on release; aiocoap's
                # POSIX cleanup expects it to remain. Recreate an empty marker.
                pathlib.Path(ctx.lockfile.lock_file).touch()
                ctx._destroy()
    writer.close();print('CoAP records added:',writer.count,'seconds:',round(time.perf_counter()-start,2))
if __name__=='__main__': main()
