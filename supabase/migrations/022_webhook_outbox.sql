-- Apply before starting the outbox worker. Trigger runs inside telemetry commit.
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  destination_id uuid references public.destinations(id) on delete set null,
  destination_url text not null,
  body jsonb not null,
  routing_rule jsonb,
  status text not null default 'pending' check(status in ('pending','sending','delivered','skipped','dead')),
  attempts integer not null default 0,
  replay_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  unique(event_id,destination_id)
);
create index webhook_ready on public.webhook_deliveries(next_attempt_at) where status in ('pending','sending');
create table public.webhook_attempts (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.webhook_deliveries(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null,
  detail text
);
alter table public.webhook_deliveries enable row level security;
alter table public.webhook_attempts enable row level security;
grant select on public.webhook_deliveries, public.webhook_attempts to authenticated;
grant all on public.webhook_deliveries, public.webhook_attempts to service_role;
grant usage, select on sequence public.webhook_attempts_id_seq to service_role;
create policy webhook_delivery_read on public.webhook_deliveries for select to authenticated
  using(public.is_org_member(organization_id));
create policy webhook_attempt_read on public.webhook_attempts for select to authenticated
  using(exists(select 1 from public.webhook_deliveries d where d.id=delivery_id and public.is_org_member(d.organization_id)));

create function public.enqueue_telemetry_webhooks() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into webhook_deliveries(event_id,organization_id,destination_id,destination_url,body,routing_rule)
  select new.id,d.organization_id,w.id,w.url,
    jsonb_build_object('id',new.id,'type','telemetry.received','device_id',d.id,
      'device_name',d.name,'timestamp',new.timestamp,'payload',new.parsed_json),
    case when o.subscription_tier='scale' then w.routing_rule else null end
  from devices d join organizations o on o.id=d.organization_id
  join destinations w on w.organization_id=d.organization_id
  where d.id=new.device_id and w.enabled
    and (w.device_id is null or w.device_id=d.id)
    and 'telemetry.received'=any(w.event_types);
  return new;
end $$;
create trigger telemetry_webhook_outbox after insert on public.telemetry
for each row execute function public.enqueue_telemetry_webhooks();

create function public.claim_webhook_deliveries(p_limit integer default 8)
returns setof public.webhook_deliveries language plpgsql security definer set search_path=public as $$
begin
  -- A crash after an HTTP request leaves uncertainty; record it before reclaiming.
  with expired as (
    select id from webhook_deliveries where status='sending' and lease_until<=now()
    order by lease_until limit 32 for update skip locked
  ), recovered as (
    update webhook_deliveries d set status=case when attempts>=8 then 'dead' else 'pending' end,
      lease_until=null,lease_token=null,
      last_error='Worker lease expired; remote delivery may have succeeded'
    from expired e where d.id=e.id returning d.id
  ) insert into webhook_attempts(delivery_id,outcome,detail)
    select id,'unknown','Worker lease expired; remote delivery may have succeeded' from recovered;
  return query with candidates as (
    select id from webhook_deliveries where attempts<8 and next_attempt_at<=now()
      and (status='pending' or (status='sending' and lease_until<=now()))
    order by next_attempt_at limit least(greatest(p_limit,1),32) for update skip locked
  ) update webhook_deliveries d set status='sending',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds'
    from candidates c where d.id=c.id returning d.*;
end $$;

create function public.finish_webhook_delivery(p_id uuid,p_token uuid,p_outcome text,p_detail text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare d webhook_deliveries;
begin
  select * into d from webhook_deliveries where id=p_id and lease_token=p_token and status='sending' for update;
  if not found then return false; end if;
  if p_outcome not in ('delivered','retry','dead','skipped') then raise exception 'INVALID_OUTCOME'; end if;
  insert into webhook_attempts(delivery_id,outcome,detail) values(p_id,p_outcome,left(p_detail,500));
  update webhook_deliveries set status=case when p_outcome='retry' then
      case when attempts>=8 then 'dead' else 'pending' end else p_outcome end,
    next_attempt_at=now()+make_interval(secs=>least(3600,5*power(2,least(attempts,10)))::integer)
      +random()*interval '5 seconds',
    lease_until=null,lease_token=null,last_error=left(p_detail,500),
    delivered_at=case when p_outcome='delivered' then now() else delivered_at end
    where id=p_id;
  return true;
end $$;

create function public.replay_webhook_delivery(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare d webhook_deliveries;
begin
  select * into d from webhook_deliveries where id=p_id for update;
  if not found or not public.is_org_writer(d.organization_id) then raise exception 'Not authorized'; end if;
  if d.status<>'dead' or d.destination_id is null or d.replay_count>=3 then raise exception 'Replay unavailable'; end if;
  if not exists(select 1 from destinations where id=d.destination_id and enabled and url=d.destination_url) then raise exception 'Destination disabled or changed'; end if;
  update webhook_deliveries set status='pending',attempts=0,replay_count=replay_count+1,
    next_attempt_at=now(),last_error=null where id=p_id;
  insert into webhook_attempts(delivery_id,outcome,detail) values(p_id,'replay','Requested by '||auth.uid());
end $$;
revoke all on function public.enqueue_telemetry_webhooks() from public,anon,authenticated;
revoke all on function public.claim_webhook_deliveries(integer) from public,anon,authenticated;
revoke all on function public.finish_webhook_delivery(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.replay_webhook_delivery(uuid) from public,anon;
grant execute on function public.claim_webhook_deliveries(integer), public.finish_webhook_delivery(uuid,uuid,text,text) to service_role;
grant execute on function public.replay_webhook_delivery(uuid) to authenticated;
