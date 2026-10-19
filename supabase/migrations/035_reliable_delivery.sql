-- Phase 3/4: additive, NOT applied automatically. Requires explicit worker rollout.
alter table public.destinations add column paused_at timestamptz;
grant select(paused_at) on public.destinations to authenticated;
alter table public.telemetry add column secure_v2_schema_slot integer;
create table public.telemetry_events (
 id uuid primary key, organization_id uuid not null references public.organizations on delete cascade,
 device_id uuid references public.devices on delete set null, device_name text,
 accepted_at timestamptz not null default now(), sample_at timestamptz not null,
 protocol text not null, wire_device_id bigint, sequence bigint, record_index integer, schema_slot integer
);
create index telemetry_events_org_time on public.telemetry_events(organization_id,accepted_at desc,id);
create index telemetry_events_device_time on public.telemetry_events(device_id,accepted_at desc);
alter table public.telemetry_events enable row level security;
create policy event_read on public.telemetry_events for select to authenticated using(public.is_org_member(organization_id));
grant select on public.telemetry_events to authenticated;
grant all on public.telemetry_events to service_role;

alter table public.webhook_deliveries
 add column device_id uuid references public.devices on delete set null,
 add column total_attempts integer not null default 0,
 add column updated_at timestamptz not null default now(),
 add column last_attempt_at timestamptz,
 add column error_category text,
 add column http_status integer,
 add column terminal_reason text,
 add column payload_expires_at timestamptz not null default (now()+interval '7 days'),
 add column retry_deadline timestamptz not null default (now()+interval '24 hours');
alter table public.webhook_deliveries alter column body drop not null;
-- Existing work is retained, never automatically replayed. Original age is honored.
update public.webhook_deliveries set total_attempts=attempts,
 device_id=nullif(body->>'device_id','')::uuid,
 payload_expires_at=created_at+interval '7 days',retry_deadline=created_at+interval '24 hours';
create index webhook_org_history on public.webhook_deliveries(organization_id,created_at desc,id);
create index webhook_org_status on public.webhook_deliveries(organization_id,status,next_attempt_at);
create index webhook_event on public.webhook_deliveries(event_id);
create index webhook_destination_ready on public.webhook_deliveries(destination_id,next_attempt_at) where status in ('pending','sending');
create index webhook_expired_leases on public.webhook_deliveries(lease_until) where status='sending';
grant select(device_id,total_attempts,updated_at,last_attempt_at,error_category,http_status,terminal_reason,payload_expires_at,retry_deadline) on public.webhook_deliveries to authenticated;

alter table public.webhook_attempts add column attempt_number integer,
 add column lease_token uuid, add column completed_at timestamptz,
 add column http_status integer, add column error_category text,
 add column latency_ms integer check(latency_ms between 0 and 60000),
 add column next_retry_at timestamptz;
create unique index webhook_attempt_lease on public.webhook_attempts(delivery_id,lease_token) where lease_token is not null;
create index webhook_attempt_history on public.webhook_attempts(delivery_id,attempted_at desc);
create index webhook_attempt_recent on public.webhook_attempts(attempted_at desc);
-- Adding a column to an existing table-level SELECT grant would expose lease
-- tokens through direct REST selects, even though the new read RPCs omit them.
revoke select on public.webhook_attempts from authenticated;
grant select(id,delivery_id,attempted_at,outcome,detail,attempt_number,completed_at,http_status,error_category,latency_ms,next_retry_at)
 on public.webhook_attempts to authenticated;

create table public.delivery_pipeline_settings(id boolean primary key default true check(id), enabled boolean not null default false,
 max_pending_per_tenant integer not null default 100000 check(max_pending_per_tenant between 1 and 1000000));
insert into public.delivery_pipeline_settings(id,enabled) values(true,false);
create table public.webhook_destination_runtime(
 destination_id uuid primary key references public.destinations on delete cascade,
 next_dispatch_at timestamptz not null default now(), last_claimed_at timestamptz
);
create table public.webhook_tenant_runtime(
 organization_id uuid primary key references public.organizations on delete cascade,
 last_claimed_at timestamptz
);
insert into public.webhook_destination_runtime(destination_id) select id from public.destinations;
create function public.register_destination_runtime() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into webhook_destination_runtime(destination_id) values(new.id) on conflict do nothing;
 return new;
