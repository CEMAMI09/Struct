-- Phase 6 additive and default off. Existing credentials are not regenerated.
create table public.fleet_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into public.fleet_settings values(true,false);
alter table public.fleet_settings enable row level security;
grant all on public.fleet_settings to service_role;
alter table public.devices add column external_id text check(length(external_id)<=128),
 add column serial_number text check(length(serial_number)<=128),add column description text not null default '' check(length(description)<=1000),
 add column fleet_metadata jsonb not null default '{}' check(jsonb_typeof(fleet_metadata)='object' and octet_length(fleet_metadata::text)<=4096),
 add column labels text[] not null default '{}' check(cardinality(labels)<=20),
 add column lifecycle text not null default 'enabled' check(lifecycle in ('enabled','disabled','revoked','deleted')),
 add column admin_version integer not null default 1,
 add column provisioning_exported_at timestamptz,
 add column credential_epoch_first_seen_at timestamptz;
-- Recognition time for existing, durably accepted current-epoch packets. This is
-- independent of retained telemetry and is not advertised as a device timestamp.
update public.devices d set credential_epoch_first_seen_at=now()
where exists(select 1 from public.secure_v2_packets p where p.wire_device_id=d.wire_device_id);
create unique index devices_external_unique on public.devices(organization_id,external_id) where external_id is not null;
create unique index devices_serial_unique on public.devices(organization_id,serial_number) where serial_number is not null;
create index devices_fleet_created on public.devices(organization_id,created_at desc,id);
create index devices_fleet_name on public.devices(organization_id,lower(name) text_pattern_ops,id);
create index devices_fleet_seen on public.devices(organization_id,last_seen desc,id);
create index devices_fleet_lifecycle on public.devices(organization_id,lifecycle,id);
create index devices_fleet_labels on public.devices using gin(labels);
create unique index devices_id_org on public.devices(id,organization_id);
grant select(external_id,serial_number,description,fleet_metadata,labels,lifecycle,admin_version,provisioning_exported_at,credential_epoch_first_seen_at) on public.devices to authenticated;
create table public.device_groups(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,
 name text not null check(length(trim(name)) between 1 and 100),version integer not null default 1,created_at timestamptz not null default now(),
 unique(id,organization_id));
create unique index groups_name on public.device_groups(organization_id,lower(name));
create table public.device_group_members(
 organization_id uuid not null,group_id uuid not null,device_id uuid not null,
 primary key(group_id,device_id),foreign key(group_id,organization_id) references device_groups(id,organization_id) on delete cascade,
 foreign key(device_id,organization_id) references devices(id,organization_id));
create index device_members_device on public.device_group_members(device_id,group_id);
alter table public.device_groups enable row level security;
alter table public.device_group_members enable row level security;
create policy fleet_groups_read on public.device_groups for select to authenticated using(is_org_member(organization_id));
create policy fleet_members_read on public.device_group_members for select to authenticated using(is_org_member(organization_id));
grant select on public.device_groups,public.device_group_members to authenticated;
grant all on public.device_groups,public.device_group_members to service_role;
create table public.fleet_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,actor_id uuid not null references auth.users,
 request_id uuid not null,operation text not null check(operation in ('create','metadata','groups_add','groups_remove','labels_add','labels_remove','enable','disable','revoke','delete','reprovision')),
 options jsonb not null default '{}' check(octet_length(options::text)<=32768),
 status text not null default 'ready' check(status in ('ready','pending','running','completed','completed_with_errors','canceled','expired')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',completed_at timestamptz,
 unique(organization_id,request_id));
create table public.fleet_job_items(
 job_id uuid not null references fleet_jobs on delete cascade,item_index integer not null,
 input jsonb not null check(octet_length(input::text)<=8192),device_id uuid references devices,
 expected_version integer,result_wire_id bigint,status text not null default 'pending' check(status in ('pending','running','created','updated','skipped','failed','canceled')),
 lease_token uuid,lease_until timestamptz,claims integer not null default 0,error_code text,completed_at timestamptz,
 primary key(job_id,item_index));
create index fleet_claim on public.fleet_job_items(job_id,status,item_index);
create index fleet_jobs_schedule on public.fleet_jobs(created_at) where status in ('pending','running');
create table public.fleet_audit(
 id bigint generated always as identity primary key,organization_id uuid not null references organizations,
 actor_id uuid not null,job_id uuid references fleet_jobs,action text not null,affected integer not null default 0,created_at timestamptz not null default now());
create index fleet_audit_org_time on public.fleet_audit(organization_id,created_at desc);
alter table public.fleet_jobs enable row level security;
alter table public.fleet_job_items enable row level security;
alter table public.fleet_audit enable row level security;
create policy fleet_jobs_read on public.fleet_jobs for select to authenticated using(is_org_member(organization_id));
create policy fleet_items_read on public.fleet_job_items for select to authenticated using(exists(select 1 from fleet_jobs j where j.id=job_id and is_org_member(j.organization_id)));
create policy fleet_audit_read on public.fleet_audit for select to authenticated using(is_org_member(organization_id));
grant select on public.fleet_jobs,public.fleet_job_items,public.fleet_audit to authenticated;
grant all on public.fleet_jobs,public.fleet_job_items,public.fleet_audit to service_role;
grant usage,select on sequence public.fleet_audit_id_seq to service_role;

