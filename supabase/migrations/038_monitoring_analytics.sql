-- Phases 5/8 additive, default off; no automatic production backfill.
create table public.observability_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into public.observability_settings values(true,false);
create table public.monitoring_preferences(
 organization_id uuid primary key references organizations on delete cascade,
 default_mode text not null default 'none' check(default_mode in ('scheduled','event','none')),
 interval_seconds integer not null default 300 check(interval_seconds between 1 and 604800),
 grace_seconds integer not null default 300 check(grace_seconds between 0 and 604800),
 last_aggregated_at timestamptz,metrics_started_at timestamptz,maintenance_until timestamptz,timezone text not null default 'UTC',cost jsonb not null default '{}' check(octet_length(cost::text)<=4096)
);
create table public.device_monitoring(
 device_id uuid primary key references devices on delete cascade,organization_id uuid not null references organizations on delete cascade,
 mode text not null check(mode in ('scheduled','event','none')),interval_seconds integer not null check(interval_seconds between 1 and 604800),
 grace_seconds integer not null check(grace_seconds between 0 and 604800),maintenance_until timestamptz,
 foreign key(device_id,organization_id) references devices(id,organization_id)
);
alter table public.devices add column last_monitored_commit_at timestamptz;
alter table public.devices add column last_monitored_schema_slot integer check(last_monitored_schema_slot between 0 and 15);
grant select(last_monitored_commit_at,last_monitored_schema_slot) on public.devices to authenticated;
-- No old last_seen is reinterpreted as a successful commit.
update devices d set last_monitored_commit_at=(select max(e.accepted_at) from telemetry_events e where e.device_id=d.id),last_monitored_schema_slot=(select schema_slot from telemetry_events e where e.device_id=d.id order by accepted_at desc limit 1)
where exists(select 1 from telemetry_events e where e.device_id=d.id);
create table public.metric_events(
 id bigint generated always as identity primary key,event_key text not null unique check(length(event_key)<=150),
 organization_id uuid not null references organizations on delete cascade,device_id uuid references devices on delete set null,
 destination_id uuid,observed_at timestamptz not null default now(),schema_slot integer,protocol text not null default 'secure-v2',
 kind text not null check(kind in ('commit','duplicate','rejected','receipt','delivery_success','delivery_retry','delivery_dead','historical')),
 group_ids uuid[] not null default '{}',labels text[] not null default '{}',ip_version integer check(ip_version in (4,6)),
 readings bigint not null default 0 check(readings>=0),payload_bytes bigint check(payload_bytes>=0),
 app_bytes bigint check(app_bytes>=0),framing_bytes bigint check(framing_bytes>=0),security_bytes bigint check(security_bytes>=0),
 receipt_bytes bigint not null default 0 check(receipt_bytes>=0),processing_ms double precision check(processing_ms>=0),
 category text check(length(category)<=60),processed_at timestamptz
);
create index metric_pending on metric_events(id) where processed_at is null;
create index metric_org_time on metric_events(organization_id,observed_at desc);
create table public.metric_identity(event_key text primary key,organization_id uuid not null references organizations on delete cascade,recorded_at timestamptz not null default now());
create table public.metric_gaps(organization_id uuid not null references organizations on delete cascade,bucket timestamptz not null,cause text not null,events bigint not null default 1,primary key(organization_id,bucket,cause));
create table public.usage_rollups(
 organization_id uuid not null references organizations on delete cascade,grain text not null check(grain in ('minute','hour','day')),
 bucket timestamptz not null,dimension text not null,device_id uuid,destination_id uuid,schema_slot integer,
 kind text not null,group_ids uuid[] not null,labels text[] not null,ip_version integer,
 observations bigint not null default 0,packets bigint not null default 0,readings bigint not null default 0,payload_bytes bigint not null default 0,
 app_bytes bigint not null default 0,framing_bytes bigint not null default 0,security_bytes bigint not null default 0,
 receipt_bytes bigint not null default 0,known_app_packets bigint not null default 0,unknown_app_packets bigint not null default 0,
 processing_count bigint not null default 0,processing_ms double precision not null default 0,
 primary key(organization_id,grain,bucket,dimension)
);
create index usage_device_window on usage_rollups(organization_id,device_id,grain,bucket);
create index usage_group_index on usage_rollups using gin(group_ids);
create index usage_tag_index on usage_rollups using gin(labels);
create index usage_rejection_window on usage_rollups(organization_id,grain,bucket,device_id) where kind='rejected';
create index usage_expiry on usage_rollups(bucket);
create index metric_expiry on metric_events(observed_at);
create index telemetry_event_backfill on telemetry_events(organization_id,id);
create table public.monitoring_health_history(organization_id uuid not null references organizations on delete cascade,bucket timestamptz not null,counts jsonb not null,recorded_at timestamptz not null default now(),primary key(organization_id,bucket));
alter table public.monitoring_health_history enable row level security;
create policy health_read on monitoring_health_history for select to authenticated using(is_org_member(organization_id));
grant select on monitoring_health_history to authenticated;
grant all on monitoring_health_history to service_role;
create table public.alert_rules(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations on delete cascade,
 name text not null check(length(name) between 1 and 120),description text not null default '' check(length(description)<=500),
 kind text not null check(kind in ('inactivity','never_connected','readings','bytes','packet_size','rejections','delivery_failures','dead_backlog','queue_age','sensor')),
 device_id uuid,group_id uuid,tag text,field text check(field is null or field ~ '^[a-zA-Z_][a-zA-Z_0-9]{0,63}$'),
 comparator text not null default 'gte' check(comparator in ('gte','lte')),
 threshold numeric not null check(threshold between -1e24 and 1e24),clear_threshold numeric not null check(clear_threshold between -1e24 and 1e24),
 window_minutes integer not null default 60 check(window_minutes between 1 and 10080),
 hold_seconds integer not null default 0 check(hold_seconds between 0 and 86400),
 cooldown_seconds integer not null default 300 check(cooldown_seconds between 60 and 604800),
 severity text not null default 'warning' check(severity in ('info','warning','critical')),
 definition_request_hash text not null default '',enabled boolean not null default false,webhook_id uuid,email boolean not null default false,
 muted_until timestamptz,version integer not null default 1,last_evaluated_at timestamptz,pending_since timestamptz,healthy_since timestamptz,
 last_value numeric,last_evaluation_error text,created_at timestamptz not null default now(),deleted_at timestamptz,
 check(kind='sensor' or (threshold>=0 and clear_threshold>=0)),check(kind<>'sensor' or (field is not null and device_id is not null)),
 check(kind not in ('rejections','delivery_failures') or (threshold<=100 and clear_threshold<=100)),
 foreign key(device_id,organization_id) references devices(id,organization_id)
);
create index alert_evaluation on alert_rules(last_evaluated_at nulls first) where enabled and deleted_at is null;
create table public.alert_incidents(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations on delete cascade,
 rule_id uuid not null references alert_rules,idempotency_version integer not null,rule_name text not null,severity text not null,
 status text not null check(status in ('open','acknowledged','suppressed','resolved')),value numeric not null,
 threshold numeric not null,reason text not null,opened_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 acknowledged_by uuid,acknowledged_at timestamptz,resolved_at timestamptz,notification_suppressed_reason text,notification_config jsonb not null default '{}'::jsonb
);
create unique index alert_one_active on alert_incidents(rule_id) where status<>'resolved';
create index alert_org_state on alert_incidents(organization_id,status,opened_at desc);
create index alert_org_created on alert_incidents(organization_id,opened_at desc);
create table public.alert_transitions(
 id bigint generated always as identity primary key,organization_id uuid not null references organizations on delete cascade,
 incident_id uuid not null references alert_incidents on delete cascade,state text not null,actor_id uuid,at timestamptz not null default now(),notify_pending boolean not null default false,notification_attempts integer not null default 0,notification_next_at timestamptz not null default now(),notification_error text
);
create index alert_notification_intents on alert_transitions(notification_next_at) where notify_pending;
create index alert_transition_history on alert_transitions(organization_id,at desc);
create table public.alert_email_preferences(
 organization_id uuid not null references organizations on delete cascade,user_id uuid not null,
 enabled boolean not null default false,min_severity text not null default 'warning' check(min_severity in ('info','warning','critical')),
 primary key(organization_id,user_id)
);
create table public.alert_notifications(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations on delete cascade,
 incident_id uuid not null references alert_incidents on delete cascade,transition text not null,channel text not null check(channel in ('email','webhook')),
 recipient_id uuid,delivery_id uuid references webhook_deliveries on delete set null,
 status text not null default 'pending' check(status in ('pending','sending','delivered','dead','suppressed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 error_category text,created_at timestamptz not null default now(),completed_at timestamptz,
 unique nulls not distinct(incident_id,transition,channel,recipient_id)
);
create index alert_email_ready on alert_notifications(available_at) where channel='email' and status in ('pending','sending');
create index alert_notification_history on alert_notifications(organization_id,created_at desc);
create table public.alert_notification_attempts(
 id bigint generated always as identity primary key,notification_id uuid not null references alert_notifications on delete cascade,
 organization_id uuid not null references organizations on delete cascade,attempt integer not null,
 outcome text not null,category text,http_status integer,at timestamptz not null default now(),unique(notification_id,attempt)
);
do $$declare n text;begin
 foreach n in array array['observability_settings','monitoring_preferences','device_monitoring','metric_events','metric_identity','metric_gaps','usage_rollups','alert_rules','alert_incidents','alert_transitions','alert_email_preferences','alert_notifications','alert_notification_attempts'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('grant all on public.%I to service_role',n);
  if n<>'observability_settings' then execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_org_member(organization_id))',n);end if;
 end loop;
end $$;

create function public.observability_overview(p_org uuid,p_actor uuid,p_filter jsonb default '{}',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform observability_authorize(p_org,p_actor,false);
 result:=monitoring_devices(p_org,p_actor,p_filter,p_page);
 return result||jsonb_build_object('preferences',(select to_jsonb(p) from monitoring_preferences p where organization_id=p_org),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from device_groups where organization_id=p_org),
 'rules',(select coalesce(jsonb_agg((to_jsonb(r)-'definition_request_hash')||jsonb_build_object('threshold',r.threshold::text,'clear_threshold',r.clear_threshold::text,'last_value',r.last_value::text) order by created_at desc),'[]') from alert_rules r where organization_id=p_org and deleted_at is null),
 'incidents',(select coalesce(jsonb_agg((to_jsonb(i)-'notification_config')||jsonb_build_object('value',i.value::text,'threshold',i.threshold::text) order by opened_at desc),'[]') from(select i.* from alert_incidents i join alert_rules r on r.id=i.rule_id where i.organization_id=p_org
  and (coalesce(p_filter->>'incidentState','active')='all' or case when coalesce(p_filter->>'incidentState','active')='active' then i.status<>'resolved' else i.status='resolved' end)
  and (not(p_filter?'device') or r.device_id=(p_filter->>'device')::uuid) and (not(p_filter?'group') or r.group_id=(p_filter->>'group')::uuid) and (not(p_filter?'tag') or r.tag=p_filter->>'tag')
  order by i.opened_at desc offset greatest(0,least(2000,coalesce((p_filter->>'incidentPage')::integer,0)))*50 limit 50)i),
 'activeAlerts',(select count(*)::text from alert_incidents where organization_id=p_org and status<>'resolved'),
 'transitions',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from(select incident_id,state,at,notify_pending,notification_attempts,notification_error from alert_transitions where organization_id=p_org order by at desc limit 100)t),
 'emailPreferences',(select jsonb_build_object('enabled',enabled,'severity',min_severity) from alert_email_preferences where organization_id=p_org and user_id=p_actor),
 'notifications',(select coalesce(jsonb_agg(to_jsonb(n)),'[]') from(select a.id,a.incident_id,a.channel,
  case when a.channel='webhook' then coalesce(w.status,'dead') else a.status end status,coalesce(w.total_attempts,a.attempts) attempts,a.created_at,coalesce(w.error_category,a.error_category) error_category
  from alert_notifications a left join webhook_deliveries w on w.id=a.delivery_id where a.organization_id=p_org order by a.created_at desc limit 100)n),
 'destinations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from destinations where organization_id=p_org and not integration_managed),
 'delivery',(select jsonb_build_object('pending',count(*) filter(where status='pending')::text,'sending',count(*) filter(where status='sending')::text,'dead',count(*) filter(where status='dead')::text,'oldest',min(created_at) filter(where status in ('pending','sending'))) from webhook_deliveries where organization_id=p_org and body->>'type'='telemetry.received'),
 'healthHistory',(select coalesce(jsonb_agg(jsonb_build_object('bucket',recorded_at,'hourBucket',bucket)||counts order by bucket),'[]') from(select bucket,counts,recorded_at from monitoring_health_history where organization_id=p_org order by bucket desc limit 168)h),
 'updatedAt',now());
end $$;

create function public.claim_alert_email() returns jsonb language plpgsql security definer set search_path=public as $$declare n alert_notifications;recipient text;i alert_incidents;begin
 if not(select enabled from observability_settings where id) then return null;end if;
 select * into n from alert_notifications where channel='email' and (status='pending' and available_at<=now() or status='sending' and lease_until<=now()) order by available_at limit 1 for update skip locked;
 if not found then return null;end if;
 if n.status='sending' then update alert_notification_attempts set outcome='unknown',category='lease_expired' where notification_id=n.id and attempt=n.attempts;end if;
 if n.attempts>=8 or n.created_at<now()-interval '24 hours' then update alert_notifications set status='dead',error_category='retry_limit',completed_at=now() where id=n.id;return null;end if;
 select u.email into recipient from auth.users u join organization_members m on m.user_id=u.id and m.organization_id=n.organization_id
  join alert_email_preferences p on p.user_id=m.user_id and p.organization_id=m.organization_id and p.enabled where u.id=n.recipient_id and to_jsonb(u)->>'email_confirmed_at' is not null;
 if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then update alert_notifications set status='suppressed',completed_at=now(),error_category='preferences' where id=n.id;return null;end if;
 update alert_notifications set status='sending',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '30 seconds' where id=n.id returning * into n;
 insert into alert_notification_attempts(notification_id,organization_id,attempt,outcome) values(n.id,n.organization_id,n.attempts,'sending');
 select * into strict i from alert_incidents where id=n.incident_id;
 return jsonb_build_object('id',n.id,'token',n.lease_token,'to',recipient,'attempt',n.attempts,'name',i.rule_name,'severity',i.severity,'state',n.transition,'reason',i.reason,'at',i.opened_at);
end $$;

create function public.finish_alert_email(p_id uuid,p_token uuid,p_outcome text,p_category text default null,p_status integer default null,p_after integer default 0) returns boolean
language plpgsql security definer set search_path=public as $$declare n alert_notifications;begin
 if p_outcome not in ('delivered','retry','dead') or length(p_category)>60 then raise exception 'INVALID_NOTIFICATION_OUTCOME';end if;
 select * into n from alert_notifications where id=p_id and lease_token=p_token and status='sending' and lease_until>now() for update;
 if not found then return false;end if;
 update alert_notifications set status=case when p_outcome='retry' and attempts<8 and created_at>now()-interval '24 hours' then 'pending' when p_outcome='retry' then 'dead' else p_outcome end,
  available_at=now()+make_interval(secs=>greatest(least(3600,5*power(2,n.attempts-1))+random()*5,least(3600,greatest(0,coalesce(p_after,0))))),lease_token=null,lease_until=null,error_category=p_category,
  completed_at=case when p_outcome<>'retry' then now() end where id=p_id;
 update alert_notification_attempts set outcome=p_outcome,category=p_category,http_status=p_status where notification_id=p_id and attempt=n.attempts;
 return true;
end $$;

create function public.observability_backfill(p_org uuid,p_actor uuid,p_after uuid default null,p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path=public as $$declare e telemetry_events;n integer:=0;cursor_id uuid;begin
 perform observability_authorize(p_org,p_actor,true);
 if p_limit not between 1 and 1000 then raise exception 'INVALID_BACKFILL_LIMIT';end if;
 for e in select * from telemetry_events where organization_id=p_org and (p_after is null or id>p_after) and accepted_at>=now()-make_interval(days=>telemetry_retention_days(p_org)) order by id limit p_limit loop
  cursor_id:=e.id;
  if exists(select 1 from metric_identity where event_key='commit:'||e.wire_device_id||':'||e.sequence) then continue;end if;
  insert into metric_identity(event_key,organization_id) values('historical:'||e.id,p_org) on conflict do nothing;
  if not found then continue;end if;
  insert into metric_events(event_key,organization_id,device_id,observed_at,schema_slot,protocol,kind,readings)
   values('historical:'||e.id,p_org,e.device_id,e.accepted_at,e.schema_slot,e.protocol,'historical',1) on conflict(event_key) do nothing;
  if found then n:=n+1;end if;
 end loop;return jsonb_build_object('inserted',n,'cursor',cursor_id,'bytes','unavailable','groups','historical membership unavailable');
end $$;

create function public.observability_cleanup() returns void language plpgsql security definer set search_path=public as $$begin
 with expired as(select id,organization_id,date_trunc('hour',observed_at,'UTC') bucket,case when kind like 'delivery_%' then 'delivery_aggregation_expired' else 'ingress_aggregation_expired' end cause from metric_events where processed_at is null and observed_at<now()-interval '7 days' order by id limit 10000 for update skip locked),
 gaps as(insert into metric_gaps(organization_id,bucket,cause,events) select organization_id,bucket,cause,count(*) from expired group by organization_id,bucket,cause on conflict(organization_id,bucket,cause) do update set events=metric_gaps.events+excluded.events returning organization_id)
 delete from metric_events where id in(select id from expired);
 delete from usage_rollups where (organization_id,grain,bucket,dimension) in (select organization_id,grain,bucket,dimension from usage_rollups u where u.bucket<now()-make_interval(days=>least(30,telemetry_retention_days(u.organization_id))) or (grain='minute' and bucket<now()-interval '7 days') order by bucket limit 10000);
 delete from metric_events where id in(select id from metric_events where processed_at is not null and observed_at<now()-interval '1 day' order by observed_at limit 10000);
 delete from metric_identity where event_key in(select event_key from metric_identity where recorded_at<now()-interval '31 days' limit 10000);
 delete from metric_gaps where bucket<now()-interval '31 days';
 delete from monitoring_health_history where bucket<now()-interval '30 days';
 update alert_notifications set status='dead',error_category='retry_age',completed_at=now() where channel='email' and status in ('pending','sending') and created_at<now()-interval '24 hours';
 delete from alert_notifications where created_at<now()-interval '7 days' and status not in ('pending','sending');
 delete from alert_incidents where id in(select id from alert_incidents where status='resolved' and resolved_at<now()-interval '30 days' limit 1000);
 delete from alert_rules where deleted_at<now()-interval '30 days' and not exists(select 1 from alert_incidents where rule_id=alert_rules.id);
end $$;

-- Email preferences/transport metadata are read through safe RPC projections.
grant select on monitoring_preferences,device_monitoring,usage_rollups,alert_rules,alert_transitions to authenticated;
grant select(id,organization_id,rule_id,idempotency_version,rule_name,severity,status,value,threshold,reason,opened_at,updated_at,acknowledged_by,acknowledged_at,resolved_at,notification_suppressed_reason) on alert_incidents to authenticated;
grant usage,select on sequence metric_events_id_seq,alert_transitions_id_seq,alert_notification_attempts_id_seq to service_role;

create function public.observability_authorize(p_org uuid,p_actor uuid,p_write boolean default false) returns void
language plpgsql security definer set search_path=public as $$begin
 if not (select enabled from observability_settings where id) then raise exception 'OBSERVABILITY_DISABLED';end if;
 if not exists(select 1 from organization_members where organization_id=p_org and user_id=p_actor and (not p_write or role in ('owner','admin'))) then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
end $$;

create function public.ingest_secure_v2_observed(p_wire_device_id bigint,p_sequence bigint,p_frame_digest bytea,p_schema_slot integer,p_records jsonb,p_metrics jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;d devices;s secure_v2_schema_slots;begin
 result:=ingest_secure_v2_telemetry(p_wire_device_id,p_sequence,p_frame_digest,p_schema_slot,p_records);
 if not (select enabled from observability_settings where id) then return result;end if;
 if (result->>'inserted')::boolean then begin update devices dev set last_monitored_commit_at=now(),last_monitored_schema_slot=p_schema_slot from secure_v2_credentials c where c.device_id=dev.id and c.wire_device_id=p_wire_device_id;exception when others then null;end;end if;
 -- Optional metrics are a subtransaction: they never invalidate a durable commit.
 begin
  select dev.* into strict d from devices dev join secure_v2_credentials c on c.device_id=dev.id where c.wire_device_id=p_wire_device_id;
  if (result->>'inserted')::boolean then
   if p_metrics is null or not(p_metrics ?& array['app_bytes','payload_bytes','framing_bytes']) or jsonb_typeof(p_metrics->'app_bytes')<>'number' or jsonb_typeof(p_metrics->'payload_bytes')<>'number' or jsonb_typeof(p_metrics->'framing_bytes')<>'number' or octet_length(p_metrics::text)>1024 or (p_metrics->>'app_bytes')::integer not between 26 and 1400
    or (p_metrics->>'payload_bytes')::integer<1 or (p_metrics->>'framing_bytes')::integer not in (9,10)
    or (p_metrics->>'app_bytes')::integer<>(p_metrics->>'payload_bytes')::integer+(p_metrics->>'framing_bytes')::integer+16 then raise exception 'INVALID_PACKET_METRICS';end if;
   insert into metric_identity(event_key,organization_id) values('commit:'||p_wire_device_id||':'||p_sequence,d.organization_id) on conflict do nothing;
   insert into metric_events(event_key,organization_id,device_id,observed_at,schema_slot,kind,group_ids,labels,ip_version,readings,payload_bytes,app_bytes,framing_bytes,security_bytes,processing_ms)
   values('commit:'||p_wire_device_id||':'||p_sequence,d.organization_id,d.id,coalesce((p_metrics->>'received_at')::timestamptz,now()),p_schema_slot,'commit',
    array(select group_id from device_group_members where device_id=d.id order by group_id),d.labels,(p_metrics->>'ip_version')::integer,
    jsonb_array_length(p_records),(p_metrics->>'payload_bytes')::bigint,(p_metrics->>'app_bytes')::bigint,(p_metrics->>'framing_bytes')::bigint,16,(p_metrics->>'processing_ms')::double precision)
   on conflict(event_key) do nothing;

  end if;
  return result||jsonb_build_object('metrics_recorded',true);
 exception when others then
  begin insert into metric_gaps(organization_id,bucket,cause) select dev.organization_id,date_trunc('hour',now(),'UTC'),'commit_metadata_unavailable' from devices dev join secure_v2_credentials c on c.device_id=dev.id where c.wire_device_id=p_wire_device_id
   on conflict(organization_id,bucket,cause) do update set events=metric_gaps.events+1;exception when others then null;end;
  return result||jsonb_build_object('metrics_recorded',false);end;
end $$;

create function public.record_metric_observations(p_rows jsonb) returns integer
language plpgsql security definer set search_path=public as $$declare r jsonb;d devices;n integer:=0;begin
 if not(select enabled from observability_settings where id) then return 0;end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 or octet_length(p_rows::text)>65536 then raise exception 'INVALID_OBSERVATIONS';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  select * into strict d from devices where id=(r->>'device_id')::uuid;
  if r->>'kind' not in ('duplicate','rejected','receipt') or (r->>'app_bytes')::integer not between 0 and 65507 or (r->>'receipt_bytes')::integer not between 0 and 21 then raise exception 'INVALID_OBSERVATION';end if;
  insert into metric_events(event_key,organization_id,device_id,kind,group_ids,labels,ip_version,app_bytes,receipt_bytes,category,observed_at)
   values('attempt:'||(r->>'id')::uuid,d.organization_id,d.id,r->>'kind',array(select group_id from device_group_members where device_id=d.id order by group_id),d.labels,
    (r->>'ip_version')::integer,case when r->>'kind'='receipt' then null else (r->>'app_bytes')::bigint end,(r->>'receipt_bytes')::bigint,left(r->>'category',60),coalesce((r->>'observed_at')::timestamptz,now()))
  on conflict(event_key) do nothing;
  n:=n+1;
 end loop;return n;
end $$;

create function public.record_delivery_metric() returns trigger language plpgsql security definer set search_path=public as $$declare w webhook_deliveries;begin
 if new.completed_at is null or (tg_op='UPDATE' and old.completed_at is not null) or not(select enabled from observability_settings where id) then return new;end if;
 select * into w from webhook_deliveries where id=new.delivery_id;
 if w.body->>'type'<>'telemetry.received' or new.outcome not in ('delivered','retry','dead') then return new;end if;
 begin
  insert into metric_events(event_key,organization_id,device_id,destination_id,kind,protocol,processing_ms)
  values('delivery:'||new.id,w.organization_id,w.device_id,w.destination_id,case new.outcome when 'delivered' then 'delivery_success' when 'retry' then 'delivery_retry' else 'delivery_dead' end,'downstream',new.latency_ms)
  on conflict(event_key) do nothing;
 exception when others then null;end;return new;
end $$;
create trigger delivery_metric after insert or update on webhook_attempts for each row execute function record_delivery_metric();

create function public.aggregate_metric_events(p_limit integer default 200) returns integer
language plpgsql security definer set search_path=public as $$declare claim_row record;ids bigint[]:='{}';begin
 if not(select enabled from observability_settings where id) then return 0;end if;
 if p_limit not between 1 and 1000 then raise exception 'INVALID_AGGREGATION_LIMIT';end if;
 for claim_row in select id,organization_id from metric_events where processed_at is null order by id limit p_limit for update skip locked loop
  if pg_try_advisory_xact_lock(hashtextextended(claim_row.organization_id::text,5088)) then ids:=array_append(ids,claim_row.id);end if;
 end loop;
 if cardinality(ids)=0 then return 0;end if;
 with expanded as(
  select e.*,g.grain,date_trunc(g.grain,e.observed_at,'UTC') bucket,
   md5(jsonb_build_array(e.device_id,e.destination_id,e.schema_slot,e.kind,e.group_ids,e.labels,e.ip_version)::text) dimension
  from metric_events e cross join (values('minute'),('hour'),('day'))g(grain) where e.id=any(ids)
 ), grouped as(
  select organization_id,grain,bucket,dimension,device_id,destination_id,schema_slot,kind,group_ids,labels,ip_version,
   count(*)::bigint observations,sum(case when kind in ('commit','duplicate','rejected') then 1 else 0 end)::bigint packets,
   sum(readings)::bigint readings,sum(coalesce(payload_bytes,0))::bigint payload_bytes,sum(coalesce(app_bytes,0))::bigint app_bytes,
   sum(coalesce(framing_bytes,0))::bigint framing_bytes,sum(coalesce(security_bytes,0))::bigint security_bytes,sum(receipt_bytes)::bigint receipt_bytes,
   sum(case when app_bytes is not null then 1 else 0 end)::bigint known_app_packets,
   sum(case when kind in ('commit','historical') and app_bytes is null then 1 else 0 end)::bigint unknown_app_packets,
   count(processing_ms)::bigint processing_count,sum(coalesce(processing_ms,0)) processing_ms
  from expanded group by organization_id,grain,bucket,dimension,device_id,destination_id,schema_slot,kind,group_ids,labels,ip_version
 )
 insert into usage_rollups(organization_id,grain,bucket,dimension,device_id,destination_id,schema_slot,kind,group_ids,labels,ip_version,
  observations,packets,readings,payload_bytes,app_bytes,framing_bytes,security_bytes,receipt_bytes,known_app_packets,unknown_app_packets,processing_count,processing_ms)
 select organization_id,grain,bucket,dimension,device_id,destination_id,schema_slot,kind,group_ids,labels,ip_version,
  observations,packets,readings,payload_bytes,app_bytes,framing_bytes,security_bytes,receipt_bytes,known_app_packets,unknown_app_packets,processing_count,processing_ms
 from grouped order by organization_id,grain,bucket,dimension
 on conflict(organization_id,grain,bucket,dimension) do update set
  observations=usage_rollups.observations+excluded.observations,packets=usage_rollups.packets+excluded.packets,readings=usage_rollups.readings+excluded.readings,
  payload_bytes=usage_rollups.payload_bytes+excluded.payload_bytes,app_bytes=usage_rollups.app_bytes+excluded.app_bytes,
  framing_bytes=usage_rollups.framing_bytes+excluded.framing_bytes,security_bytes=usage_rollups.security_bytes+excluded.security_bytes,
  receipt_bytes=usage_rollups.receipt_bytes+excluded.receipt_bytes,known_app_packets=usage_rollups.known_app_packets+excluded.known_app_packets,
  unknown_app_packets=usage_rollups.unknown_app_packets+excluded.unknown_app_packets,processing_count=usage_rollups.processing_count+excluded.processing_count,
  processing_ms=usage_rollups.processing_ms+excluded.processing_ms;
 insert into monitoring_preferences(organization_id,last_aggregated_at,metrics_started_at) select organization_id,now(),min(observed_at) filter(where kind='commit' and app_bytes is not null) from metric_events where id=any(ids) group by organization_id on conflict(organization_id) do update set last_aggregated_at=excluded.last_aggregated_at,metrics_started_at=least(monitoring_preferences.metrics_started_at,excluded.metrics_started_at);
 update metric_events set processed_at=now() where id=any(ids);
 return cardinality(ids);
end $$;

create function public.monitoring_devices(p_org uuid,p_actor uuid,p_filter jsonb default '{}',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform observability_authorize(p_org,p_actor,false);
 if p_page not between 0 and 2000 or octet_length(p_filter::text)>2048 then raise exception 'INVALID_FILTER';end if;
 with errors as(select device_id,sum(packets)::text n from usage_rollups where organization_id=p_org and grain='hour' and kind='rejected' and bucket>=now()-interval '24 hours' group by device_id),
 scoped_alerts as(select r.device_id,count(*)::text n from alert_incidents i join alert_rules r on r.id=i.rule_id where i.organization_id=p_org and i.status<>'resolved' and r.device_id is not null group by r.device_id),
 states as (
 select d.id,d.name,d.last_monitored_commit_at,d.last_monitored_schema_slot,d.first_telemetry_at,d.lifecycle,d.labels,
  coalesce(m.mode,p.default_mode,'none') mode,coalesce(m.interval_seconds,p.interval_seconds,300) interval_seconds,coalesce(m.grace_seconds,p.grace_seconds,300) grace_seconds,
  greatest(m.maintenance_until,p.maintenance_until) maintenance_until,coalesce(errors.n,'0') observed_rejections,coalesce(scoped_alerts.n,'0') device_alerts,
  case when d.lifecycle<>'enabled' then d.lifecycle when d.last_monitored_commit_at is null and d.first_telemetry_at is null then 'never'
   when d.last_monitored_commit_at is null then 'unavailable'
   when coalesce(m.mode,p.default_mode,'none')<>'scheduled' then case when d.last_monitored_commit_at>=now()-interval '5 minutes' then 'reporting' else 'no_expectation' end
   when d.last_monitored_commit_at>=now()-make_interval(secs=>coalesce(m.interval_seconds,p.interval_seconds,300)+coalesce(m.grace_seconds,p.grace_seconds,300)) then 'reporting' else 'inactive' end status
 from devices d left join device_monitoring m on m.device_id=d.id left join monitoring_preferences p on p.organization_id=d.organization_id left join errors on errors.device_id=d.id left join scoped_alerts on scoped_alerts.device_id=d.id
 where d.organization_id=p_org and d.lifecycle<>'deleted' and (not(p_filter?'device') or d.id=(p_filter->>'device')::uuid)
 and (not(p_filter?'group') or exists(select 1 from device_group_members gm where gm.device_id=d.id and gm.group_id=(p_filter->>'group')::uuid))
 and (not(p_filter?'tag') or p_filter->>'tag'=any(d.labels)) and (not(p_filter?'search') or d.name ilike '%'||left(p_filter->>'search',128)||'%')
 ), filtered as(select * from states where (not(p_filter?'status') or status=p_filter->>'status') and(not(p_filter?'view') or (p_filter->>'view'='errors' and observed_rejections<>'0') or (p_filter->>'view'='alerts' and device_alerts<>'0')))
 select jsonb_build_object('total',(select count(*)::text from filtered),'counts',(select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*)::text n from states group by status)c),
 'devices',coalesce(jsonb_agg(to_jsonb(page)),'[]')) into result from(select * from filtered order by name,id offset p_page*50 limit 50)page;
 return result;
end $$;

create function public.usage_counter_json(p usage_rollups) returns jsonb language sql immutable as $$select jsonb_build_object(
 'packets',p.packets::text,'readings',p.readings::text,'payload',p.payload_bytes::text,'application',p.app_bytes::text,'framing',p.framing_bytes::text,
 'security',p.security_bytes::text,'receipts',p.receipt_bytes::text,'known',p.known_app_packets::text,'unknown',p.unknown_app_packets::text)$$;

create function public.usage_analytics(p_org uuid,p_actor uuid,p_from timestamptz,p_to timestamptz,p_filter jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$declare result jsonb;grain_name text;begin
 perform observability_authorize(p_org,p_actor,false);
 if p_to<=p_from or p_to-p_from>interval '366 days' or octet_length(p_filter::text)>2048 then raise exception 'INVALID_WINDOW';end if;
 grain_name:=case when p_to-p_from<=interval '24 hours' then 'minute' when p_to-p_from<=interval '31 days' then 'hour' else 'day' end;
 -- Return existing buckets only; no synthetic zero rows or interpolation.
 with rows as(select * from usage_rollups u where u.organization_id=p_org and u.grain=grain_name and bucket>=date_trunc(grain_name,p_from,'UTC') and bucket<p_to
  and(not(p_filter?'device') or device_id=(p_filter->>'device')::uuid) and(not(p_filter?'group') or (p_filter->>'group')::uuid=any(group_ids))
  and(not(p_filter?'tag') or p_filter->>'tag'=any(labels)) and(not(p_filter?'slot') or schema_slot=(p_filter->>'slot')::integer)),
 buckets as(select bucket,sum(packets)::text packets,sum(readings)::text readings,sum(app_bytes)::text application,sum(receipt_bytes)::text receipts,
 sum(payload_bytes)::text payload,sum(framing_bytes)::text framing,sum(security_bytes)::text security,sum(known_app_packets)::text known,sum(unknown_app_packets)::text unknown,
 sum(case when kind='commit' then packets else 0 end)::text committed_packets,
 sum(case when kind='rejected' then packets else 0 end)::text rejected,sum(case when kind='duplicate' then packets else 0 end)::text duplicates,
 sum(case when ip_version=4 then (packets+case when kind='receipt' then observations else 0 end)*28 when ip_version=6 then (packets+case when kind='receipt' then observations else 0 end)*48 else 0 end)::text ip_overhead,
 sum(case when ip_version is null and packets>0 then packets else 0 end)::text unknown_ip,
 sum(case when kind='delivery_success' then observations else 0 end)::text delivered,
 sum(case when kind in ('delivery_retry','delivery_dead') then observations else 0 end)::text failed_attempts from rows group by bucket),
 top_devices as(select device_id,sum(app_bytes)::text application,sum(readings)::text readings from rows where device_id is not null group by device_id order by sum(app_bytes) desc limit 20)
 select jsonb_build_object('grain',grain_name,'from',date_trunc(grain_name,p_from,'UTC'),'to',p_to,'updatedAt',(select last_aggregated_at from monitoring_preferences where organization_id=p_org),'coverageStart',(select metrics_started_at from monitoring_preferences where organization_id=p_org),'retentionDays',telemetry_retention_days(p_org),
 'windowComplete',coalesce(p_from>=(select metrics_started_at from monitoring_preferences where organization_id=p_org) and p_from>=now()-make_interval(days=>telemetry_retention_days(p_org)),false),
 'pending',(select count(*)::text from metric_events where organization_id=p_org and processed_at is null),
 'gaps',(select coalesce(sum(events),0)::text from metric_gaps where organization_id=p_org and cause in ('commit_metadata_unavailable','ingress_aggregation_expired') and bucket>=date_trunc('hour',p_from,'UTC') and bucket<p_to),
 'buckets',(select coalesce(jsonb_agg(to_jsonb(b) order by bucket),'[]') from buckets b),
 'devices',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('name',(select name from devices where id=t.device_id))),'[]') from top_devices t),
 'groups',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select group_id,(select name from device_groups where id=group_id) name,sum(app_bytes)::text application from rows cross join lateral unnest(group_ids) group_id group by group_id order by sum(app_bytes) desc limit 20)x),
 'carrier',null,'measurement','Observed application bytes; minimum UDP/IP calculations exclude fragmentation, IP extensions, link/radio, DNS and carrier rounding; unknown packet history stays unavailable') into result;
 return result;
