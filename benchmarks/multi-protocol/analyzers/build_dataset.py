"""Normalize, validate raw lengths, cross-check MQTT framing, compress artifacts."""
import collections,csv,datetime,gzip,hashlib,json,math,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'runners'))
from common import BASE,ROOT,Writer,dump,record,restore
from dtls import parameters as dtls_parameters,records as dtls_records

def mqtt_packets(data):
    out=[];i=0
    while i<len(data):
        begin=i;control=data[i];i+=1;remaining=0;multiplier=1
        for _ in range(4):
            assert i<len(data),'truncated MQTT Remaining Length';b=data[i];i+=1;remaining+=(b&127)*multiplier;multiplier*=128
            if not b&128:break
        else:raise AssertionError('invalid Remaining Length')
        end=i+remaining;assert end<=len(data),'truncated MQTT packet'
        out.append(dict(type=control>>4,flags=control&15,bytes=end-begin,body=data[i:end]));i=end
    return out

def negotiated_cipher(hexdata):
    data=bytes.fromhex(hexdata);i=0
    while i+5<=len(data):
        typ=data[i];n=int.from_bytes(data[i+3:i+5],'big');body=data[i+5:i+5+n];i+=5+n
        if typ==22 and len(body)>39 and body[0]==2:
            hello=body[4:];sid=hello[34];code=hello[35+sid:37+sid].hex()
            return {'1301':'TLS_AES_128_GCM_SHA256','1302':'TLS_AES_256_GCM_SHA384','1303':'TLS_CHACHA20_POLY1305_SHA256','c02b':'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256','c02c':'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384'}.get(code,'0x'+code)
    return None

def supplement():
    case=restore(json.loads((BASE/'schemas/library.json').read_text(encoding='utf8')))[0]
    writer=Writer('struct-impairment-normalized-input',reset=True)
    for filename in ['struct-impairment.json','struct-burst-overload.json']:
        path=BASE/'results/raw'/filename
        if not path.exists():continue
        for x in json.loads(path.read_text())['results']:
            burst='burst' in filename;up=[e for e in x['observations'] if e['direction']=='up'];down=[e for e in x['observations'] if e['direction']=='down' and not e['dropped']]
            attempts=sum(y['attempts'] for y in x['outcomes'])
            r=record(case,'Struct Secure V2 impairment','repository SecureV2Client + authenticated mock sink',implementation_version='474e6b73',
              security_enabled=True,security_configuration='ChaCha20-Poly1305',delivery_mode='confirmed' if x['confirmed'] else 'unconfirmed',network_type='IPv4',connection_mode='connectionless',
              protocol_specific_settings=dict(loss_probability=x['loss_probability'],seed=x['seed'],burst=burst,pacing_ms=x.get('pacing_ms',0),readings=x['logical_readings'],maxRetries=x['maxRetries'],retryMs=x['retryMs']),
              source_references=['struct-source'],serialized_payload_bytes=9,decoding_verified=True,
              comparison_scope='controlled sink-drop delivery experiment; no database persistence or full-path packet-capture claim')
            r.update(logical_readings=x['logical_readings'],unique_readings_received=x['unique_readings_received'],responses_verified=x['responses_verified'],
              application_uplink_bytes=sum(len(bytes.fromhex(e['hex'])) for e in up),application_downlink_bytes=sum(len(bytes.fromhex(e['hex'])) for e in down),
              sender_send_attempts=attempts,sink_unobserved_attempts=attempts-len(up),actual_retransmitted_datagrams=x['actual_retransmitted_datagrams'],
              offered_sender_application_bytes=sum(y['frame_bytes']*y['attempts'] for y in x['outcomes']),
              proxy_observations=x['observations'],duration_ms=x['duration_ms'],delivery_success_rate=x['unique_readings_received']/x['logical_readings'],
              measurement_provenance={'application_uplink':'received actual datagrams at sink, including deliberately dropped requests',
                'application_downlink':'actual SDK send calls for non-dropped generated receipts; no receiver capture',
                'offered_sender_application_bytes':'SDK frame-buffer lengths times actual send attempts','total_network_bytes':'unknown; host losses and pre-send receipt drops prevent complete wire accounting'},
              outcome='host receive overload' if attempts>len(up) else 'configured impairment',decoded_values=case['values'])
            writer.write(r)
    writer.close()