end $$;
create trigger register_destination_runtime after insert on public.destinations for each row execute function public.register_destination_runtime();
revoke all on function public.register_destination_runtime() from public,anon,authenticated;
create table public.delivery_actions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
 actor_id uuid not null, request_id uuid not null, action text not null,
 delivery_ids uuid[] not null, created_at timestamptz not null default now(),
 unique(organization_id,request_id)
);
alter table public.delivery_actions enable row level security;
create policy delivery_action_read on public.delivery_actions for select to authenticated using(public.is_org_member(organization_id));
grant select on public.delivery_actions to authenticated;
grant all on public.delivery_actions,public.delivery_pipeline_settings,public.webhook_destination_runtime,public.webhook_tenant_runtime to service_role;
alter table public.delivery_pipeline_settings enable row level security;
alter table public.webhook_destination_runtime enable row level security;
alter table public.webhook_tenant_runtime enable row level security;

create or replace function public.enqueue_telemetry_webhooks() returns trigger
language plpgsql security definer set search_path=public as $$
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
 where d.id=new.device_id and dest.enabled and 'telemetry.received'=any(dest.event_types)
 and (dest.device_id is null or dest.device_id=d.id);
 return new;
end $$;

create function public.delivery_pipeline_health() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('version',2,'enabled',(select enabled from delivery_pipeline_settings where id),
 'pending',(select count(*) from webhook_deliveries where status='pending'),
 'sending',(select count(*) from webhook_deliveries where status='sending'),
 'dead',(select count(*) from webhook_deliveries where status='dead'),
 'expired_leases',(select count(*) from webhook_deliveries where status='sending' and lease_until<now()),
 'oldest_pending',(select min(created_at) from webhook_deliveries where status='pending'),
 'attempts_last_minute',(select count(*) from webhook_attempts where attempted_at>now()-interval '1 minute'),
 'successes_last_minute',(select count(*) from webhook_attempts where completed_at>now()-interval '1 minute' and outcome='delivered'),
 'retries_last_minute',(select count(*) from webhook_attempts where completed_at>now()-interval '1 minute' and outcome='retry'),
 'unknown_last_minute',(select count(*) from webhook_attempts where completed_at>now()-interval '1 minute' and outcome='unknown'),
 'mean_latency_ms_last_minute',(select avg(latency_ms) from webhook_attempts where attempted_at>now()-interval '1 minute'),
 'max_pending_per_tenant',(select max_pending_per_tenant from delivery_pipeline_settings where id))
$$;

create function public.claim_webhook_deliveries_v2(p_limit integer default 8)
returns setof public.webhook_deliveries language plpgsql security definer set search_path=public as $$
declare expired webhook_deliveries; tenant record; endpoint record; job webhook_deliveries; claimed integer:=0; tenant_active integer;
begin
 if not (select enabled from delivery_pipeline_settings where id) then raise exception 'DELIVERY_PIPELINE_DISABLED'; end if;
 -- Bounded maintenance, persisted uncertainty, and token fencing after a crash.
 for expired in select * from webhook_deliveries where status='sending' and lease_until<=now()
 order by lease_until limit 64 for update skip locked loop
  update webhook_attempts set completed_at=now(),outcome='unknown',error_category='lease_expired',
   detail='Worker lease expired; remote outcome unknown' where delivery_id=expired.id and lease_token=expired.lease_token;
  update webhook_deliveries set status=case when attempts>=8 or retry_deadline<=now() then 'dead' else 'pending' end,
   terminal_reason=case when attempts>=8 then 'attempt_limit' when retry_deadline<=now() then 'retry_age' end,
   error_category='lease_expired',last_error='Worker lease expired; delivery may have reached the receiver',
   lease_until=null,lease_token=null,next_attempt_at=now(),updated_at=now() where id=expired.id;
 end loop;
 with overdue as (select id from webhook_deliveries where status='pending' and (retry_deadline<=now() or payload_expires_at<=now() or attempts>=8)
 order by next_attempt_at limit 128 for update skip locked)
 update webhook_deliveries w set status='dead',updated_at=now(),terminal_reason=case when payload_expires_at<=now() then 'payload_expired' when attempts>=8 then 'attempt_limit' else 'retry_age' end,
 error_category='policy',last_error='Automatic delivery policy exhausted; inspect and retry while payload remains available' from overdue where w.id=overdue.id;
 -- Runtime rows are seeded in this migration and maintained by insert/capacity
 -- triggers; avoid rescanning the entire pending backlog on every worker poll.
 -- One tenant lock serializes its claimers; destination locks serialize endpoint capacity across workers.
 for tenant in select r.organization_id from webhook_tenant_runtime r where exists(
  select 1 from webhook_deliveries w join destinations d on d.id=w.destination_id join webhook_destination_runtime dr on dr.destination_id=d.id where w.organization_id=r.organization_id and w.status='pending' and w.next_attempt_at<=now() and d.paused_at is null and dr.next_dispatch_at<=now())
 order by r.last_claimed_at nulls first limit 64 for update skip locked loop
  select count(*) into tenant_active from webhook_deliveries where organization_id=tenant.organization_id and status='sending' and lease_until>now();
  if tenant_active>=8 then continue; end if;
  for endpoint in select r.destination_id from webhook_destination_runtime r join destinations d on d.id=r.destination_id
   where d.organization_id=tenant.organization_id and d.paused_at is null and r.next_dispatch_at<=now()
   and exists(select 1 from webhook_deliveries w where w.destination_id=d.id and w.status='pending' and w.next_attempt_at<=now())
   order by r.last_claimed_at nulls first limit 32 for update of r skip locked loop
   if exists(select 1 from webhook_deliveries where destination_id=endpoint.destination_id and status='sending' and lease_until>now()) then continue; end if;
   select * into job from webhook_deliveries where destination_id=endpoint.destination_id and status='pending' and next_attempt_at<=now()
    order by next_attempt_at,id limit 1 for update skip locked;
   if not found then continue; end if;
   update webhook_deliveries set status='sending',attempts=attempts+1,total_attempts=total_attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',last_attempt_at=now(),updated_at=now() where id=job.id returning * into job;
   insert into webhook_attempts(delivery_id,attempt_number,lease_token,outcome,detail) values(job.id,job.total_attempts,job.lease_token,'dispatching','Claimed by delivery worker');
   update webhook_destination_runtime set last_claimed_at=now(),next_dispatch_at=now()+interval '100 milliseconds' where destination_id=endpoint.destination_id;
   update webhook_tenant_runtime set last_claimed_at=now() where organization_id=tenant.organization_id;
   return next job;claimed:=claimed+1;tenant_active:=tenant_active+1;
   exit when claimed>=greatest(1,least(coalesce(p_limit,8),32)) or tenant_active>=8;
  end loop;
  exit when claimed>=greatest(1,least(coalesce(p_limit,8),32));
 end loop;
 -- Removed destinations cannot be dispatched; retain their records as terminal failures.
 with removed as (select id from webhook_deliveries where destination_id is null and status='pending' limit 64 for update skip locked)
 update webhook_deliveries w set status='dead',terminal_reason='destination_removed',error_category='configuration',last_error='Destination removed',updated_at=now() from removed where removed.id=w.id;
