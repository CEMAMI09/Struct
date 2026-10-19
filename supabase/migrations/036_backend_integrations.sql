-- Phase 7: additive, default off, no historical delivery or production activation.
create table public.integration_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into public.integration_settings values(true,false);
alter table public.integration_settings enable row level security;
grant all on public.integration_settings to service_role;
alter table public.destinations add column integration_managed boolean not null default false;
grant select(integration_managed) on public.destinations to authenticated;
-- Managed destinations may only change through versioned server APIs.
create function public.protect_managed_destination() returns trigger language plpgsql set search_path=public as $$begin
 if old.integration_managed and current_user in ('authenticated','anon') then raise exception 'Managed integration requires integration API';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger protect_managed_destination before update or delete on public.destinations for each row execute function public.protect_managed_destination();
revoke all on function public.protect_managed_destination() from public,anon,authenticated;
create table public.integration_definitions(
 destination_id uuid primary key references public.destinations on delete cascade,
 organization_id uuid not null references public.organizations on delete cascade,
 kind text not null check(kind in ('http','aws_sqs','aws_eventbridge','azure_service_bus','google_pubsub','postgresql')),
 version integer not null default 1,
 config jsonb not null check(octet_length(config::text)<=16384),
 route jsonb check(octet_length(route::text)<=16384),
 mapping jsonb not null check(octet_length(mapping::text)<=16384),
 credentials_encrypted text not null check(length(credentials_encrypted)<=50000),
 deleted_at timestamptz,updated_at timestamptz not null default now(),
 last_check jsonb,last_checked_at timestamptz
);
create index integrations_org on public.integration_definitions(organization_id) where deleted_at is null;
alter table public.integration_definitions enable row level security;
-- No browser table grants, including ciphertext; all access uses authorized APIs.
grant all on public.integration_definitions to service_role;
create table public.integration_audit(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations on delete cascade,
 destination_id uuid,actor_id uuid,action text not null,version integer,created_at timestamptz not null default now()
);
create index integration_audit_org_time on public.integration_audit(organization_id,created_at desc);
alter table public.integration_audit enable row level security;
create policy integration_audit_read on public.integration_audit for select to authenticated using(is_org_member(organization_id));
grant select on public.integration_audit to authenticated;
grant all on public.integration_audit to service_role;
grant usage,select on sequence public.integration_audit_id_seq to service_role;
alter table public.webhook_deliveries add column integration_snapshot jsonb;
-- Snapshot is nonsecret, but accessed only through an authorized detail API.