def main():
    supplement()
    schemas=json.loads((BASE/'schemas/library.json').read_text(encoding='utf8'));sources={x['id'] for x in json.loads((BASE/'references/sources.json').read_text())}
    normalized=BASE/'results/normalized';normalized.mkdir(parents=True,exist_ok=True)
    summaries=BASE/'results/summaries';summaries.mkdir(parents=True,exist_ok=True)
    seen=set();counts=collections.Counter();stacks=collections.Counter();schema_ids=set();families={x['id']:x.get('family') for x in schemas}
    validation=[];failures=[];representative=[];sizes=[];coverage=collections.defaultdict(set);all_rows=[];per_file={};small=[];dtls_cache={}
    # A normalized stream excludes duplicated full values/byte blobs. Raw artifacts retain them.
    out_path=normalized/'records.ndjson.gz'
    with gzip.open(out_path,'wt',encoding='utf8',compresslevel=9) as output:
      for path in sorted((BASE/'results/raw').glob('*.ndjson')):
        if path.name=='lwm2m-java.ndjson':continue # intermediate native codec observations lack record contract
        file_counts=collections.Counter()
        for line_number,line in enumerate(path.open(encoding='utf8'),1):
            r=json.loads(line);assert r['test_id'] not in seen,('duplicate test id',r['test_id']);seen.add(r['test_id'])
            r['raw_artifact']=str(path.relative_to(BASE)).replace('\\','/')+'.gz';r['raw_line']=line_number
            for ref in r['source_references']:assert ref in sources,('unknown source reference',ref)
            if r['test_status']=='passed':
                assert r['decoding_verified'],r['test_id'];schema_ids.add(r['schema_id'])
                obs=r.get('observations',{})
                if 'DTLS' in str(r.get('security_configuration','')) or str(r.get('security_configuration','')).startswith('TLS_PSK_'):
                    context_key=(r['protocol_stack'],r['security_configuration'])
                    negotiation=r.get('connection_observations')
                    if not negotiation and r.get('connection_mode')=='new registration':
                        negotiation=[dict(direction=d,hex=h) for d,key in [('up','uplink_datagrams_hex'),('down','downlink_datagrams_hex')] for h in obs[key]]
                    params=dtls_parameters(negotiation) if negotiation else dtls_cache.get(context_key)
                    if params and params['cipher']:
                        dtls_cache[context_key]=params
                        r['negotiated_dtls_cipher']=params['cipher'];r['dtls_connection_id_bytes']=params['cid_bytes']
                        r['source_references'].append('iana-tls')
                        if 'ECDHE_PSK' in params['cipher']:r['source_references'].append('ecdhe-psk-rfc')
                        if any(params['cid_bytes'].values()):r['source_references'].append('dtls-cid-rfc')
                        layouts=[]
                        for d,key in [('up','uplink_datagrams_hex'),('down','downlink_datagrams_hex')]:
                            for h in obs[key]:layouts.extend(dict(direction=d,**x) for x in dtls_records(bytes.fromhex(h),params['cid_bytes'][d]))
                        r['dtls_record_layouts']=layouts
                if 'uplink_datagrams_hex' in obs:
                    up=[bytes.fromhex(x) for x in obs['uplink_datagrams_hex']];down=[bytes.fromhex(x) for x in obs['downlink_datagrams_hex']]
                    assert sum(map(len,up))==r['application_uplink_bytes']
                    assert sum(map(len,down))==r['application_downlink_bytes']
                    ip=20 if r['network_type']=='IPv4' else 40
                    assert r['total_uplink_bytes']==sum(map(len,up))+(8+ip)*len(up)
                    assert r['total_downlink_bytes']==sum(map(len,down))+(8+ip)*len(down)
                    assert r['total_network_bytes']==r['total_uplink_bytes']+r['total_downlink_bytes']
                if 'mqtt_uplink_hex' in obs:
                    packets=mqtt_packets(bytes.fromhex(obs['mqtt_uplink_hex']));pubs=[p for p in packets if p['type']==3]
                    assert len(pubs)==1,('expected one PUBLISH',r['test_id'],packets)
                    packet=pubs[0];body=packet['body'];topic_len=int.from_bytes(body[:2],'big');offset=2+topic_len
                    if (packet['flags']>>1)&3:offset+=2
                    if r['protocol_specific_settings']['mqtt_version']==5:
                        prop_len=0;mul=1
                        while True:
                            b=body[offset];offset+=1;prop_len+=(b&127)*mul;mul*=128
                            if not b&128:break
                        offset+=prop_len
                    assert len(body)-offset==r['serialized_payload_bytes'],('MQTT payload/framing disagreement',r['test_id'])
                    assert len(bytes.fromhex(obs['mqtt_uplink_hex']))==r['application_uplink_bytes']
                    r['mqtt_framing_crosscheck']=True
                if r.get('security_configuration','') in ['TLSv1.2','TLSv1.3'] and 'connection_downlink_hex' in obs:
                    r['negotiated_tls_cipher']=negotiated_cipher(obs['connection_downlink_hex'])
                if r.get('total_network_bytes') is not None:
                    r['traffic_scope']='steady-state exchange; initialization tracked separately where present'
                    conobs=r.get('connection_observations')
                    if conobs:
                        ip=20 if r['network_type']=='IPv4' else 40
                        initialization=sum(len(bytes.fromhex(x['hex']))+8+ip for x in conobs)
                        r['initialization_network_bytes']=initialization
                        r['total_with_initialization_network_bytes']=r['total_network_bytes']+initialization
                for k in ['security_configuration','delivery_mode','batch_size','network_type','connection_mode']:
                    coverage[k].add(str(r.get(k)))
            else:failures.append({k:r.get(k) for k in ['test_id','schema_id','protocol_stack','test_status','reason','raw_artifact','raw_line']})
            counts[r['test_status']]+=1;file_counts[r['test_status']]+=1
            if r['test_status']=='passed':stacks[r['protocol_stack']]+=1
            # Remove large raw observations from normalized records; preserve references.
            n={k:v for k,v in r.items() if k not in ['observations','proxy_observations','performance','connection_observations','sample_values','schema_definition','server_log','publish_latency_raw_ns','latency_raw_ns','response_outcomes','payload_hex','payload_hex_prefix','decoded_values','payload_sha256']}
            n['schema_reference']='schemas/library.json#'+r['schema_id']
            if 'performance' in r:
                perf=r['performance'];n['performance_summary']={}
                for key,value in perf.items():
                    if isinstance(value,dict) and 'median' in value:n['performance_summary'][key]={k:v for k,v in value.items() if k!='raw_sorted_ns'}
                    elif isinstance(value,list) and value:
                        v=sorted(value);n['performance_summary'][key]={'median_ns':v[len(v)//2],'p95_ns':v[math.ceil(.95*len(v))-1]}
            if r['schema_id'] in ['esp32-original','esp32-optimized'] and r['batch_size']==1 and r['test_status']=='passed':representative.append(n)
            if families.get(r['schema_id'])=='payload-size' and r['test_status']=='passed':sizes.append(n)
            output.write(json.dumps(n,separators=(',',':'),ensure_ascii=False)+'\n');all_rows.append(n)
        per_file[path.name]=dict(file_counts)
    summary=dict(dataset_version='1.0.0',generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
      total_configurations=len(seen),test_status_counts=dict(counts),unique_schema_value_cases=len(schema_ids),library_cases=len(schemas),
      distinct_schema_definitions=len({json.dumps(x['fields'],sort_keys=True,separators=(',',':')) for x in schemas if x['id'] in schema_ids}),
      successful_stacks=dict(stacks),per_runner=per_file,covered_axes={k:sorted(v) for k,v in coverage.items()},
      supplemental_checks={'C_ESP32_gateway_modes':4,'C_gateway_tampered_frames':4,'TLS_negative_configurations':2},
      scope='Configurations are not individual sensor readings or packets. Unsupported rows are attempted mappings/explicit capability exclusions, not successful transmissions.',
      coverage_complete_cross_product=False,packet_capture=False,validation_errors=validation)
    dump('results/summaries/coverage.json',summary);dump('results/summaries/failed-unsupported.json',failures)
    dump('results/summaries/representative.json',representative)
    columns=['test_id','protocol_stack','schema_id','precision_policy','security_configuration','delivery_mode','batch_size','network_type','connection_mode','serialized_payload_bytes','application_uplink_bytes','application_downlink_bytes','total_uplink_bytes','total_downlink_bytes','total_network_bytes','stream_uplink_bytes','stream_downlink_bytes','handshake_bytes','test_status']
    for name,rows in [('all',all_rows),('representative',representative),('payload-sizes',sizes)]:
        with (summaries/(name+'.csv')).open('w',encoding='utf8',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=columns,extrasaction='ignore');writer.writeheader();writer.writerows(rows)
        with (summaries/(name+'.csv')).open('rb') as src,gzip.open(summaries/(name+'.csv.gz'),'wb',compresslevel=9) as dst:
            while chunk:=src.read(1024*1024):dst.write(chunk)
    # Compress raw observations without deleting any originals. Originals are gitignored.
    artifacts=[]
    for path in sorted((BASE/'results/raw').iterdir()):
        if path.suffix not in ['.ndjson','.json']:continue
        destination=path.with_suffix(path.suffix+'.gz')
        with path.open('rb') as src,gzip.GzipFile(filename=str(destination),mode='wb',compresslevel=9,mtime=0) as dst:
            while chunk:=src.read(1024*1024):dst.write(chunk)
        artifacts.append(dict(path=str(destination.relative_to(BASE)).replace('\\','/'),uncompressed_bytes=path.stat().st_size,bytes=destination.stat().st_size,sha256=hashlib.sha256(destination.read_bytes()).hexdigest()))
    artifacts.append(dict(path=str(out_path.relative_to(BASE)).replace('\\','/'),bytes=out_path.stat().st_size,sha256=hashlib.sha256(out_path.read_bytes()).hexdigest()))
    dump('results/summaries/artifacts.json',dict(artifacts=artifacts,total_raw_uncompressed_bytes=sum(x.get('uncompressed_bytes',0) for x in artifacts),total_compressed_dataset_bytes=sum(x['bytes'] for x in artifacts)))
    print(json.dumps(summary,indent=2)[:9000]);print('Compressed bytes',sum(x['bytes'] for x in artifacts))
if __name__=='__main__':main()