end $$;

create function public.finish_webhook_delivery_v2(p_id uuid,p_token uuid,p_outcome text,p_detail text default null,
 p_http_status integer default null,p_error_category text default null,p_latency_ms integer default null,p_retry_after_seconds integer default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare job webhook_deliveries; next_time timestamptz; terminal text;
begin
 if p_outcome not in ('delivered','retry','dead','skipped') or p_outcome is null then raise exception 'Invalid outcome'; end if;
 if p_http_status is not null and p_http_status not between 100 and 599 then raise exception 'Invalid HTTP status'; end if;
 if p_error_category is not null and p_error_category not in ('timeout','network','dns','configuration','http_transient','http_permanent','database','policy','paused','lease_expired') then raise exception 'Invalid error category'; end if;
 select * into job from webhook_deliveries where id=p_id and lease_token=p_token and status='sending' and lease_until>now() for update;
 if not found then return false; end if;
 terminal:=case when p_outcome='dead' then coalesce(p_error_category,'permanent') when p_outcome='retry' and job.attempts>=8 then 'attempt_limit'
  when p_outcome='retry' and job.retry_deadline<=now() then 'retry_age' end;
 if p_outcome='retry' and terminal is null then
  next_time:=now()+make_interval(secs=>greatest(least(3600,5*power(2,job.attempts-1))+random()*5,least(3600,greatest(0,coalesce(p_retry_after_seconds,0)))));
  if next_time>=job.retry_deadline then terminal:='retry_age';next_time:=null;end if;
 end if;
 update webhook_deliveries set status=case when terminal is not null then 'dead' when p_outcome='retry' then 'pending' else p_outcome end,
 next_attempt_at=coalesce(next_time,next_attempt_at),lease_until=null,lease_token=null,updated_at=now(),
 delivered_at=case when p_outcome='delivered' then now() else delivered_at end,
 last_error=case when p_outcome='delivered' then null else left(p_detail,300) end,
 error_category=p_error_category,http_status=p_http_status,terminal_reason=terminal where id=p_id;
 update webhook_attempts set completed_at=now(),outcome=p_outcome,detail=left(p_detail,300),http_status=p_http_status,
 error_category=p_error_category,latency_ms=p_latency_ms,next_retry_at=next_time where delivery_id=p_id and lease_token=p_token;
 -- A legacy in-flight claim may finish after migration, without a claim-time attempt.
 if not found then insert into webhook_attempts(delivery_id,attempt_number,lease_token,outcome,detail,completed_at,http_status,error_category,latency_ms,next_retry_at)
 values(p_id,job.total_attempts,p_token,p_outcome,left(p_detail,300),now(),p_http_status,p_error_category,p_latency_ms,next_time);end if;
 if p_outcome='retry' and next_time is not null and job.destination_id is not null then
  update webhook_destination_runtime set next_dispatch_at=greatest(next_dispatch_at,next_time) where destination_id=job.destination_id;
 end if;
 return true;
end $$;

-- Legacy workers continue only before activation. After activation an old worker fails closed.
alter function public.claim_webhook_deliveries(integer) rename to claim_webhook_deliveries_legacy;
create function public.claim_webhook_deliveries(p_limit integer default 8) returns setof public.webhook_deliveries
language plpgsql security definer set search_path=public as $$ begin
 if (select enabled from delivery_pipeline_settings where id) then raise exception 'UPGRADE_DELIVERY_WORKER'; end if;
 return query select * from claim_webhook_deliveries_legacy(p_limit);
end $$;

create function public.delivery_recovery(p_org_id uuid,p_ids uuid[],p_action text,p_request_id uuid,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job webhook_deliveries; requested integer; changed integer:=0; existing delivery_actions;
begin
 if not public.is_org_writer(p_org_id) then raise exception 'Not authorized';end if;
 if p_action is null or p_action not in ('preview_retry','preview_replay','preview_cancel','retry','replay','cancel') or p_ids is null or cardinality(p_ids) not between 1 and 100 or p_request_id is null then raise exception 'Invalid recovery request';end if;
 -- Serialize recovery per tenant for request idempotency and a durable rate limit.
 perform 1 from organizations where id=p_org_id for update;
 select * into existing from delivery_actions where organization_id=p_org_id and request_id=p_request_id;
 if found then
  if existing.action<>p_action or existing.delivery_ids is distinct from p_ids then raise exception 'REQUEST_ID_CONFLICT';end if;
  return jsonb_build_object('scheduled',cardinality(existing.delivery_ids),'duplicate_request',true);
 end if;
 if (select count(*) from delivery_actions where organization_id=p_org_id and created_at>now()-interval '1 minute')>=20 then raise exception 'RECOVERY_RATE_LIMIT';end if;
 select count(distinct id) into requested from webhook_deliveries where id=any(p_ids) and organization_id=p_org_id;
 if requested<>cardinality(p_ids) then raise exception 'Not authorized or duplicate identifiers';end if;
 if p_action in ('preview_retry','preview_replay','preview_cancel') then
  return jsonb_build_object('selected',requested,'eligible',(select count(*) from webhook_deliveries w left join destinations d on d.id=w.destination_id where w.id=any(p_ids) and (
   (p_action='preview_cancel' and w.status='pending') or
   (p_action<>'preview_cancel' and (w.status in ('dead','skipped') or (p_action='preview_replay' and w.status='delivered')) and w.body is not null and w.payload_expires_at>now() and w.replay_count<3 and d.enabled and d.paused_at is null and d.url=w.destination_url))));
 end if;
 if cardinality(p_ids)>1 and not p_confirm then raise exception 'BULK_CONFIRMATION_REQUIRED';end if;
 for job in select * from webhook_deliveries where id=any(p_ids) order by id for update loop
  if p_action='cancel' then
   if job.status<>'pending' then raise exception 'Only pending work can be canceled';end if;
   update webhook_deliveries set status='skipped',terminal_reason='manual_cancel',last_error='Canceled by workspace operator',updated_at=now() where id=job.id;
  else
   if job.status not in ('dead','skipped') and not(p_action='replay' and job.status='delivered') then raise exception 'Delivery is not eligible';end if;
   if job.body is null or job.payload_expires_at<=now() then raise exception 'PAYLOAD_EXPIRED';end if;
   if job.replay_count>=3 then raise exception 'REPLAY_LIMIT';end if;
   perform 1 from destinations where id=job.destination_id and enabled and paused_at is null and url=job.destination_url for share;
   if not found then raise exception 'Destination unavailable, paused or URL changed';end if;
   update webhook_deliveries set status='pending',attempts=0,replay_count=replay_count+1,next_attempt_at=now(),
    retry_deadline=least(payload_expires_at,now()+interval '24 hours'),terminal_reason=null,last_error=null,error_category=null,updated_at=now() where id=job.id;
  end if;
  changed:=changed+1;
 end loop;
 insert into delivery_actions(organization_id,actor_id,request_id,action,delivery_ids) values(p_org_id,auth.uid(),p_request_id,p_action,p_ids);
 return jsonb_build_object('scheduled',changed,'duplicate_request',false);
end $$;
create or replace function public.replay_webhook_delivery(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare org uuid;begin select organization_id into org from webhook_deliveries where id=p_id;
 perform delivery_recovery(org,array[p_id],'retry',gen_random_uuid(),false);end $$;

create function public.pause_webhook_destination(p_id uuid,p_pause boolean,p_request_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare org uuid;begin
 select organization_id into org from destinations where id=p_id;
 if not coalesce(public.is_org_writer(org),false) then raise exception 'Not authorized';end if;
 if p_pause is null or p_request_id is null then raise exception 'Invalid pause request';end if;
 perform 1 from organizations where id=org for update;
 if exists(select 1 from delivery_actions where organization_id=org and request_id=p_request_id) then
  if not exists(select 1 from delivery_actions where organization_id=org and request_id=p_request_id and delivery_ids=array[p_id] and action=case when p_pause then 'pause' else 'resume' end) then raise exception 'REQUEST_ID_CONFLICT';end if;
  return;end if;
 if (select count(*) from delivery_actions where organization_id=org and created_at>now()-interval '1 minute')>=20 then raise exception 'RECOVERY_RATE_LIMIT';end if;
 update destinations set paused_at=case when p_pause then coalesce(paused_at,now()) end where id=p_id;
 insert into delivery_actions(organization_id,actor_id,request_id,action,delivery_ids) values(org,auth.uid(),p_request_id,case when p_pause then 'pause' else 'resume' end,array[p_id]);
end $$;

-- Safe server-filtered member read. No endpoint URL, signing secret or lease token is returned.
create function public.delivery_search(p_org_id uuid,p_status text default null,p_device_id uuid default null,p_destination_id uuid default null,
 p_event_id uuid default null,p_error_category text default null,p_from timestamptz default null,p_to timestamptz default null,
 p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_min_attempts integer default null,p_protocol text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;begin
 if not public.is_org_member(p_org_id) then raise exception 'Not authorized';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') into rows from (
 select w.id,w.event_id,w.device_id,w.destination_id,w.status,w.attempts,w.total_attempts,w.replay_count,w.created_at,w.updated_at,w.last_attempt_at,w.next_attempt_at,w.delivered_at,w.last_error,w.error_category,w.http_status,w.terminal_reason,w.payload_expires_at,
 e.protocol,e.schema_slot,e.device_name,e.sequence,e.record_index,e.accepted_at,
 (w.body is not null and w.payload_expires_at>now()) as payload_available
 from webhook_deliveries w left join telemetry_events e on e.id=w.event_id
 where w.organization_id=p_org_id and (p_status is null or w.status=p_status) and (p_device_id is null or w.device_id=p_device_id)
 and (p_destination_id is null or w.destination_id=p_destination_id) and (p_event_id is null or w.event_id=p_event_id)
 and (p_error_category is null or w.error_category=p_error_category) and (p_from is null or w.created_at>=p_from)
 and (p_to is null or w.created_at<=p_to) and (p_before is null or (w.created_at,w.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 and (p_min_attempts is null or w.total_attempts>=p_min_attempts) and (p_protocol is null or e.protocol=p_protocol)
 order by w.created_at desc,w.id desc limit greatest(1,least(coalesce(p_limit,50),101))) x;
 return rows;
end $$;
create function public.delivery_overview(p_org_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_org_member(p_org_id) then raise exception 'Not authorized';end if;
 return jsonb_build_object('counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from webhook_deliveries where organization_id=p_org_id group by status) x),
 'oldest_pending',(select min(created_at) from webhook_deliveries where organization_id=p_org_id and status='pending'),
 'destinations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select d.id,d.name,d.enabled,d.paused_at,
 (select count(*) from webhook_deliveries w where w.destination_id=d.id and w.status in ('pending','sending')) as backlog,
 (select max(delivered_at) from webhook_deliveries w where w.destination_id=d.id) as last_success,
 (select count(*) from webhook_deliveries w where w.destination_id=d.id and w.status='dead') as dead,
 (select count(*) from webhook_attempts a join webhook_deliveries w on w.id=a.delivery_id where w.destination_id=d.id and a.attempted_at>now()-interval '24 hours' and a.outcome in ('retry','dead','unknown')) as failures_24h,
 (select count(*) from webhook_attempts a join webhook_deliveries w on w.id=a.delivery_id where w.destination_id=d.id and a.attempted_at>now()-interval '24 hours') as attempts_24h
 from destinations d where d.organization_id=p_org_id) x));
end $$;
create function public.delivery_event_detail(p_org_id uuid,p_event_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_org_member(p_org_id) then raise exception 'Not authorized';end if;
 if not exists(select 1 from webhook_deliveries where organization_id=p_org_id and event_id=p_event_id) and not exists(select 1 from telemetry_events where organization_id=p_org_id and id=p_event_id) then raise exception 'Event unavailable';end if;
 return jsonb_build_object('traces',(select coalesce(jsonb_agg(x.trace),'[]') from (select p.trace from packet_traces p where p.organization_id=p_org_id and (p.trace->>'event_id'=p_event_id::text or p.trace->'event_ids' ? p_event_id::text) order by p.created_at desc limit 5) x),'event',(select to_jsonb(e) from telemetry_events e where e.id=p_event_id and e.organization_id=p_org_id),
 'deliveries',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,event_id,destination_id,status,created_at,updated_at,last_attempt_at,next_attempt_at,delivered_at,total_attempts,terminal_reason,last_error from webhook_deliveries where event_id=p_event_id and organization_id=p_org_id) x),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.attempted_at),'[]') from (select a.id,a.delivery_id,a.attempt_number,a.attempted_at,a.completed_at,a.outcome,a.detail,a.http_status,a.error_category,a.latency_ms,a.next_retry_at
 from webhook_attempts a join webhook_deliveries w on w.id=a.delivery_id where w.organization_id=p_org_id and w.event_id=p_event_id order by a.attempted_at limit 1000) x),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select a.id,a.action,a.created_at from delivery_actions a where a.organization_id=p_org_id and exists(select 1 from webhook_deliveries w where w.event_id=p_event_id and w.organization_id=p_org_id and w.id=any(a.delivery_ids)) order by a.created_at desc limit 100) x));