end $$;

create function public.alert_schedule_notifications(p_incident uuid,p_transition text) returns void
language plpgsql security definer set search_path=public as $$declare i alert_incidents;r alert_rules;u record;w uuid;blocked boolean:=false;begin
 if not pg_try_advisory_xact_lock(hashtextextended(p_incident::text,5089)) then return;end if;
 select * into strict i from alert_incidents where id=p_incident;
 select * into strict r from alert_rules where id=i.rule_id;
 r.webhook_id:=(i.notification_config->>'webhook')::uuid;r.email:=coalesce((i.notification_config->>'email')::boolean,false);
 if not r.enabled or coalesce(r.muted_until>now(),false) or exists(select 1 from monitoring_preferences where organization_id=i.organization_id and maintenance_until>now()) then
  update alert_transitions set notify_pending=false,notification_error='suppressed' where incident_id=i.id and state=case when p_transition='opened' then 'open' else 'resolved' end;return;end if;
 if exists(select 1 from alert_transitions where incident_id=i.id and notify_pending and (notification_attempts>=8 or at<now()-interval '24 hours')) then
  update alert_transitions set notify_pending=false,notification_error='schedule_retry_limit' where incident_id=i.id and notify_pending;
  update alert_incidents set notification_suppressed_reason='schedule_retry_limit' where id=i.id;return;end if;
 perform pg_advisory_xact_lock(hashtextextended(i.organization_id::text,508));
 if exists(select 1 from alert_notifications where incident_id=i.id and transition=p_transition) then update alert_transitions set notify_pending=false where incident_id=i.id and state=case when p_transition='opened' then 'open' else 'resolved' end;return;end if;
 -- Bound tenant storms. Incidents remain visible when notification quota is hit.
 if (select count(*) from alert_notifications where organization_id=i.organization_id and created_at>now()-interval '1 hour')>=100 then update alert_incidents set notification_suppressed_reason='workspace_notification_rate_limit' where id=i.id;update alert_transitions set notification_next_at=now()+interval '1 hour',notification_attempts=notification_attempts+1,notification_error='notification_rate_limit' where incident_id=i.id and notify_pending;return;end if;
 if r.webhook_id is not null and exists(select 1 from destinations where id=r.webhook_id and organization_id=i.organization_id and enabled and not integration_managed and signing_secret is not null and encode(sha256(convert_to(url,'UTF8')),'hex')=i.notification_config->>'url_hash') then
  insert into webhook_deliveries(event_id,organization_id,destination_id,destination_url,body)
  select gen_random_uuid(),i.organization_id,d.id,d.url,jsonb_build_object('id',i.id,'type','alert.'||p_transition,'payload',jsonb_build_object('name',i.rule_name,'severity',i.severity,'state',i.status,'value',i.value::text,'threshold',i.threshold::text,'reason',i.reason,'opened_at',i.opened_at,'path','/dashboard/alerts')) from destinations d where d.id=r.webhook_id and encode(sha256(convert_to(d.url,'UTF8')),'hex')=i.notification_config->>'url_hash' returning id into w;
  insert into alert_notifications(organization_id,incident_id,transition,channel,delivery_id) values(i.organization_id,i.id,p_transition,'webhook',w);
 else
  if r.webhook_id is not null then blocked:=true;insert into alert_notifications(organization_id,incident_id,transition,channel,status,error_category) values(i.organization_id,i.id,p_transition,'webhook','dead','configuration') on conflict do nothing;end if;
 end if;
 if r.email then
  for u in select p.user_id from alert_email_preferences p join organization_members m on m.organization_id=p.organization_id and m.user_id=p.user_id
   where p.organization_id=i.organization_id and p.enabled and array_position(array['info','warning','critical'],i.severity)>=array_position(array['info','warning','critical'],p.min_severity) limit 20 loop
   exit when (select count(*) from alert_notifications where organization_id=i.organization_id and created_at>now()-interval '1 hour')>=100;
   insert into alert_notifications(organization_id,incident_id,transition,channel,recipient_id) values(i.organization_id,i.id,p_transition,'email',u.user_id) on conflict do nothing;
  end loop;
 end if;