create function public.fleet_authorize(p_org uuid,p_actor uuid,p_write boolean default true) returns void
language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from organization_members where organization_id=p_org and user_id=p_actor and (not p_write or role in ('owner','admin'))) then raise exception 'FLEET_FORBIDDEN';end if;
 if not coalesce((select enabled from fleet_settings where id),false) then raise exception 'FLEET_DISABLED';end if;
end $$;
create function public.fleet_admin_version() returns trigger language plpgsql set search_path=public as $$begin
 if new.wire_device_id is distinct from old.wire_device_id then new.credential_epoch_first_seen_at:=null;new.provisioning_exported_at:=null;end if;
 if row(new.name,new.external_id,new.serial_number,new.description,new.fleet_metadata,new.labels,new.lifecycle,new.wire_device_id,new.secure_v2_enabled,new.key_id,new.api_secret_encrypted) is distinct from row(old.name,old.external_id,old.serial_number,old.description,old.fleet_metadata,old.labels,old.lifecycle,old.wire_device_id,old.secure_v2_enabled,old.key_id,old.api_secret_encrypted) then new.admin_version:=old.admin_version+1;end if;
 return new;
end $$;
create trigger fleet_admin_version before update on public.devices for each row execute function public.fleet_admin_version();
-- Serialize lifecycle changes and ingestion on the same device row, including legacy storage paths.
create function public.fleet_ingestion_guard() returns trigger language plpgsql security definer set search_path=public as $$begin
 perform 1 from devices where id=new.device_id and lifecycle='enabled' for update;
 if not found then raise exception 'DEVICE_NOT_ENABLED';end if;return new;
end $$;
create trigger fleet_ingestion_guard before insert on public.telemetry for each row execute function public.fleet_ingestion_guard();
alter function public.ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb) rename to ingest_secure_v2_before_fleet;
create function public.ingest_secure_v2_telemetry(p_wire_device_id bigint,p_sequence bigint,p_frame_digest bytea,p_schema_slot integer,p_records jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform 1 from devices d join secure_v2_credentials c on c.device_id=d.id where c.wire_device_id=p_wire_device_id and d.lifecycle='enabled' for update of d;
 if not found then raise exception 'DEVICE_NOT_ENABLED';end if;
 result:=ingest_secure_v2_before_fleet(p_wire_device_id,p_sequence,p_frame_digest,p_schema_slot,p_records);
 if (result->>'inserted')::boolean then
  update devices set credential_epoch_first_seen_at=now() where wire_device_id=p_wire_device_id and credential_epoch_first_seen_at is null;
 end if;
 return result;
end $$;
alter function public.bootstrap_secure_v2_counter(bigint,bytea) rename to bootstrap_secure_v2_before_fleet;
create function public.bootstrap_secure_v2_counter(p_wire_device_id bigint,p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path=public as $$begin
 perform 1 from devices d join secure_v2_credentials c on c.device_id=d.id where c.wire_device_id=p_wire_device_id and d.lifecycle='enabled' for update of d;
 if not found then raise exception 'DEVICE_NOT_ENABLED';end if;return bootstrap_secure_v2_before_fleet(p_wire_device_id,p_token_hash);
end $$;
alter function public.enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer) rename to enroll_secure_v2_before_fleet;
create function public.enroll_device_secure_v2(p_device_id uuid,p_org_id uuid,p_root_secret_encrypted text,p_secret_preview text,p_bootstrap_token_encrypted text,p_bootstrap_token_hash bytea,p_rotate boolean default false,p_grace_seconds integer default 0)
returns public.secure_v2_credentials language plpgsql security definer set search_path=public as $$begin
 perform 1 from devices where id=p_device_id and organization_id=p_org_id and lifecycle in ('enabled','disabled') for update;
 if not found then raise exception 'DEVICE_REVOKED_OR_DELETED';end if;
 return enroll_secure_v2_before_fleet(p_device_id,p_org_id,p_root_secret_encrypted,p_secret_preview,p_bootstrap_token_encrypted,p_bootstrap_token_hash,p_rotate,p_grace_seconds);
end $$;
revoke all on function public.ingest_secure_v2_before_fleet(bigint,bigint,bytea,integer,jsonb),public.bootstrap_secure_v2_before_fleet(bigint,bytea),public.enroll_secure_v2_before_fleet(uuid,uuid,text,text,text,bytea,boolean,integer) from public,anon,authenticated,service_role;

create function public.fleet_inventory(p_org uuid,p_actor uuid,p_filter jsonb default '{}',p_page integer default 0,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;begin
 perform fleet_authorize(p_org,p_actor,false);
 if p_filter ? 'schemaDevice' and not exists(select 1 from devices where id=(p_filter->>'schemaDevice')::uuid and organization_id=p_org) then raise exception 'FLEET_FORBIDDEN';end if;
 if p_page not between 0 and 2000 or p_limit not between 1 and 100 or octet_length(p_filter::text)>4096 then raise exception 'INVALID_FLEET_FILTER';end if;
 with filtered as (
 select d.id,d.name,d.external_id,d.serial_number,d.description,d.fleet_metadata,d.labels,d.lifecycle,d.admin_version,d.created_at,d.last_seen,d.first_telemetry_at,d.secure_v2_enabled,d.wire_device_id,d.provisioning_exported_at,d.credential_epoch_first_seen_at,
 case when d.lifecycle<>'enabled' then d.lifecycle when d.first_telemetry_at is null and d.last_seen is null then 'never' when d.last_seen>=now()-make_interval(secs=>greatest(300.0,coalesce(d.expected_report_interval_ms::double precision*3/1000,300.0))) then 'active' else 'inactive' end as activity,
 (select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name),'[]') from device_group_members m join device_groups g on g.id=m.group_id where m.device_id=d.id) as groups
 from devices d where d.organization_id=p_org and (d.lifecycle<>'deleted' or p_filter->>'status'='deleted')
 and (coalesce(p_filter->>'search','')='' or d.name ilike '%'||(p_filter->>'search')||'%' or d.id::text=p_filter->>'search' or d.wire_device_id::text=p_filter->>'search' or d.external_id ilike '%'||(p_filter->>'search')||'%' or d.serial_number ilike '%'||(p_filter->>'search')||'%')
 and (not p_filter ? 'createdAfter' or d.created_at>=(p_filter->>'createdAfter')::timestamptz)
 and (not p_filter ? 'createdBefore' or d.created_at<=(p_filter->>'createdBefore')::timestamptz)
 and (not p_filter ? 'seenAfter' or d.last_seen>=(p_filter->>'seenAfter')::timestamptz)
 and (not p_filter ? 'seenBefore' or d.last_seen<=(p_filter->>'seenBefore')::timestamptz)
 and (not p_filter ? 'group' or exists(select 1 from device_group_members m where m.device_id=d.id and m.group_id=(p_filter->>'group')::uuid))
 and (not p_filter ? 'labels' or d.labels @> array(select jsonb_array_elements_text(p_filter->'labels')))
 and (not p_filter ? 'schemaDevice' or exists(select 1 from secure_v2_schema_slots s join secure_v2_schema_slots source on source.device_id=(p_filter->>'schemaDevice')::uuid and source.slot=coalesce((p_filter->>'schemaSlot')::integer,0) where s.device_id=d.id and s.schema_definition=source.schema_definition and s.encoding=source.encoding))
 ), matches as(select * from filtered where coalesce(p_filter->>'status','')='' or activity=p_filter->>'status'), page as(
 select * from matches order by case when p_filter->>'sort'='name' then lower(name) end asc,case when p_filter->>'sort'='seen' then last_seen end desc nulls last,created_at desc,id limit p_limit offset p_page*p_limit)
 select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'devices',coalesce(jsonb_agg(to_jsonb(page)),'[]')) into result from page;
 return result;