create function public.integration_match(rule jsonb,event jsonb,depth integer default 0) returns boolean
language plpgsql immutable set search_path=public as $$
declare item jsonb;actual jsonb;expected jsonb;field text;op text;left_number numeric;right_number numeric;begin
 if rule is null or rule='null'::jsonb then return depth=0;end if;
 if depth>5 or jsonb_typeof(rule)<>'object' or octet_length(rule::text)>16384 then return false;end if;
 if rule ? 'all' or rule ? 'any' then
  item:=coalesce(rule->'all',rule->'any');
  if jsonb_typeof(item)<>'array' or jsonb_array_length(item) not between 1 and 16 then return false;end if;
  for item in select value from jsonb_array_elements(item) loop
   if rule ? 'all' and not integration_match(item,event,depth+1) then return false;end if;
   if rule ? 'any' and integration_match(item,event,depth+1) then return true;end if;
  end loop;
  return rule ? 'all';
 end if;
 field:=rule->>'field';op:=rule->>'op';expected:=rule->'value';
 if field !~ '^(payload\.[a-zA-Z0-9_.-]+|device_id|schema_slot|schema_version|event_type)$' then return false;end if;
 actual:=event #> string_to_array(field,'.');
 if op='exists' then return actual is not null and actual<>'null'::jsonb;end if;
 if actual is null or actual='null'::jsonb or expected is null then return false;end if;
 if op='eq' then return actual=expected;end if;
 if op='ne' then return actual<>expected;end if;
 if op='contains' then return jsonb_typeof(actual)='string' and jsonb_typeof(expected)='string' and position((expected#>>'{}') in (actual#>>'{}'))>0;end if;
 if (actual#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?$' or (expected#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then return false;end if;
 left_number:=(actual#>>'{}')::numeric;right_number:=(expected#>>'{}')::numeric;
 return case op when 'gt' then left_number>right_number when 'gte' then left_number>=right_number when 'lt' then left_number<right_number when 'lte' then left_number<=right_number else false end;
exception when others then return false;
end $$;

create function public.save_integration(p_org_id uuid,p_actor_id uuid,p_destination_id uuid,p_name text,p_kind text,
 p_config jsonb,p_route jsonb,p_mapping jsonb,p_credentials text,p_expected_version integer,p_enabled boolean)
returns integer language plpgsql security definer set search_path=public as $$
declare current integration_definitions;new_version integer;begin
 if not exists(select 1 from organization_members where organization_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) then raise exception 'Not authorized';end if;
 if not (select enabled from integration_settings where id) or not (select enabled from delivery_pipeline_settings where id) then raise exception 'INTEGRATIONS_DISABLED';end if;
 if length(p_name) not between 1 and 100 or p_enabled is null then raise exception 'Invalid integration';end if;
 perform 1 from organizations where id=p_org_id for update;
 if (select count(*) from integration_audit where organization_id=p_org_id and created_at>now()-interval '1 minute')>=30 then raise exception 'INTEGRATION_RATE_LIMIT';end if;
 if p_route is not null and p_route<>'null'::jsonb and not org_has_entitlement(p_org_id,'logical_routing') then raise exception 'Logical routing requires Scale';end if;
 select * into current from integration_definitions where destination_id=p_destination_id for update;
 if found then
  if current.organization_id<>p_org_id or current.deleted_at is not null then raise exception 'Not authorized';end if;
  if current.version<>p_expected_version or current.kind<>p_kind then raise exception 'CONFIG_VERSION_CONFLICT';end if;
  new_version:=current.version+1;
  update integration_definitions set version=new_version,config=p_config,route=p_route,mapping=p_mapping,
   credentials_encrypted=coalesce(p_credentials,credentials_encrypted),updated_at=now(),last_check=null,last_checked_at=null where destination_id=p_destination_id;
  update destinations set name=p_name,enabled=p_enabled where id=p_destination_id;
 else
  if p_expected_version<>0 or p_credentials is null then raise exception 'Invalid new integration';end if;
  if (select count(*) from integration_definitions where organization_id=p_org_id and deleted_at is null)>=20 then raise exception 'Integration safety limit: 20 destinations per workspace';end if;
  new_version:=1;
  insert into destinations(id,user_id,organization_id,name,url,signing_secret,enabled,integration_managed,event_types)
   values(p_destination_id,p_actor_id,p_org_id,p_name,'https://integration.invalid/'||p_destination_id,'integration-secret-is-server-only',false,true,array['telemetry.received']);
  insert into integration_definitions(destination_id,organization_id,kind,config,route,mapping,credentials_encrypted)
   values(p_destination_id,p_org_id,p_kind,p_config,p_route,p_mapping,p_credentials);
  -- New integrations must be reviewed and enabled by a subsequent explicit action.
 end if;
 insert into integration_audit(organization_id,destination_id,actor_id,action,version)values(p_org_id,p_destination_id,p_actor_id,'save',new_version);
 return new_version;
end $$;

create function public.integration_action(p_org_id uuid,p_actor_id uuid,p_id uuid,p_version integer,p_action text,p_result jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
declare current integration_definitions;begin
 if not exists(select 1 from organization_members where organization_id=p_org_id and user_id=p_actor_id and role in ('owner','admin')) then raise exception 'Not authorized';end if;
 perform 1 from organizations where id=p_org_id for update;
 select * into current from integration_definitions where destination_id=p_id and organization_id=p_org_id and deleted_at is null for update;
 if not found then raise exception 'Not authorized';end if;
 if current.version<>p_version then raise exception 'CONFIG_VERSION_CONFLICT';end if;
 if (select count(*) from integration_audit where organization_id=p_org_id and created_at>now()-interval '1 minute')>=30 then raise exception 'INTEGRATION_RATE_LIMIT';end if;
 if p_action='enable' then
  if not (select enabled from integration_settings where id) then raise exception 'INTEGRATIONS_DISABLED';end if;
  update destinations set enabled=true,paused_at=null where id=p_id;
 elsif p_action='disable' then update destinations set enabled=false where id=p_id;
 elsif p_action='pause' then update destinations set paused_at=now() where id=p_id;
 elsif p_action='resume' then update destinations set paused_at=null where id=p_id;
 elsif p_action='delete' then
  update destinations set enabled=false where id=p_id;
  update integration_definitions set deleted_at=now(),credentials_encrypted='deleted',last_check=null where destination_id=p_id;
 elsif p_action='check' then
  update integration_definitions set last_check=p_result,last_checked_at=now() where destination_id=p_id;
 elsif p_action<>'test_send' then raise exception 'Invalid integration action';end if;
 insert into integration_audit(organization_id,destination_id,actor_id,action,version)values(p_org_id,p_id,p_actor_id,p_action,p_version);
end $$;

-- Gate old workers before they can claim adapter work, without changing leases/retries.
alter function public.claim_webhook_deliveries_v2(integer) rename to claim_delivery_base;
create function public.claim_webhook_deliveries_v2(p_limit integer default 8) returns setof public.webhook_deliveries
language plpgsql security definer set search_path=public as $$begin
 if (select enabled from integration_settings where id) then raise exception 'UPGRADE_INTEGRATION_WORKER';end if;
 return query select * from claim_delivery_base(p_limit);
end $$;
create function public.claim_integration_deliveries(p_limit integer default 8) returns setof public.webhook_deliveries
language plpgsql security definer set search_path=public as $$begin
 return query select * from claim_delivery_base(p_limit);
end $$;
revoke all on function public.claim_delivery_base(integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_webhook_deliveries_v2(integer),public.claim_integration_deliveries(integer),public.save_integration(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,text,integer,boolean),public.integration_action(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_webhook_deliveries_v2(integer),public.claim_integration_deliveries(integer),public.save_integration(uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,text,integer,boolean),public.integration_action(uuid,uuid,uuid,integer,text,jsonb) to service_role;
revoke all on function public.integration_match(jsonb,jsonb,integer) from public,anon;
grant execute on function public.integration_match(jsonb,jsonb,integer) to authenticated,service_role;

-- Explicit recovery only: retain original target/rule, deliberately replace the
-- failed job's mapping with the reviewed current mapping and audit that decision.
create function public.integration_remap_failed(p_org_id uuid,p_destination_id uuid,p_version integer,p_request_id uuid,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare definition integration_definitions;ids uuid[];previous delivery_actions;begin
 if not is_org_writer(p_org_id) then raise exception 'Not authorized';end if;
 if not (select enabled from integration_settings where id) or not (select enabled from delivery_pipeline_settings where id) then raise exception 'INTEGRATIONS_DISABLED';end if;
 if p_request_id is null or p_confirm is null then raise exception 'Invalid recovery request';end if;
 perform 1 from organizations where id=p_org_id for update;
 select * into definition from integration_definitions where destination_id=p_destination_id and organization_id=p_org_id and deleted_at is null for share;
 if not found then raise exception 'Not authorized';end if;
 if definition.version<>p_version then raise exception 'CONFIG_VERSION_CONFLICT';end if;
 select * into previous from delivery_actions where organization_id=p_org_id and request_id=p_request_id;
 if found and previous.action=('mapping_retry:'||p_destination_id||':'||p_version) then
  return jsonb_build_object('scheduled',cardinality(previous.delivery_ids),'duplicate_request',true);
 end if;
 if previous.id is not null and previous.action<>('mapping_preview:'||p_destination_id||':'||p_version) then raise exception 'REQUEST_ID_CONFLICT';end if;
 if previous.id is not null and previous.created_at<now()-interval '10 minutes' then raise exception 'RECOVERY_PREVIEW_EXPIRED';end if;
 if previous.id is null and p_confirm then raise exception 'RECOVERY_PREVIEW_REQUIRED';end if;
 if previous.id is null and (select count(*) from delivery_actions where organization_id=p_org_id and created_at>now()-interval '1 minute')>=20 then raise exception 'RECOVERY_RATE_LIMIT';end if;
 perform 1 from destinations where id=p_destination_id and organization_id=p_org_id and enabled and paused_at is null for share;
 if not found then raise exception 'Destination must be enabled and unpaused';end if;
 select array_agg(id) into ids from (select id from webhook_deliveries where destination_id=p_destination_id and organization_id=p_org_id
  and status='dead' and integration_snapshot is not null and body is not null and payload_expires_at>now() and replay_count<3
  and (previous.id is null or id=any(previous.delivery_ids))
  order by created_at,id limit 100 for update) eligible;
 ids:=coalesce(ids,'{}'::uuid[]);
 if not p_confirm then
  if previous.id is null then insert into delivery_actions(organization_id,actor_id,request_id,action,delivery_ids)
   values(p_org_id,auth.uid(),p_request_id,'mapping_preview:'||p_destination_id||':'||p_version,ids);end if;
  return jsonb_build_object('eligible',cardinality(ids),'ids',ids,'mapping_version',p_version);
 end if;
 update webhook_deliveries set integration_snapshot=jsonb_set(jsonb_set(integration_snapshot,'{mapping}',definition.mapping),'{mapping_version}',to_jsonb(p_version)),
  status='pending',attempts=0,replay_count=replay_count+1,next_attempt_at=now(),retry_deadline=least(payload_expires_at,now()+interval '24 hours'),
  terminal_reason=null,last_error=null,error_category=null,updated_at=now() where id=any(ids);
 update delivery_actions set action='mapping_retry:'||p_destination_id||':'||p_version,delivery_ids=ids where id=previous.id;
 return jsonb_build_object('scheduled',cardinality(ids),'duplicate_request',false);
end $$;
revoke all on function public.integration_remap_failed(uuid,uuid,integer,uuid,boolean) from public,anon;
grant execute on function public.integration_remap_failed(uuid,uuid,integer,uuid,boolean) to authenticated;

create or replace function public.enqueue_telemetry_webhooks() returns trigger
language plpgsql security definer set search_path=public as $$
declare integration record; decision jsonb; schema_version integer;
begin
 insert into telemetry_events(id,organization_id,device_id,device_name,sample_at,protocol,wire_device_id,sequence,record_index,schema_slot)
 select new.id,d.organization_id,d.id,d.name,new.timestamp,
 case when new.secure_v2_wire_device_id is not null then 'secure-v2' else 'legacy' end,
 new.secure_v2_wire_device_id,new.secure_v2_sequence,new.secure_v2_record_index,new.secure_v2_schema_slot
 from devices d where d.id=new.device_id;
 insert into webhook_deliveries(event_id,organization_id,destination_id,destination_url,body,routing_rule,device_id)
 select new.id,d.organization_id,dest.id,dest.url,
 jsonb_build_object('id',new.id,'type','telemetry.received','device_id',d.id,'device_name',d.name,'timestamp',new.timestamp,'payload',new.parsed_json),
 case when o.subscription_tier='scale' then dest.routing_rule else null end,d.id
 from devices d join organizations o on o.id=d.organization_id
 join destinations dest on dest.organization_id=d.organization_id
 where d.id=new.device_id and not dest.integration_managed and dest.enabled and 'telemetry.received'=any(dest.event_types)
 and (dest.device_id is null or dest.device_id=d.id);
 if (select enabled from integration_settings where id) then
  select legacy_schema_version into schema_version from secure_v2_schema_slots where device_id=new.device_id and slot=new.secure_v2_schema_slot;
  decision:=jsonb_build_object('payload',new.parsed_json,'device_id',new.device_id,'event_type','telemetry.received','schema_slot',new.secure_v2_schema_slot,'schema_version',schema_version);
  for integration in select i.*,d.url from integration_definitions i join destinations d on d.id=i.destination_id
   join devices device on device.id=new.device_id and device.organization_id=i.organization_id
   where d.enabled and i.deleted_at is null loop
   -- A downgrade fails closed for restricted rules instead of broadcasting more data.
   if integration.route is not null and integration.route<>'null'::jsonb and not org_has_entitlement(integration.organization_id,'logical_routing') then continue;end if;
   if not integration_match(integration.route,decision) then continue;end if;
   insert into webhook_deliveries(event_id,organization_id,destination_id,destination_url,device_id,body,integration_snapshot)
   select new.id,integration.organization_id,integration.destination_id,integration.url,new.device_id,
    jsonb_build_object('id',new.id,'type','telemetry.received','device_id',new.device_id,'device_name',device.name,'timestamp',new.timestamp,'payload',new.parsed_json),
    jsonb_build_object('kind',integration.kind,'version',integration.version,'config',integration.config,'route',integration.route,'mapping',integration.mapping,'schema_slot',new.secure_v2_schema_slot,'schema_version',schema_version,'matched_at',now())
   from devices device where device.id=new.device_id
   on conflict(event_id,destination_id) do nothing;
  end loop;
 end if;
 return new;
end $$;



alter table public.webhook_attempts add column provider_receipt text check(length(provider_receipt)<=128);
create function public.finish_integration_delivery(p_id uuid,p_token uuid,p_outcome text,p_detail text default null,
 p_http_status integer default null,p_error_category text default null,p_latency_ms integer default null,p_retry_after_seconds integer default null,p_provider_receipt text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare accepted boolean;begin
 if p_provider_receipt is not null and p_provider_receipt !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'Invalid provider receipt';end if;
 accepted:=finish_webhook_delivery_v2(p_id,p_token,p_outcome,p_detail,p_http_status,p_error_category,p_latency_ms,p_retry_after_seconds);
 if accepted then update webhook_attempts set provider_receipt=p_provider_receipt where delivery_id=p_id and lease_token=p_token;end if;
 return accepted;
end $$;
revoke all on function public.finish_integration_delivery(uuid,uuid,text,text,integer,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.finish_integration_delivery(uuid,uuid,text,text,integer,text,integer,integer,text) to service_role;

create or replace function public.delivery_event_detail(p_org_id uuid,p_event_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_org_member(p_org_id) then raise exception 'Not authorized';end if;
 if not exists(select 1 from webhook_deliveries where organization_id=p_org_id and event_id=p_event_id) and not exists(select 1 from telemetry_events where organization_id=p_org_id and id=p_event_id) then raise exception 'Event unavailable';end if;
 return jsonb_build_object('traces',(select coalesce(jsonb_agg(x.trace),'[]') from (select p.trace from packet_traces p where p.organization_id=p_org_id and (p.trace->>'event_id'=p_event_id::text or p.trace->'event_ids' ? p_event_id::text) order by p.created_at desc limit 5) x),'event',(select to_jsonb(e) from telemetry_events e where e.id=p_event_id and e.organization_id=p_org_id),
 'deliveries',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,event_id,destination_id,integration_snapshot,status,created_at,updated_at,last_attempt_at,next_attempt_at,delivered_at,total_attempts,terminal_reason,last_error from webhook_deliveries where event_id=p_event_id and organization_id=p_org_id) x),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.attempted_at),'[]') from (select a.id,a.delivery_id,a.attempt_number,a.attempted_at,a.completed_at,a.outcome,a.detail,a.http_status,a.error_category,a.latency_ms,a.next_retry_at,a.provider_receipt
 from webhook_attempts a join webhook_deliveries w on w.id=a.delivery_id where w.organization_id=p_org_id and w.event_id=p_event_id order by a.attempted_at limit 1000) x),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select a.id,a.action,a.created_at from delivery_actions a where a.organization_id=p_org_id and exists(select 1 from webhook_deliveries w where w.event_id=p_event_id and w.organization_id=p_org_id and w.id=any(a.delivery_ids)) order by a.created_at desc limit 100) x));
end $$;


create or replace function public.purge_expired_telemetry() returns bigint language plpgsql security definer set search_path=public as $$
declare deleted_count bigint;
begin
 update webhook_deliveries set body=null,status=case when status in ('pending','sending') then 'dead' else status end,
  terminal_reason=case when status in ('pending','sending') then 'payload_expired' else terminal_reason end,
  last_error=case when status in ('pending','sending') then 'Recovery payload expired after seven days' else last_error end,
  lease_until=null,lease_token=null,updated_at=now() where payload_expires_at<=now() and body is not null;
 update webhook_attempts a set outcome='unknown',completed_at=now(),error_category='policy',detail='Payload expired; remote outcome may be unknown'
  from webhook_deliveries w where a.delivery_id=w.id and a.outcome='dispatching' and w.body is null;
 delete from webhook_deliveries where created_at<now()-interval '30 days' and status not in ('pending','sending');
 delete from telemetry_events where accepted_at<now()-interval '30 days';
 delete from integration_audit where created_at<now()-interval '30 days';
 delete from delivery_actions where created_at<now()-interval '30 days';
 delete from packet_traces p using organizations o where p.organization_id=o.id and p.created_at<now()-make_interval(days=>public.telemetry_retention_days(o.id));
 delete from telemetry t using devices d where t.device_id=d.id and t.timestamp<now()-make_interval(days=>public.telemetry_retention_days(d.organization_id));
 get diagnostics deleted_count=row_count;
 delete from device_replay_nonces where expires_at<now()-interval '1 hour';
 return deleted_count;
end $$;