update alert_transitions set notify_pending=false,notification_attempts=notification_attempts+1,notification_error=null where incident_id=i.id and state=case when p_transition='opened' then 'open' else 'resolved' end;
 update alert_incidents set notification_suppressed_reason=case when blocked then 'notification_destination_changed_or_unavailable' end where id=i.id;
exception when others then
 begin update alert_incidents set notification_suppressed_reason='notification_schedule_failed' where id=p_incident;update alert_transitions set notify_pending=true,notification_attempts=notification_attempts+1,notification_next_at=now()+make_interval(secs=>least(3600,5*power(2,notification_attempts))+random()*5),notification_error='notification_schedule_failed' where incident_id=p_incident and state=case when p_transition='opened' then 'open' else 'resolved' end;exception when others then null;end;
end $$;

create function public.retry_alert_notifications() returns integer language plpgsql security definer set search_path=public as $$declare t record;n integer:=0;begin
 for t in select incident_id,state from alert_transitions where notify_pending and notification_next_at<=now() order by notification_next_at limit 20 loop
  perform alert_schedule_notifications(t.incident_id,case when t.state='open' then 'opened' else 'resolved' end);n:=n+1;
 end loop;return n;
end $$;

create function public.evaluate_alert_rule(p_id uuid,p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path=public as $$
declare r alert_rules;i alert_incidents;v numeric:=0;active boolean;clear boolean;suspended boolean;scope_ids uuid[];begin
 if not(select enabled from observability_settings where id) then return false;end if;
 select * into r from alert_rules where id=p_id for update skip locked;
 if not found or r.deleted_at is not null then return false;end if;
 select * into i from alert_incidents where rule_id=r.id and status<>'resolved' for update;
 suspended:=not r.enabled or coalesce(r.muted_until>p_now,false) or exists(select 1 from monitoring_preferences where organization_id=r.organization_id and maintenance_until>p_now);
 select coalesce(array_agg(d.id),'{}') into scope_ids from devices d where organization_id=r.organization_id and lifecycle='enabled'
  and(r.device_id is null or d.id=r.device_id) and(r.group_id is null or exists(select 1 from device_group_members m where m.device_id=d.id and m.group_id=r.group_id))
  and(r.tag is null or r.tag=any(d.labels));
 if r.kind in ('inactivity','never_connected') then
  select count(*) into v from devices d left join device_monitoring m on m.device_id=d.id left join monitoring_preferences p on p.organization_id=d.organization_id
  where d.id=any(scope_ids) and coalesce(greatest(m.maintenance_until,p.maintenance_until),'-infinity')<=p_now
   and case when r.kind='never_connected' then d.first_telemetry_at is null and d.created_at<p_now-make_interval(mins=>r.window_minutes)
   else coalesce(m.mode,p.default_mode,'none')='scheduled' and d.last_monitored_commit_at is not null and d.last_monitored_commit_at<p_now-make_interval(secs=>coalesce(m.interval_seconds,p.interval_seconds,300)+coalesce(m.grace_seconds,p.grace_seconds,300)) end;
 elsif r.kind in ('bytes','readings','packet_size','rejections','delivery_failures') then
  select case r.kind when 'bytes' then sum(app_bytes) when 'readings' then sum(readings)
   when 'packet_size' then sum(app_bytes)/nullif(sum(packets),0)::numeric
   when 'rejections' then 100*sum(case when kind='rejected' then packets else 0 end)/nullif(sum(packets),0)::numeric
   when 'delivery_failures' then 100*sum(case when kind in ('delivery_retry','delivery_dead') then observations else 0 end)/nullif(sum(case when kind like 'delivery_%' then observations else 0 end),0)::numeric end into v
  from usage_rollups where organization_id=r.organization_id and grain='minute' and bucket>=date_trunc('minute',p_now-make_interval(mins=>r.window_minutes)) and bucket<=p_now and device_id=any(scope_ids);
 elsif r.kind in ('dead_backlog','queue_age') then
  select coalesce(case when r.kind='dead_backlog' then count(*)::numeric else extract(epoch from(p_now-min(created_at))) end,0) into v from webhook_deliveries
   where organization_id=r.organization_id and device_id=any(scope_ids) and body->>'type'='telemetry.received' and
    case when r.kind='dead_backlog' then status='dead' else status in ('pending','sending') end;
 elsif r.kind='sensor' then
  select case when r.comparator='gte' then max(value) else min(value) end into v from(
   select case when jsonb_typeof(t.parsed_json->r.field)='number' and length(t.parsed_json->>r.field)<64 then (t.parsed_json->>r.field)::numeric when jsonb_typeof(t.parsed_json->r.field)='object' and (t.parsed_json->r.field->>'$integer') ~ '^-?[0-9]{1,20}$' then (t.parsed_json->r.field->>'$integer')::numeric end value
   from unnest(scope_ids) sid cross join lateral(select parsed_json from telemetry where device_id=sid and timestamp>=p_now-make_interval(mins=>r.window_minutes) order by timestamp desc limit 1)t
  ) values_in_scope;
 end if;
 if v is null and r.kind in ('bytes','readings') then v:=0;end if;
 if v is null then update alert_rules set last_evaluated_at=p_now,last_value=null,last_evaluation_error='measurement_unavailable',pending_since=null,healthy_since=null where id=r.id;return false;end if;
 active:=case when r.comparator='gte' then v>=r.threshold else v<=r.threshold end;
 clear:=case when r.comparator='gte' then v<=r.clear_threshold else v>=r.clear_threshold end;
 update alert_rules set last_evaluated_at=p_now,last_value=v,last_evaluation_error=null,pending_since=case when active and not suspended then coalesce(pending_since,p_now) end,
  healthy_since=case when clear then coalesce(healthy_since,p_now) end where id=r.id returning * into r;
 if suspended then
  if i.id is not null and i.status<>'suppressed' then update alert_incidents set status='suppressed',updated_at=p_now where id=i.id;insert into alert_transitions(organization_id,incident_id,state) values(r.organization_id,i.id,'suppressed');end if;
  return false;
 end if;
 if i.id is not null then
  if clear and p_now-r.healthy_since>=make_interval(secs=>r.hold_seconds) then
   update alert_incidents set status='resolved',resolved_at=p_now,updated_at=p_now,value=v where id=i.id;
   insert into alert_transitions(organization_id,incident_id,state,notify_pending) values(r.organization_id,i.id,'resolved',true);
   perform alert_schedule_notifications(i.id,'resolved');
  else
   update alert_incidents set status=case when status='suppressed' then case when acknowledged_at is null then 'open' else 'acknowledged' end else status end,value=v,updated_at=p_now where id=i.id;
  end if;
 elsif active and p_now-r.pending_since>=make_interval(secs=>r.hold_seconds)
  and not exists(select 1 from alert_incidents where rule_id=r.id and resolved_at>p_now-make_interval(secs=>r.cooldown_seconds)) then
  perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text,5190));
  if (select count(*) from alert_incidents where organization_id=r.organization_id and opened_at>p_now-interval '1 hour')>=100 then update alert_rules set last_evaluation_error='incident_rate_limit' where id=r.id;return false;end if;
  insert into alert_incidents(organization_id,rule_id,idempotency_version,rule_name,severity,status,value,threshold,reason,opened_at,updated_at,notification_config)
   values(r.organization_id,r.id,r.version,r.name,r.severity,'open',v,r.threshold,r.kind||': '||v||' (threshold '||r.threshold||')',p_now,p_now,jsonb_build_object('webhook',r.webhook_id,'url_hash',(select encode(sha256(convert_to(url,'UTF8')),'hex') from destinations where id=r.webhook_id),'email',r.email)) returning * into i;
  insert into alert_transitions(organization_id,incident_id,state,notify_pending) values(r.organization_id,i.id,'open',true);
  perform alert_schedule_notifications(i.id,'opened');
 end if;return true;
