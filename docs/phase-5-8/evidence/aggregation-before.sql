create function public.aggregate_metric_events(p_limit integer default 200) returns integer
language plpgsql security definer set search_path=public as $$declare e metric_events;g text;k text;n integer:=0;begin
 if not(select enabled from observability_settings where id) then return 0;end if;
 if p_limit not between 1 and 1000 then raise exception 'INVALID_AGGREGATION_LIMIT';end if;
 for e in select * from metric_events where processed_at is null order by id limit p_limit for update skip locked loop
  -- Do not wait while holding queue rows: another worker can own this tenant's rollups.
  if not pg_try_advisory_xact_lock(hashtextextended(e.organization_id::text,5088)) then continue;end if;
  k:=md5(jsonb_build_array(e.device_id,e.destination_id,e.schema_slot,e.kind,e.group_ids,e.labels,e.ip_version)::text);
  foreach g in array array['minute','hour','day'] loop
   insert into usage_rollups(organization_id,grain,bucket,dimension,device_id,destination_id,schema_slot,kind,group_ids,labels,ip_version,
    observations,packets,readings,payload_bytes,app_bytes,framing_bytes,security_bytes,receipt_bytes,known_app_packets,unknown_app_packets,processing_count,processing_ms)
   values(e.organization_id,g,date_trunc(g,e.observed_at,'UTC'),k,e.device_id,e.destination_id,e.schema_slot,e.kind,e.group_ids,e.labels,e.ip_version,
    1,case when e.kind in ('commit','duplicate','rejected') then 1 else 0 end,e.readings,coalesce(e.payload_bytes,0),coalesce(e.app_bytes,0),coalesce(e.framing_bytes,0),coalesce(e.security_bytes,0),e.receipt_bytes,
    case when e.app_bytes is not null then 1 else 0 end,case when e.kind in ('commit','historical') and e.app_bytes is null then 1 else 0 end,
    case when e.processing_ms is not null then 1 else 0 end,coalesce(e.processing_ms,0))
   on conflict(organization_id,grain,bucket,dimension) do update set
    observations=usage_rollups.observations+excluded.observations,packets=usage_rollups.packets+excluded.packets,readings=usage_rollups.readings+excluded.readings,payload_bytes=usage_rollups.payload_bytes+excluded.payload_bytes,
    app_bytes=usage_rollups.app_bytes+excluded.app_bytes,framing_bytes=usage_rollups.framing_bytes+excluded.framing_bytes,security_bytes=usage_rollups.security_bytes+excluded.security_bytes,
    receipt_bytes=usage_rollups.receipt_bytes+excluded.receipt_bytes,known_app_packets=usage_rollups.known_app_packets+excluded.known_app_packets,
    unknown_app_packets=usage_rollups.unknown_app_packets+excluded.unknown_app_packets,processing_count=usage_rollups.processing_count+excluded.processing_count,processing_ms=usage_rollups.processing_ms+excluded.processing_ms;
  end loop;
  update metric_events set processed_at=now() where id=e.id;n:=n+1;
 end loop;return n;
end $$;

