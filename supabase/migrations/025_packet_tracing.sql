alter table public.devices add column debug_trace_until timestamptz;
create table public.packet_traces (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references devices(id) on delete cascade,
 organization_id uuid not null references organizations(id) on delete cascade,
 created_at timestamptz not null default now(), trace jsonb not null
);
create index packet_trace_recent on packet_traces(device_id,created_at desc);
alter table packet_traces enable row level security;
grant select on packet_traces to authenticated;
grant all on packet_traces to service_role;
create policy packet_trace_read on packet_traces for select to authenticated using(is_org_member(organization_id));
create function public.enable_packet_tracing(p_device_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from devices where id=p_device_id and is_org_writer(organization_id)) then raise exception 'Not authorized'; end if;
 update devices set debug_trace_until=now()+interval '15 minutes' where id=p_device_id;
end $$;
create function public.record_packet_trace(p_device_id uuid,p_trace jsonb) returns void language plpgsql security definer set search_path=public as $$
declare d devices;
begin
 select * into d from devices where id=p_device_id for update;
 if d.debug_trace_until is null or d.debug_trace_until<=now() then return; end if;
 if octet_length(p_trace::text)>16384 then raise exception 'Trace too large'; end if;
 insert into packet_traces(device_id,organization_id,trace) values(d.id,d.organization_id,p_trace);
 delete from packet_traces where device_id=d.id and id in
   (select id from packet_traces where device_id=d.id order by created_at desc,id offset 200);
end $$;
-- Correlation is transactional. No timestamp-based guesses about which reading
-- produced a webhook. Links expire with telemetry retention.
create table public.trace_event_links (
 device_id uuid not null references devices(id) on delete cascade,
 event_key bytea not null, event_id uuid not null references telemetry(id) on delete cascade,
 primary key(device_id,event_key)
);
alter table trace_event_links enable row level security;
grant all on trace_event_links to service_role;
create function public.capture_trace_event() returns trigger language plpgsql set search_path=public as $$
begin perform set_config('struct.inserted_event',new.id::text,true); return new; end $$;
create trigger capture_trace_event after insert on telemetry for each row execute function capture_trace_event();
create function public.ingest_traced_telemetry(p_device_id uuid,p_nonce bytea,p_frame_timestamp timestamptz,p_frame_digest bytea,p_parsed_json jsonb,p_skew_seconds integer default 60,p_event_id bytea default null,p_event_digest bytea default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare inserted boolean; event uuid; identity bytea;
begin
 perform set_config('struct.inserted_event','',true);
 identity=case when p_event_id is null then decode('00','hex')||p_nonce||p_frame_digest else decode('01','hex')||p_event_id end;
 if p_event_id is null then inserted=ingest_device_telemetry(p_device_id,p_nonce,p_frame_timestamp,p_frame_digest,p_parsed_json,p_skew_seconds);
 else inserted=ingest_queued_telemetry(p_device_id,p_nonce,p_frame_timestamp,p_frame_digest,p_parsed_json,p_event_id,p_event_digest,p_skew_seconds); end if;
 if inserted then
  event=nullif(current_setting('struct.inserted_event',true),'')::uuid;
  insert into trace_event_links values(p_device_id,identity,event);
 else select event_id into event from trace_event_links where device_id=p_device_id and event_key=identity; end if;
 return jsonb_build_object('inserted',inserted,'event_id',event);
end $$;
revoke all on function enable_packet_tracing(uuid) from public,anon;
grant execute on function enable_packet_tracing(uuid) to authenticated;
revoke all on function record_packet_trace(uuid,jsonb),capture_trace_event(),ingest_traced_telemetry(uuid,bytea,timestamptz,bytea,jsonb,integer,bytea,bytea) from public,anon,authenticated;
grant execute on function record_packet_trace(uuid,jsonb),ingest_traced_telemetry(uuid,bytea,timestamptz,bytea,jsonb,integer,bytea,bytea) to service_role;