end $$;
create function public.fleet_group(p_org uuid,p_actor uuid,p_id uuid,p_name text,p_version integer,p_delete boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$declare target uuid;begin
 perform fleet_authorize(p_org,p_actor);perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if p_id is null then
  if p_delete or (select count(*) from device_groups where organization_id=p_org)>=200 then raise exception 'GROUP_LIMIT';end if;
  insert into device_groups(organization_id,name)values(p_org,trim(p_name)) returning id into target;
 else
  perform 1 from device_groups where id=p_id and organization_id=p_org and version=p_version for update;
  if not found then raise exception 'GROUP_VERSION_CONFLICT';end if;target:=p_id;
  if p_delete then
   update devices set admin_version=admin_version+1 where id in(select device_id from device_group_members where group_id=p_id);
   delete from device_groups where id=p_id;
  else update device_groups set name=trim(p_name),version=version+1 where id=p_id;end if;
 end if;
 insert into fleet_audit(organization_id,actor_id,action)values(p_org,p_actor,case when p_delete then 'group_delete' else 'group_save' end);return target;
end $$;

create function public.fleet_preview(p_org uuid,p_actor uuid,p_request uuid,p_operation text,p_options jsonb,p_rows jsonb default '[]',p_filter jsonb default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare target uuid;item jsonb;idx integer:=0;page_number integer;estimate jsonb;source secure_v2_schema_slots;opts jsonb:=p_options;entry devices;begin
 perform fleet_authorize(p_org,p_actor);perform 1 from organizations where id=p_org for update;
 select id into target from fleet_jobs where organization_id=p_org and request_id=p_request;
 if target is not null then return target;end if;
 if (select count(*) from fleet_jobs where organization_id=p_org and status in ('ready','pending','running') and (status<>'ready' or expires_at>now()))>=4 then raise exception 'FLEET_PREVIEW_LIMIT';end if;
 if (select count(*) from fleet_jobs where organization_id=p_org and created_at>now()-interval '1 hour')>=20 then raise exception 'FLEET_RATE_LIMIT';end if;
 if octet_length(p_rows::text)>8388608 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 or octet_length(opts::text)>32768 then raise exception 'FLEET_INPUT_LIMIT';end if;
 if opts ? 'sourceDevice' then
  select s.* into source from secure_v2_schema_slots s join devices d on d.id=s.device_id where s.device_id=(opts->>'sourceDevice')::uuid and s.slot=(opts->>'sourceSlot')::integer and d.organization_id=p_org;
  if not found then raise exception 'INVALID_SOURCE_SCHEMA';end if;
  opts:=(opts-'sourceDevice'-'sourceSlot')||jsonb_build_object('schema',to_jsonb(source)-'device_id'-'created_at');
 end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(opts->'groups','[]')) g where not exists(select 1 from device_groups where id=g::uuid and organization_id=p_org)) then raise exception 'INVALID_GROUP';end if;
 insert into fleet_jobs(organization_id,actor_id,request_id,operation,options)values(p_org,p_actor,p_request,p_operation,opts) returning id into target;
 if p_operation='create' then
  for item in select value from jsonb_array_elements(p_rows) loop
   if length(trim(coalesce(item->>'name',''))) not between 1 and 100 or octet_length(item::text)>8192 or jsonb_typeof(coalesce(item->'metadata','{}'))<>'object' or octet_length(coalesce(item->'metadata','{}')::text)>4096 or coalesce(item->>'lifecycle','enabled') not in ('enabled','disabled') or length(coalesce(item->>'external_id',''))>128 or length(coalesce(item->>'serial_number',''))>128 then raise exception 'INVALID_DEVICE_ROW';end if;
   if exists(select 1 from jsonb_array_elements_text(coalesce(item->'groups','[]')) g where not exists(select 1 from device_groups where id=g::uuid and organization_id=p_org)) then raise exception 'INVALID_GROUP';end if;
   insert into fleet_job_items(job_id,item_index,input)values(target,idx,item);idx:=idx+1;
  end loop;
 else
  if p_filter is not null then
   -- Freeze exact current IDs and versions, never rerun a filter during execution.
   for page_number in 0..100 loop
    for item in select value from jsonb_array_elements(fleet_inventory(p_org,p_actor,p_filter,page_number,100)->'devices') loop
     if idx>=10000 then raise exception 'SELECTION_LIMIT_10000';end if;
     insert into fleet_job_items(job_id,item_index,input,device_id,expected_version)values(target,idx,jsonb_build_object('name',item->'name','external_id',item->'external_id','serial_number',item->'serial_number'),(item->>'id')::uuid,(item->>'admin_version')::integer);idx:=idx+1;
    end loop;
    if idx<page_number*100+100 then exit;end if;
   end loop;
  else
   for item in select value from jsonb_array_elements(p_rows) loop
    select * into entry from devices where id=(item->>'id')::uuid and organization_id=p_org;
    if not found then raise exception 'FLEET_FORBIDDEN';end if;
    insert into fleet_job_items(job_id,item_index,input,device_id,expected_version)values(target,idx,jsonb_build_object('name',entry.name,'external_id',entry.external_id,'serial_number',entry.serial_number),entry.id,(item->>'version')::integer);idx:=idx+1;
   end loop;
  end if;
 end if;
 if idx=0 then raise exception 'EMPTY_SELECTION';end if;
 if p_operation='create' then
  estimate:=fleet_creation_estimate(p_org,p_actor,p_rows);
  update fleet_jobs set options=options||jsonb_build_object('review',estimate) where id=target;
 end if;
 if p_operation='create' and (select subscription_tier from organizations where id=p_org)='free' and (select count(*) from devices where organization_id=p_org)+(estimate->>'createsUpperBound')::integer>get_org_device_limit(p_org) then raise exception 'FREE_DEVICE_LIMIT_EXCEEDED';end if;
 insert into fleet_audit(organization_id,actor_id,job_id,action,affected)values(p_org,p_actor,target,'preview:'||p_operation,idx);
 return target;
