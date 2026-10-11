"""Derive additive calculator records without rewriting original observations."""
import pathlib,json,gzip,collections
BASE=pathlib.Path(__file__).parent
records=[];schemas={}
for name in ['mqtt','coap','struct']:
    with gzip.open(BASE/f'{name}-observations.ndjson.gz','rt',encoding='utf8') as stream:
        for line_number,line in enumerate(stream,1):
            row=json.loads(line)
            if name=='struct':
                sid=f"{row['schema_id']}-lab-{row['precision']}"
                schemas[sid]={'id':sid,'fields':row['schema_definition'],'values':row['sample_values'],
                              'precision_policy':row['precision'],'family':'extension'}
                row.update(schema_id=sid,protocol_category='Struct',protocol_stack='Secure V2' if row['security'] else 'V2-compatible plaintext LAB ONLY',
                    implementation='Struct Node SDK / generated C parity / real gateway / PGlite',implementation_version=row['environment']['git'],
                    specification_version='Struct Secure V2' if row['security'] else 'Struct SLB0 benchmark-only v1',
                    precision_policy=row['precision'],security_enabled=row['security'],security_configuration='ChaCha20-Poly1305' if row['security'] else None,
                    delivery_mode=row['delivery'],network_type=row['network'],protocol_specific_settings={'encoding':row['encoding'],'plaintext_lab_only':not row['security']},
                    environment_metadata=row['environment'],decoded_readings_count=row['batch_size'],precision_error=row['numerical_errors'],
                    total_network_bytes=row['total_uplink_bytes']+row['total_downlink_bytes'],
                    comparison_scope='UDP datagrams measured, IP headers calculated; lab plaintext not production-supported')
            row['raw_artifact']=f'extensions/lab-v2/{name}-observations.ndjson.gz'
            row['raw_line']=line_number
            # Keep complete bytes in raw observations. Derived index whitelist is separate.
            records.append(row)
assert len({r['test_id'] for r in records})==len(records)
with gzip.open(BASE/'records.ndjson.gz','wt',encoding='utf8') as stream:
    for row in records:stream.write(json.dumps(row,separators=(',',':'))+'\n')
(BASE/'schemas.json').write_text(json.dumps(list(schemas.values()),indent=2),encoding='utf8')
summary={'version':'2.0.0-lab-coverage','total':len(records),'statuses':dict(collections.Counter(r['test_status'] for r in records)),
         'stacks':dict(collections.Counter(r['protocol_stack'] for r in records)),'raw_size_bytes':sum(p.stat().st_size for p in BASE.glob('*observations.ndjson.gz'))}
(BASE/'measurement-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
print(json.dumps(summary))