end $$;

create function public.observability_tick(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path=public as $$declare n integer;r record;e integer:=0;begin
 n:=aggregate_metric_events(p_limit);
 if not(select enabled from observability_settings where id) then return jsonb_build_object('aggregated',n,'evaluated',0);end if;
 for r in select id from alert_rules where deleted_at is null and (enabled or exists(select 1 from alert_incidents i where i.rule_id=alert_rules.id and status<>'resolved')) and (last_evaluated_at is null or last_evaluated_at<now()-interval '30 seconds') order by last_evaluated_at nulls first limit 20 for update skip locked loop
  perform evaluate_alert_rule(r.id);e:=e+1;
 end loop;
 for r in select o.id,(select user_id from organization_members where organization_id=o.id and role='owner' limit 1) actor from organizations o
  where exists(select 1 from organization_members where organization_id=o.id and role='owner') and not exists(select 1 from monitoring_health_history h where h.organization_id=o.id and h.bucket=date_trunc('hour',now(),'UTC')) limit 20 loop
  insert into monitoring_health_history(organization_id,bucket,counts) values(r.id,date_trunc('hour',now(),'UTC'),monitoring_devices(r.id,r.actor)->'counts') on conflict do nothing;
 end loop;
 perform retry_alert_notifications();
 return jsonb_build_object('aggregated',n,'evaluated',e);
end $$;

create function public.observability_command(p_org uuid,p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$declare rule alert_rules;id_in uuid;begin
 perform observability_authorize(p_org,p_actor,p_action<>'email_preferences');
 if octet_length(p_data::text)>8192 then raise exception 'CONFIGURATION_TOO_LARGE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,58));
 if p_action='preferences' then
  if not exists(select 1 from pg_timezone_names where name=coalesce(p_data->>'timezone','UTC')) then raise exception 'INVALID_TIMEZONE';end if;
  insert into monitoring_preferences(organization_id,default_mode,interval_seconds,grace_seconds,maintenance_until,timezone,cost)
   values(p_org,coalesce(p_data->>'mode','none'),coalesce((p_data->>'interval')::integer,300),coalesce((p_data->>'grace')::integer,300),(p_data->>'maintenance')::timestamptz,coalesce(p_data->>'timezone','UTC'),coalesce(p_data->'cost','{}'))
  on conflict(organization_id) do update set default_mode=excluded.default_mode,interval_seconds=excluded.interval_seconds,grace_seconds=excluded.grace_seconds,maintenance_until=excluded.maintenance_until,timezone=excluded.timezone,cost=excluded.cost;
 elsif p_action='policy' then
  id_in:=(p_data->>'device')::uuid;
  if not exists(select 1 from devices where id=id_in and organization_id=p_org) then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
  insert into device_monitoring(device_id,organization_id,mode,interval_seconds,grace_seconds,maintenance_until)
   values(id_in,p_org,p_data->>'mode',(p_data->>'interval')::integer,(p_data->>'grace')::integer,(p_data->>'maintenance')::timestamptz)
  on conflict(device_id) do update set mode=excluded.mode,interval_seconds=excluded.interval_seconds,grace_seconds=excluded.grace_seconds,maintenance_until=excluded.maintenance_until;
 elsif p_action='email_preferences' then
  insert into alert_email_preferences(organization_id,user_id,enabled,min_severity) values(p_org,p_actor,coalesce((p_data->>'enabled')::boolean,false),coalesce(p_data->>'severity','warning'))
   on conflict(organization_id,user_id) do update set enabled=excluded.enabled,min_severity=excluded.min_severity;
 elsif p_action='rule' then
  if (select count(*) from alert_rules where organization_id=p_org and deleted_at is null)>=100 and not exists(select 1 from alert_rules where id=(p_data->>'id')::uuid and organization_id=p_org and deleted_at is null) then raise exception 'RULE_LIMIT';end if;
  if p_data?'device' and not exists(select 1 from devices where id=(p_data->>'device')::uuid and organization_id=p_org) then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
  if p_data?'group' and not exists(select 1 from device_groups where id=(p_data->>'group')::uuid and organization_id=p_org) then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
  if p_data?'webhook' and not exists(select 1 from destinations where id=(p_data->>'webhook')::uuid and organization_id=p_org and not integration_managed and signing_secret is not null) then raise exception 'INVALID_NOTIFICATION_DESTINATION';end if;
  if coalesce(p_data->>'comparator','gte')='gte' and (p_data->>'clear')::numeric>(p_data->>'threshold')::numeric or coalesce(p_data->>'comparator','gte')='lte' and (p_data->>'clear')::numeric<(p_data->>'threshold')::numeric then raise exception 'INVALID_HYSTERESIS';end if;
  id_in:=coalesce((p_data->>'id')::uuid,gen_random_uuid());
  if exists(select 1 from alert_rules where id=id_in) then
   select * into rule from alert_rules where id=id_in and organization_id=p_org for update;
   if not found then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
   if rule.deleted_at is not null then raise exception 'RULE_DELETED';end if;
   if rule.definition_request_hash=md5(p_data::text) then return jsonb_build_object('id',id_in);end if;
   if rule.version<>coalesce((p_data->>'version')::integer,0) then raise exception 'RULE_VERSION_CONFLICT';end if;
   if rule.deleted_at is not null then raise exception 'RULE_DELETED';end if;
   if exists(select 1 from alert_incidents where rule_id=id_in and status<>'resolved') then raise exception 'RESOLVE_ACTIVE_RULE_BEFORE_EDIT';end if;
  end if;
  insert into alert_rules(id,organization_id,name,description,kind,device_id,group_id,tag,field,comparator,threshold,clear_threshold,window_minutes,hold_seconds,cooldown_seconds,severity,enabled,webhook_id,email,definition_request_hash)
   values(id_in,p_org,p_data->>'name',coalesce(p_data->>'description',''),p_data->>'kind',(p_data->>'device')::uuid,(p_data->>'group')::uuid,left(p_data->>'tag',48),p_data->>'field',coalesce(p_data->>'comparator','gte'),(p_data->>'threshold')::numeric,(p_data->>'clear')::numeric,coalesce((p_data->>'window')::integer,60),coalesce((p_data->>'hold')::integer,0),coalesce((p_data->>'cooldown')::integer,300),coalesce(p_data->>'severity','warning'),coalesce((p_data->>'enabled')::boolean,false),(p_data->>'webhook')::uuid,coalesce((p_data->>'email')::boolean,false),md5(p_data::text))
  on conflict(id) do update set definition_request_hash=excluded.definition_request_hash,name=excluded.name,description=excluded.description,kind=excluded.kind,device_id=excluded.device_id,group_id=excluded.group_id,tag=excluded.tag,field=excluded.field,comparator=excluded.comparator,threshold=excluded.threshold,clear_threshold=excluded.clear_threshold,window_minutes=excluded.window_minutes,hold_seconds=excluded.hold_seconds,cooldown_seconds=excluded.cooldown_seconds,severity=excluded.severity,enabled=excluded.enabled,webhook_id=excluded.webhook_id,email=excluded.email,version=alert_rules.version+1,pending_since=null,healthy_since=null;
  return jsonb_build_object('id',id_in);
 elsif p_action in ('acknowledge','resolve') then
  id_in:=(p_data->>'id')::uuid;
  if not exists(select 1 from alert_incidents where id=id_in and organization_id=p_org and status<>'resolved') then raise exception 'INCIDENT_NOT_ACTIVE';end if;
  if p_action='acknowledge' and exists(select 1 from alert_incidents where id=id_in and status='acknowledged') then return jsonb_build_object('ok',true);end if;
  update alert_incidents set status=case when p_action='acknowledge' then 'acknowledged' else 'resolved' end,
   acknowledged_by=case when p_action='acknowledge' then p_actor else acknowledged_by end,
   acknowledged_at=case when p_action='acknowledge' then now() else acknowledged_at end,
   resolved_at=case when p_action='resolve' then now() else resolved_at end,updated_at=now() where id=id_in;
  insert into alert_transitions(organization_id,incident_id,state,actor_id,notify_pending) values(p_org,id_in,case when p_action='resolve' then 'resolved' else p_action end,p_actor,p_action='resolve');
  if p_action='resolve' then perform alert_schedule_notifications(id_in,'resolved');end if;
 elsif p_action in ('mute','toggle','delete_rule') then
  update alert_rules set muted_until=case when p_action='mute' then (p_data->>'until')::timestamptz else muted_until end,
   enabled=case when p_action='toggle' then (p_data->>'enabled')::boolean when p_action='delete_rule' then false else enabled end,
   deleted_at=case when p_action='delete_rule' then now() else deleted_at end where id=(p_data->>'id')::uuid and organization_id=p_org;
  if not found then raise exception 'OBSERVABILITY_FORBIDDEN';end if;
  if p_action='delete_rule' then update alert_incidents set status='resolved',resolved_at=now(),updated_at=now(),reason=reason||'; rule deleted' where rule_id=(p_data->>'id')::uuid and status<>'resolved';end if;
 else raise exception 'INVALID_OBSERVABILITY_ACTION';end if;
 return jsonb_build_object('ok',true);
end $$;

-- Every callable helper is service-only. Browser writes/read-model calls go through authenticated APIs.
do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
 'observability_authorize','ingest_secure_v2_observed','record_metric_observations','record_delivery_metric','aggregate_metric_events','monitoring_devices','usage_counter_json','usage_analytics',
 'alert_schedule_notifications','retry_alert_notifications','evaluate_alert_rule','observability_tick','observability_command','observability_overview','claim_alert_email','finish_alert_email','observability_backfill','observability_cleanup') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