end $$;
create function public.fleet_job_action(p_org uuid,p_actor uuid,p_job uuid,p_action text) returns void
language plpgsql security definer set search_path=public as $$declare job fleet_jobs;begin
 perform fleet_authorize(p_org,p_actor);perform 1 from organizations where id=p_org for update;
 select * into job from fleet_jobs where id=p_job and organization_id=p_org for update;
 if not found then raise exception 'FLEET_FORBIDDEN';end if;
 if p_action='confirm' then
  if job.status in ('pending','running','completed','completed_with_errors') then return;end if;
  if job.status<>'ready' or job.expires_at<=now() then raise exception 'PREVIEW_EXPIRED';end if;
  if (select count(*) from fleet_jobs where organization_id=p_org and status in ('pending','running'))>=2 then raise exception 'FLEET_CONCURRENT_LIMIT';end if;
  update fleet_jobs set status='pending' where id=p_job;
 elsif p_action='cancel' then
  if job.status not in ('ready','pending','running') then return;end if;
  update fleet_job_items set status='canceled',lease_token=null,lease_until=null,completed_at=now() where job_id=p_job and status in ('pending','running');
  update fleet_jobs set status='canceled',completed_at=now() where id=p_job;
 else raise exception 'INVALID_JOB_ACTION';end if;
 insert into fleet_audit(organization_id,actor_id,job_id,action)values(p_org,p_actor,p_job,p_action);