end $$;

-- Independent bounded recovery retention. Metadata records why payloads expired.
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
 delete from delivery_actions where created_at<now()-interval '30 days';
 delete from packet_traces p using organizations o where p.organization_id=o.id and p.created_at<now()-make_interval(days=>public.telemetry_retention_days(o.id));
 delete from telemetry t using devices d where t.device_id=d.id and t.timestamp<now()-make_interval(days=>public.telemetry_retention_days(d.organization_id));
 get diagnostics deleted_count=row_count;
 delete from device_replay_nonces where expires_at<now()-interval '1 hour';
 return deleted_count;
end $$;

-- Explicit privileges for every new definer function; no public defaults.
revoke all on function public.delivery_pipeline_health(),public.claim_webhook_deliveries_v2(integer),
 public.claim_webhook_deliveries(integer),public.claim_webhook_deliveries_legacy(integer),
 public.finish_webhook_delivery_v2(uuid,uuid,text,text,integer,text,integer,integer),
 public.delivery_recovery(uuid,uuid[],text,uuid,boolean),public.pause_webhook_destination(uuid,boolean,uuid),
 public.delivery_search(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer,integer,text),
 public.delivery_overview(uuid),public.delivery_event_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delivery_pipeline_health(),public.claim_webhook_deliveries_v2(integer),
 public.claim_webhook_deliveries(integer),public.finish_webhook_delivery_v2(uuid,uuid,text,text,integer,text,integer,integer) to service_role;