end $$;
create function public.fleet_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare job fleet_jobs;item fleet_job_items;begin
 if not (select enabled from fleet_settings where id) then return null;end if;
 select j.* into job from fleet_jobs j where j.status in ('pending','running') and exists(select 1 from fleet_job_items i where i.job_id=j.id and (i.status='pending' or i.status='running' and i.lease_until<now()))
 order by (select max(i.lease_until) from fleet_job_items i where i.job_id=j.id) nulls first,j.created_at for update skip locked limit 1;
 if not found then return null;end if;
 select * into item from fleet_job_items where job_id=job.id and (status='pending' or status='running' and lease_until<now()) order by item_index for update skip locked limit 1;
 if not found then return null;end if;
 if item.claims>=3 then
  update fleet_job_items set status='failed',error_code='WORKER_RECOVERY_LIMIT',lease_until=null,lease_token=null,completed_at=now() where job_id=item.job_id and item_index=item.item_index;
  if not exists(select 1 from fleet_job_items where job_id=job.id and status in ('pending','running')) then update fleet_jobs set status='completed_with_errors',completed_at=now() where id=job.id;end if;
 else
  update fleet_job_items set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',claims=claims+1 where job_id=item.job_id and item_index=item.item_index returning * into item;
  update fleet_jobs set status='running' where id=job.id;
  return jsonb_build_object('job',to_jsonb(job),'item',to_jsonb(item));
 end if;
 return null;
end $$;
create function public.fleet_finish(p_job uuid,p_index integer,p_token uuid,p_credentials jsonb default null) returns text
language plpgsql security definer set search_path=public as $$
declare job fleet_jobs;item fleet_job_items;device devices;target uuid;count_current integer;outcome text:='updated';error text;group_id uuid;schema jsonb;cred secure_v2_credentials;begin
 select * into job from fleet_jobs where id=p_job;
 if not found then return 'stale';end if;
 perform pg_advisory_xact_lock(hashtextextended(job.organization_id::text,0));
 select * into job from fleet_jobs where id=p_job for update;
 select * into item from fleet_job_items where job_id=p_job and item_index=p_index for update;
 if not found then return 'stale';end if;
 if job.status not in ('pending','running') or item.status<>'running' or item.lease_token is distinct from p_token or item.lease_until<=now() then return 'stale';end if;
 begin
  perform fleet_authorize(job.organization_id,job.actor_id);
  if job.operation='create' then
   select * into device from devices where organization_id=job.organization_id and (external_id=nullif(item.input->>'external_id','') or serial_number=nullif(item.input->>'serial_number',''));
   if found then
    if coalesce(job.options->>'duplicates','reject')='skip' then outcome:='skipped';target:=device.id;
    elsif job.options->>'duplicates'='metadata' then
     if device.lifecycle in ('revoked','deleted') then raise exception 'DEVICE_REVOKED_OR_DELETED';end if;
     if (nullif(item.input->>'external_id','') is not null and device.external_id is distinct from nullif(item.input->>'external_id','')) or (nullif(item.input->>'serial_number','') is not null and device.serial_number is distinct from nullif(item.input->>'serial_number','')) then raise exception 'DUPLICATE_IDENTITY';end if;
     update devices set description=coalesce(item.input->>'description',description),fleet_metadata=coalesce(item.input->'metadata',fleet_metadata) where id=device.id;target:=device.id;
    else raise exception 'DUPLICATE_IDENTITY';end if;
   else
    select count(*)::integer into count_current from devices where organization_id=job.organization_id;
    device:=create_secure_device_with_usage(job.organization_id,job.actor_id,item.input->>'name',p_credentials->>'key_id',p_credentials->>'api_encrypted',p_credentials->>'api_preview','',count_current,p_credentials->>'root_encrypted',p_credentials->>'root_preview',p_credentials->>'bootstrap_encrypted',decode(p_credentials->>'bootstrap_hash','hex'));
    target:=device.id;outcome:='created';
    update devices set external_id=nullif(item.input->>'external_id',''),serial_number=nullif(item.input->>'serial_number',''),description=coalesce(item.input->>'description',''),fleet_metadata=coalesce(item.input->'metadata','{}'),lifecycle=coalesce(item.input->>'lifecycle','enabled') where id=target;
    schema:=job.options->'schema';
    if schema is not null then perform publish_secure_v2_schema_slot(target,job.organization_id,(schema->>'slot')::integer,schema->>'encoding',schema->'schema_definition',(schema->>'record_bytes')::integer,null,(schema->>'sample_interval_ms')::integer);end if;
   end if;
  else
   select * into device from devices where id=item.device_id and organization_id=job.organization_id for update;
   if not found then raise exception 'FLEET_FORBIDDEN';end if;
   target:=device.id;
   if device.admin_version is distinct from item.expected_version then raise exception 'DEVICE_VERSION_CONFLICT';end if;
   if device.lifecycle in ('revoked','deleted') then raise exception 'DEVICE_REVOKED_OR_DELETED';end if;
   if job.operation='metadata' then
    update devices set description=coalesce(job.options->>'description',description),fleet_metadata=coalesce(job.options->'metadata',fleet_metadata) where id=target;
   elsif job.operation in ('enable','disable','revoke','delete') then
    update devices set lifecycle=case job.operation when 'enable' then 'enabled' when 'disable' then 'disabled' when 'revoke' then 'revoked' else 'deleted' end where id=target;
    if job.operation in ('revoke','delete') then update secure_v2_credentials set revoked_at=coalesce(revoked_at,now()),expires_at=now() where device_id=target;end if;
   elsif job.operation='reprovision' then
    if not device.secure_v2_enabled then raise exception 'SECURE_V2_REQUIRED';end if;
    cred:=enroll_device_secure_v2(target,job.organization_id,p_credentials->>'root_encrypted',p_credentials->>'root_preview',p_credentials->>'bootstrap_encrypted',decode(p_credentials->>'bootstrap_hash','hex'),true,0);
    update devices set provisioning_exported_at=null,admin_version=admin_version+1 where id=target;
   end if;
  end if;
  if outcome<>'skipped' and (job.operation<>'create' or outcome='created') then
   if job.operation in ('create','groups_add') then
    for group_id in select value::uuid from jsonb_array_elements_text(coalesce(job.options->'groups','[]')||case when job.operation='create' then coalesce(item.input->'groups','[]') else '[]'::jsonb end) loop
     if not exists(select 1 from device_groups where id=group_id and organization_id=job.organization_id) then raise exception 'INVALID_GROUP';end if;
     insert into device_group_members values(job.organization_id,group_id,target) on conflict do nothing;
    end loop;
   elsif job.operation='groups_remove' then delete from device_group_members m where m.device_id=target and m.group_id in(select value::uuid from jsonb_array_elements_text(job.options->'groups'));end if;
   if job.operation in ('create','labels_add') then
    update devices set labels=array(select distinct x from unnest(labels||array(select jsonb_array_elements_text(coalesce(job.options->'labels','[]')||case when job.operation='create' then coalesce(item.input->'labels','[]') else '[]'::jsonb end))) x order by x) where id=target;
   elsif job.operation='labels_remove' then update devices set labels=array(select x from unnest(labels) x where not x=any(array(select jsonb_array_elements_text(job.options->'labels')))) where id=target;end if;
   if job.operation in ('groups_add','groups_remove') then update devices set admin_version=admin_version+1 where id=target;end if;
  end if;
 exception when others then
  outcome:='failed';error:=case when sqlerrm like '%FREE_DEVICE_LIMIT%' then 'FREE_DEVICE_LIMIT_EXCEEDED' when sqlerrm like '%VERSION_CONFLICT%' then 'DEVICE_VERSION_CONFLICT' when sqlerrm like '%DUPLICATE%' or sqlstate='23505' then 'DUPLICATE_IDENTITY' when sqlerrm like '%INVALID_GROUP%' then 'INVALID_GROUP' when sqlerrm like '%REVOKED_OR_DELETED%' then 'DEVICE_REVOKED_OR_DELETED' when sqlerrm like '%FORBIDDEN%' then 'FLEET_FORBIDDEN' when sqlerrm like '%FLEET_DISABLED%' then 'FLEET_DISABLED' else 'INVALID_CONFIGURATION_OR_STORAGE_FAILURE' end;
 end;
 update fleet_job_items set status=outcome,device_id=case when outcome='failed' then item.device_id else target end,result_wire_id=case when outcome in ('created','updated') then (select wire_device_id from devices where id=target) else null end,error_code=error,lease_token=null,lease_until=null,completed_at=now() where job_id=p_job and item_index=p_index;
 if not exists(select 1 from fleet_job_items where job_id=p_job and status in ('pending','running')) then
  update fleet_jobs set status=case when exists(select 1 from fleet_job_items where job_id=p_job and status='failed') then 'completed_with_errors' else 'completed' end,completed_at=now() where id=p_job;
  insert into fleet_audit(organization_id,actor_id,job_id,action,affected)select job.organization_id,job.actor_id,p_job,'completed',count(*) from fleet_job_items where job_id=p_job and status in ('created','updated');
 end if;return outcome;
end $$;