grant execute on function public.delivery_recovery(uuid,uuid[],text,uuid,boolean),public.pause_webhook_destination(uuid,boolean,uuid),
 public.delivery_search(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer,integer,text),
 public.delivery_overview(uuid),public.delivery_event_detail(uuid,uuid) to authenticated;

-- Same ingestion/replay algorithm; persist the already-resolved slot as server metadata.
create or replace function public.ingest_secure_v2_telemetry(
  p_wire_device_id bigint, p_sequence bigint, p_frame_digest bytea, p_schema_slot integer, p_records jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  credential public.secure_v2_credentials; state public.secure_v2_replay_state;
  slot_definition public.secure_v2_schema_slots; packet public.secure_v2_packets;
  target_device uuid; shift_by bigint; bit_mask bit(64); bitmap bit(64); decision text;
  record jsonb; event_uuid uuid; events uuid[] := '{}'; record_index integer := 0; record_count integer;
begin
  if p_wire_device_id is null or p_sequence is null or p_sequence not between 0 and 4294967295
    or p_frame_digest is null or octet_length(p_frame_digest) <> 32
    or p_schema_slot is null or p_schema_slot not between 0 and 15
    or p_records is null or jsonb_typeof(p_records) <> 'array'
    or jsonb_array_length(p_records) not between 1 and 255 or octet_length(p_records::text) > 262144 then
    raise exception 'INVALID_SECURE_V2_TELEMETRY';
  end if;
  select device_id into target_device from public.secure_v2_credentials where wire_device_id = p_wire_device_id;
  if target_device is null then raise exception 'INVALID_SECURE_V2_CREDENTIAL'; end if;
  perform 1 from public.devices where id = target_device and secure_v2_enabled for update;
  if not found then raise exception 'INVALID_SECURE_V2_CREDENTIAL'; end if;
  select * into credential from public.secure_v2_credentials where wire_device_id = p_wire_device_id for update;
  if not found or credential.revoked_at is not null or (credential.expires_at is not null and credential.expires_at <= now()) then
    raise exception 'INVALID_SECURE_V2_CREDENTIAL';
  end if;
  select * into slot_definition from public.secure_v2_schema_slots where device_id = target_device and slot = p_schema_slot;
  if not found then raise exception 'UNKNOWN_SECURE_V2_SCHEMA_SLOT'; end if;
  for record in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(record) <> 'object' then raise exception 'INVALID_SECURE_V2_TELEMETRY'; end if;
  end loop;
  select * into state from public.secure_v2_replay_state where wire_device_id = p_wire_device_id for update;
  if not found then raise exception 'SECURE_V2_REPLAY_STATE_MISSING'; end if;
  bitmap := state.recent_bitmap;
  if state.highest_sequence is null then
    state.highest_sequence := p_sequence; bitmap := 1::bigint::bit(64); decision := 'new';
  elsif p_sequence > state.highest_sequence then
    shift_by := p_sequence - state.highest_sequence;
    bitmap := case when shift_by >= 64 then B'0'::bit(64) else bitmap << shift_by::integer end;
    bitmap := bitmap | 1::bigint::bit(64); state.highest_sequence := p_sequence; decision := 'new';
  else
    shift_by := state.highest_sequence - p_sequence;
    if shift_by >= 64 then raise exception 'SECURE_V2_STALE_REPLAY'; end if;
    bit_mask := 1::bigint::bit(64) << shift_by::integer;
    if (bitmap & bit_mask) <> B'0'::bit(64) then
      select * into packet from public.secure_v2_packets where wire_device_id = p_wire_device_id and sequence = p_sequence;
      if not found or packet.frame_digest is distinct from p_frame_digest then raise exception 'SECURE_V2_SEQUENCE_CONFLICT'; end if;
      return jsonb_build_object('inserted', false, 'duplicate', true, 'event_ids', packet.event_ids, 'replay', 'duplicate');
    end if;
    bitmap := bitmap | bit_mask; decision := 'out_of_order';
  end if;
  update public.secure_v2_replay_state set highest_sequence = state.highest_sequence,
    recent_bitmap = bitmap, updated_at = now() where wire_device_id = p_wire_device_id;
  record_count := jsonb_array_length(p_records);
  for record in select value from jsonb_array_elements(p_records) loop
    insert into public.telemetry(device_id, parsed_json, timestamp,
      secure_v2_wire_device_id, secure_v2_sequence, secure_v2_record_index, secure_v2_schema_slot)
      values (target_device, record,
        now() - make_interval(secs => coalesce(slot_definition.sample_interval_ms, 0)::double precision
          * (record_count - 1 - record_index) / 1000.0),
        p_wire_device_id, p_sequence, record_index, p_schema_slot)
      returning id into event_uuid;
    events := array_append(events, event_uuid); record_index := record_index + 1;
  end loop;
  insert into public.secure_v2_packets(wire_device_id, sequence, frame_digest, event_ids)
    values(p_wire_device_id, p_sequence, p_frame_digest, events);
  -- High water is permanent; compact only digests already outside the replay
  -- window. Old packets remain unconditionally stale after telemetry retention.
  delete from public.secure_v2_packets where wire_device_id = p_wire_device_id
    and sequence < state.highest_sequence - 63;
  update public.devices set last_seen = now() where id = target_device;
  return jsonb_build_object('inserted', true, 'duplicate', false, 'event_ids', events, 'replay', decision);
end $$;

-- Compatibility completion wrapper: preserve old signature, enforce current token + lease fencing.
create or replace function public.finish_webhook_delivery(p_id uuid,p_token uuid,p_outcome text,p_detail text default null)
returns boolean language sql security definer set search_path=public as $$
 select public.finish_webhook_delivery_v2(p_id,p_token,p_outcome,p_detail)
$$;
-- Operational backpressure, not a subscription limit. Fail the ingestion transaction
-- rather than acknowledge delivery intent that cannot be retained safely.
alter table public.webhook_tenant_runtime add column queued_count bigint not null default 0 check(queued_count>=0);
insert into public.webhook_tenant_runtime(organization_id,queued_count)
 select organization_id,count(*) from public.webhook_deliveries where status in ('pending','sending') group by organization_id
 on conflict(organization_id) do update set queued_count=excluded.queued_count;
create function public.track_delivery_capacity() returns trigger language plpgsql security definer set search_path=public as $$
declare delta integer:=0;org uuid;current_count bigint;ceiling integer;
begin
 if tg_op='INSERT' then org:=new.organization_id;delta:=case when new.status in ('pending','sending') then 1 else 0 end;
 elsif tg_op='DELETE' then org:=old.organization_id;delta:=case when old.status in ('pending','sending') then -1 else 0 end;
 else org:=new.organization_id;delta:=(case when new.status in ('pending','sending') then 1 else 0 end)-(case when old.status in ('pending','sending') then 1 else 0 end);end if;
 if delta>0 then
  insert into webhook_tenant_runtime(organization_id,queued_count) values(org,1)
   on conflict(organization_id) do update set queued_count=webhook_tenant_runtime.queued_count+1 returning queued_count into current_count;
  select max_pending_per_tenant into ceiling from delivery_pipeline_settings where id and enabled;
  if ceiling is not null and current_count>ceiling then raise exception 'DELIVERY_BACKLOG_CAPACITY';end if;
 elsif delta<0 then update webhook_tenant_runtime set queued_count=greatest(0,queued_count-1) where organization_id=org;end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger track_delivery_capacity after insert or update of status or delete on public.webhook_deliveries
 for each row execute function public.track_delivery_capacity();
revoke all on function public.track_delivery_capacity() from public,anon,authenticated;
create or replace function public.record_packet_trace(p_device_id uuid,p_trace jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare d devices;
begin
 if octet_length(p_trace::text)>16384 then raise exception 'Trace too large';end if;
 -- Device identity is trustworthy only after packet authentication succeeds.
 if jsonb_typeof(p_trace->'stages') is distinct from 'array' or not exists(
  select 1 from jsonb_array_elements(p_trace->'stages') s where s->>'stage'='authentication' and s->>'status'='passed') then return;end if;
 select * into d from devices where id=p_device_id for update;
 if d.debug_trace_until is null or d.debug_trace_until<=now() then return;end if;
 insert into packet_traces(device_id,organization_id,trace) values(d.id,d.organization_id,p_trace);
 delete from packet_traces where device_id=d.id and id in(select id from packet_traces where device_id=d.id order by created_at desc,id offset 200);
end $$;

-- Bounded server-side recovery selection. Status is intentionally restricted to
-- failed/skipped work; all other history filters are preserved. Preview is read-only.
create function public.delivery_recovery_selection(p_org_id uuid,p_destination_id uuid default null,
 p_device_id uuid default null,p_event_id uuid default null,p_error_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_min_attempts integer default null,p_protocol text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare selected uuid[];total bigint;
begin
 if not coalesce(public.is_org_writer(p_org_id),false) then raise exception 'Not authorized';end if;
 if p_from>p_to then raise exception 'Invalid time range';end if;
 with eligible as (
  select w.id,w.created_at from webhook_deliveries w join destinations d on d.id=w.destination_id
  left join telemetry_events e on e.id=w.event_id
  where w.organization_id=p_org_id and w.status in ('dead','skipped')
  and w.body is not null and w.payload_expires_at>now() and w.replay_count<3
  and d.enabled and d.paused_at is null and d.url=w.destination_url
  and (p_destination_id is null or w.destination_id=p_destination_id)
  and (p_device_id is null or w.device_id=p_device_id) and (p_event_id is null or w.event_id=p_event_id)
  and (p_error_category is null or w.error_category=p_error_category)
  and (p_from is null or w.created_at>=p_from) and (p_to is null or w.created_at<=p_to)
  and (p_min_attempts is null or w.total_attempts>=p_min_attempts) and (p_protocol is null or e.protocol=p_protocol)
 ), first_batch as(select id,created_at from eligible order by created_at,id limit 100)
 select (select count(*) from eligible),(select coalesce(array_agg(id order by created_at,id),'{}'::uuid[]) from first_batch) into total,selected;
 return jsonb_build_object('ids',selected,'eligible_total',total);
end $$;
revoke all on function public.delivery_recovery_selection(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.delivery_recovery_selection(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text) to authenticated;