create function public.fleet_manifest(p_org uuid,p_actor uuid,p_job uuid,p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform fleet_authorize(p_org,p_actor);perform 1 from fleet_jobs where id=p_job and organization_id=p_org and actor_id=p_actor and operation in ('create','reprovision') for update;
 if not found or cardinality(p_ids) not between 1 and 100 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'INVALID_PROVISIONING_SELECTION';end if;
 perform 1 from devices where id=any(p_ids) order by id for update;
 if (select count(*) from devices d where d.id=any(p_ids) and d.organization_id=p_org and d.lifecycle in ('enabled','disabled') and d.provisioning_exported_at is null and exists(select 1 from fleet_job_items i where i.job_id=p_job and i.device_id=d.id and ((i.status='created' and (select operation from fleet_jobs where id=p_job)='create') or (i.status='updated' and (select operation from fleet_jobs where id=p_job)='reprovision')) and i.result_wire_id=d.wire_device_id))<>cardinality(p_ids) then raise exception 'PROVISIONING_ALREADY_EXPORTED_OR_UNAUTHORIZED';end if;
 select jsonb_agg(jsonb_build_object('deviceId',d.id,'name',d.name,'externalId',d.external_id,'serialNumber',d.serial_number,'wire_device_id',c.wire_device_id,'root_secret_encrypted',c.root_secret_encrypted,'bootstrap_token_encrypted',c.bootstrap_token_encrypted)) into result from devices d join secure_v2_credentials c on c.wire_device_id=d.wire_device_id where d.id=any(p_ids) and c.revoked_at is null and c.bootstrap_consumed_at is null;
 if jsonb_array_length(result) is distinct from cardinality(p_ids) then raise exception 'CREDENTIAL_ALREADY_USED';end if;
 update devices set provisioning_exported_at=now() where id=any(p_ids);
 insert into fleet_audit(organization_id,actor_id,job_id,action,affected)values(p_org,p_actor,p_job,'sensitive_manifest_export',cardinality(p_ids));return result;
end $$;

create or replace function public.integration_match(rule jsonb,event jsonb,depth integer default 0) returns boolean
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
 if field !~ '^(payload\.[a-zA-Z0-9_.-]+|device_id|schema_slot|schema_version|event_type|group_ids|labels)$' then return false;end if;
 actual:=event #> string_to_array(field,'.');
 if op='exists' then return actual is not null and actual<>'null'::jsonb;end if;
 if actual is null or actual='null'::jsonb or expected is null then return false;end if;
 if op='eq' then return actual=expected;end if;
 if op='ne' then return actual<>expected;end if;
 if op='contains' and field in ('group_ids','labels') then return jsonb_typeof(actual)='array' and jsonb_typeof(expected)='string' and actual @> jsonb_build_array(expected);end if;
 if op='contains' then return jsonb_typeof(actual)='string' and jsonb_typeof(expected)='string' and position((expected#>>'{}') in (actual#>>'{}'))>0;end if;
 if (actual#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?$' or (expected#>>'{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then return false;end if;
 left_number:=(actual#>>'{}')::numeric;right_number:=(expected#>>'{}')::numeric;
 return case op when 'gt' then left_number>right_number when 'gte' then left_number>=right_number when 'lt' then left_number<right_number when 'lte' then left_number<=right_number else false end;
exception when others then return false;
end $$;


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
  decision:=jsonb_build_object('payload',new.parsed_json,'device_id',new.device_id,'event_type','telemetry.received','schema_slot',new.secure_v2_schema_slot,'schema_version',schema_version,'group_ids',(select coalesce(jsonb_agg(group_id),'[]') from device_group_members where device_id=new.device_id),'labels',(select to_jsonb(labels) from devices where id=new.device_id));
  for integration in select i.*,d.url from integration_definitions i join destinations d on d.id=i.destination_id
   join devices device on device.id=new.device_id and device.organization_id=i.organization_id
   where d.enabled and i.deleted_at is null loop
   -- A downgrade fails closed for restricted rules instead of broadcasting more data.
   if integration.route is not null and integration.route<>'null'::jsonb and not org_has_entitlement(integration.organization_id,'logical_routing') then continue;end if;
   if not integration_match(integration.route,decision) then continue;end if;
   insert into webhook_deliveries(event_id,organization_id,destination_id,destination_url,device_id,body,integration_snapshot)
   select new.id,integration.organization_id,integration.destination_id,integration.url,new.device_id,
    jsonb_build_object('id',new.id,'type','telemetry.received','device_id',new.device_id,'device_name',device.name,'timestamp',new.timestamp,'payload',new.parsed_json),
    jsonb_build_object('kind',integration.kind,'version',integration.version,'config',integration.config,'route',integration.route,'mapping',integration.mapping,'schema_slot',new.secure_v2_schema_slot,'schema_version',schema_version,'matched_at',now(),'organization_snapshot',jsonb_build_object('group_ids',decision->'group_ids','labels',decision->'labels'))
   from devices device where device.id=new.device_id
   on conflict(event_id,destination_id) do nothing;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.fleet_authorize(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.fleet_authorize(uuid,uuid,boolean) to service_role;
revoke all on function public.fleet_admin_version() from public,anon,authenticated;
grant execute on function public.fleet_admin_version() to service_role;
revoke all on function public.fleet_ingestion_guard() from public,anon,authenticated;
grant execute on function public.fleet_ingestion_guard() to service_role;
revoke all on function public.fleet_inventory(uuid,uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.fleet_inventory(uuid,uuid,jsonb,integer,integer) to service_role;
revoke all on function public.fleet_group(uuid,uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.fleet_group(uuid,uuid,uuid,text,integer,boolean) to service_role;
revoke all on function public.fleet_preview(uuid,uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_preview(uuid,uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.fleet_job_action(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fleet_job_action(uuid,uuid,uuid,text) to service_role;
revoke all on function public.fleet_claim() from public,anon,authenticated;
grant execute on function public.fleet_claim() to service_role;
revoke all on function public.fleet_finish(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_finish(uuid,integer,uuid,jsonb) to service_role;
revoke all on function public.fleet_manifest(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.fleet_manifest(uuid,uuid,uuid,uuid[]) to service_role;
revoke all on function public.ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb) to service_role;
revoke all on function public.bootstrap_secure_v2_counter(bigint,bytea) from public,anon,authenticated;
grant execute on function public.bootstrap_secure_v2_counter(bigint,bytea) to service_role;
revoke all on function public.enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer) from public,anon,authenticated;
grant execute on function public.enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer) to service_role;
create function public.fleet_label_counts(p_org uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform fleet_authorize(p_org,p_actor,false);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select label,count(*) from devices d cross join unnest(d.labels) label where d.organization_id=p_org and d.lifecycle<>'deleted' group by label order by label limit 4000)x;return result;
end $$;
create function public.fleet_job_counts(p_org uuid,p_job uuid) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_object_agg(status,n),'{}') from(select i.status,count(*) n from fleet_job_items i join fleet_jobs j on j.id=i.job_id where j.id=p_job and j.organization_id=p_org group by i.status)x;
$$;
revoke all on function public.fleet_label_counts(uuid,uuid),public.fleet_job_counts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fleet_label_counts(uuid,uuid),public.fleet_job_counts(uuid,uuid) to service_role;
-- Reviewed retries create a NEW preview, not duplicate execution of a completed job.
create function public.fleet_retry_preview(p_org uuid,p_actor uuid,p_job uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path=public as $$declare job fleet_jobs;rows jsonb;begin
 perform fleet_authorize(p_org,p_actor);select * into job from fleet_jobs where id=p_job and organization_id=p_org;
 if not found then raise exception 'FLEET_FORBIDDEN';end if;
 if job.operation='create' then select coalesce(jsonb_agg(input order by item_index),'[]') into rows from fleet_job_items where job_id=p_job and status='failed';
 else select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'version',d.admin_version) order by i.item_index),'[]') into rows from fleet_job_items i join devices d on d.id=i.device_id where i.job_id=p_job and i.status='failed' and d.organization_id=p_org and d.lifecycle not in ('revoked','deleted');end if;
 return fleet_preview(p_org,p_actor,p_request,job.operation,job.options,rows,null);
end $$;
create function public.fleet_cleanup() returns integer language plpgsql security definer set search_path=public as $$declare n integer;begin
 update fleet_jobs set status='expired' where status='ready' and expires_at<=now();
 update fleet_audit set job_id=null where job_id in(select id from fleet_jobs where completed_at<now()-interval '30 days' or status='expired' and created_at<now()-interval '30 days');
 delete from fleet_jobs where completed_at<now()-interval '30 days' or status='expired' and created_at<now()-interval '30 days';get diagnostics n=row_count;
 update fleet_audit set job_id=null where job_id in(select id from(select id,row_number() over(partition by organization_id order by created_at desc) rank from fleet_jobs where status in ('completed','completed_with_errors','canceled','expired')) q where rank>50);
 delete from fleet_jobs where id in(select id from(select id,row_number() over(partition by organization_id order by created_at desc) rank from fleet_jobs where status in ('completed','completed_with_errors','canceled','expired'))q where rank>50);
 delete from fleet_audit where created_at<now()-interval '365 days';return n;
end $$;
revoke all on function public.fleet_retry_preview(uuid,uuid,uuid,uuid),public.fleet_cleanup() from public,anon,authenticated;
grant execute on function public.fleet_retry_preview(uuid,uuid,uuid,uuid),public.fleet_cleanup() to service_role;
create function public.fleet_creation_estimate(p_org uuid,p_actor uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$declare existing integer;total integer;begin
 perform fleet_authorize(p_org,p_actor);if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'FLEET_INPUT_LIMIT';end if;
 total:=jsonb_array_length(p_rows);
 select count(*) into existing from jsonb_array_elements(p_rows) r where exists(select 1 from devices d where d.organization_id=p_org and (d.external_id=nullif(r->>'external_id','') or d.serial_number=nullif(r->>'serial_number','')));
 return jsonb_build_object('total',total,'existing',existing,'createsUpperBound',total-existing);
end $$;
revoke all on function public.fleet_creation_estimate(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_creation_estimate(uuid,uuid,jsonb) to service_role;
-- Inventory/report export is auditable and bounded separately from mutations.
create function public.fleet_export_begin(p_org uuid,p_actor uuid,p_action text) returns void
language plpgsql security definer set search_path=public as $$begin
 perform fleet_authorize(p_org,p_actor,false);perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if (select count(*) from fleet_audit where organization_id=p_org and action='metadata_export' and created_at>now()-interval '1 minute')>=5 then raise exception 'FLEET_EXPORT_RATE_LIMIT';end if;
 insert into fleet_audit(organization_id,actor_id,action)values(p_org,p_actor,'metadata_export');
end $$;
revoke all on function public.fleet_export_begin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fleet_export_begin(uuid,uuid,text) to service_role;
create function public.fleet_group_counts(p_org uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform fleet_authorize(p_org,p_actor,false);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select g.id,g.name,g.version,(select count(*) from device_group_members m join devices d on d.id=m.device_id where m.group_id=g.id and d.lifecycle<>'deleted') count from device_groups g where g.organization_id=p_org order by g.name limit 200)x;return result;
end $$;
revoke all on function public.fleet_group_counts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fleet_group_counts(uuid,uuid) to service_role;
