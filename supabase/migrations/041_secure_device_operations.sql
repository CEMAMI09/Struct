-- Phase 10: optional secure device operations. No telemetry wire or epoch changes.
create table management_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into management_settings values(true,false);
create table firmware_signing_keys(id uuid primary key,organization_id uuid not null references organizations,public_pem text not null check(length(public_pem)<=2048 and public_pem not like '%PRIVATE%'),fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),name text not null check(length(name) between 1 and 80),revoked_at timestamptz,created_by uuid not null,created_at timestamptz not null default now(),unique(organization_id,fingerprint));
create table firmware_artifacts(id uuid primary key,organization_id uuid not null references organizations,key_id uuid not null references firmware_signing_keys,manifest jsonb not null,canonical text not null check(length(canonical)<=1024),signature text not null check(length(signature)<=128),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),size integer not null check(size between 256 and 4194304),object_path text not null unique,state text not null default 'draft' check(state in ('draft','verified','approved','revoked')),release_notes text not null default '' check(length(release_notes)<=4000),channel text not null default 'testing' check(channel in ('testing','stable')),created_by uuid not null,approved_by uuid,created_at timestamptz not null default now(),approved_at timestamptz);
create unique index firmware_version_identity on firmware_artifacts(organization_id,(manifest->>'hardwareModel'),(manifest->>'hardwareRevision'),(manifest->>'version'));
create table device_management_profiles(device_id uuid primary key references devices,organization_id uuid not null references organizations,wire_device_id bigint not null,capabilities jsonb not null default '{}',enabled boolean not null default false,last_checkin timestamptz,next_generation bigint not null default 0,reported_firmware jsonb,desired_config jsonb,reported_config jsonb,reported_config_generation bigint not null default 0,security_version integer not null default 0,updated_at timestamptz not null default now());
create index management_profiles_org on device_management_profiles(organization_id,enabled,last_checkin desc);
create table management_challenges(id uuid primary key,wire_device_id bigint not null,nonce_hash text not null,body_hash text not null,expires_at timestamptz not null default now()+interval '60 seconds',used_at timestamptz,created_at timestamptz not null default now());
create index management_challenge_expiry on management_challenges(expires_at);
create index management_challenge_device on management_challenges(wire_device_id,created_at desc);
create table firmware_rollouts(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,created_by uuid not null,approved_by uuid,request_id uuid not null,kind text not null check(kind in ('firmware','configuration')),artifact_id uuid references firmware_artifacts,configuration jsonb,definition jsonb not null,state text not null default 'draft' check(state in ('draft','scheduled','running','paused','completed','canceled')),wave integer not null default 1,waves integer not null default 1,manual_advance boolean not null default true,starts_at timestamptz not null default now(),ends_at timestamptz not null default now()+interval '7 days',wave_started_at timestamptz,observation_seconds integer not null default 60 check(observation_seconds between 0 and 86400),minimum_samples integer not null default 1 check(minimum_samples between 1 and 1000),failure_percent numeric not null default 5 check(failure_percent between 0 and 100),max_concurrent integer not null default 10 check(max_concurrent between 1 and 100),per_minute integer not null default 30 check(per_minute between 1 and 1000),timeout_seconds integer not null default 3600 check(timeout_seconds between 60 and 604800),reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,request_id),check((kind='firmware' and artifact_id is not null and configuration is null) or (kind='configuration' and artifact_id is null and configuration is not null)));
create index firmware_rollouts_due on firmware_rollouts(updated_at) where state in ('scheduled','running');
create table rollout_targets(rollout_id uuid not null references firmware_rollouts,organization_id uuid not null references organizations,device_id uuid not null references devices,wave integer not null,eligible boolean not null,reason text,snapshot jsonb not null,state text not null default 'waiting' check(state in ('waiting','dispatched','ineligible','canceled')),primary key(rollout_id,device_id));
create index rollout_targets_waiting on rollout_targets(rollout_id,wave,state);
create table device_operations(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,device_id uuid not null references devices,wire_device_id bigint not null,rollout_id uuid not null references firmware_rollouts,wave integer not null,kind text not null,artifact_id uuid references firmware_artifacts,configuration jsonb,generation bigint not null,state text not null default 'available' check(state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting','healthy','applied','rejected','failed','rolled_back','unknown','canceled')),error_category text,created_at timestamptz not null default now(),assigned_at timestamptz,reported_at timestamptz,completed_at timestamptz,unique(device_id,generation),unique(rollout_id,device_id));
create unique index management_one_active on device_operations(device_id) where state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting');
create index management_operations_org_time on device_operations(organization_id,created_at desc,id);
create index management_operations_device on device_operations(device_id,generation desc);
create table device_operation_events(id bigint generated always as identity primary key,organization_id uuid not null,operation_id uuid not null references device_operations,stage text not null,evidence text not null check(evidence in ('server','authenticated_device_claim')),category text,created_at timestamptz not null default now());
create index management_events_operation on device_operation_events(operation_id,id);
create table firmware_download_tokens(id uuid primary key,operation_id uuid not null references device_operations,wire_device_id bigint not null,token_hash text not null,expires_at timestamptz not null default now()+interval '10 minutes');
create table firmware_transfer_metrics(id bigint generated always as identity primary key,organization_id uuid not null,operation_id uuid not null,bytes bigint not null check(bytes>=0),complete boolean not null,created_at timestamptz not null default now());

do $$declare t text;begin foreach t in array array['management_settings','firmware_signing_keys','firmware_artifacts','device_management_profiles','management_challenges','firmware_rollouts','rollout_targets','device_operations','device_operation_events','firmware_download_tokens','firmware_transfer_metrics'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant all on %I to service_role',t);
end loop;end $$;
grant usage,select on sequence device_operation_events_id_seq,firmware_transfer_metrics_id_seq to service_role;

-- Supabase Storage is optional in disposable SQL fixtures, mandatory for default deployment.
do $$begin if to_regclass('storage.buckets') is not null then
 if exists(select 1 from storage.buckets where id='struct-firmware' and public) then raise exception 'FIRMWARE_BUCKET_MUST_BE_PRIVATE';end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('struct-firmware','struct-firmware',false,4194304,array['application/octet-stream']) on conflict(id) do nothing;
 execute 'create policy struct_firmware_private_only on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>''struct-firmware'') with check(bucket_id<>''struct-firmware'')';
end if;end $$;

create function management_enabled() returns void language plpgsql security definer set search_path=public as $$begin if not coalesce((select enabled from management_settings where id),false) then raise exception 'MANAGEMENT_DISABLED';end if;end $$;
create function management_config_valid(c jsonb) returns boolean language plpgsql immutable as $$begin
 return jsonb_typeof(c)='object' and (select count(*) from jsonb_object_keys(c))=3 and c ?& array['reportIntervalSeconds','sampleIntervalSeconds','diagnosticLevel'] and jsonb_typeof(c->'reportIntervalSeconds')='number' and jsonb_typeof(c->'sampleIntervalSeconds')='number' and (c->>'reportIntervalSeconds')::integer between 10 and 86400 and (c->>'sampleIntervalSeconds')::integer between 1 and (c->>'reportIntervalSeconds')::integer and c->>'diagnosticLevel' in ('none','error','info');exception when others then return false;end $$;
create function management_identity(p_wire bigint) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform management_enabled();perform enterprise_check_recovery();
 select jsonb_build_object('deviceId',d.id,'organizationId',d.organization_id,'rootEncrypted',c.root_secret_encrypted,'wireDeviceId',d.wire_device_id) into result from devices d join secure_v2_credentials c on c.wire_device_id=d.wire_device_id where d.wire_device_id=p_wire and d.lifecycle='enabled' and d.secure_v2_enabled and c.revoked_at is null and (c.expires_at is null or c.expires_at>now());
 if result is null then raise exception 'MANAGEMENT_UNAVAILABLE';end if;return result;end $$;
create function management_challenge(p_wire bigint,p_id uuid,p_nonce_hash text,p_body_hash text) returns void language plpgsql security definer set search_path=public as $$begin
 perform management_identity(p_wire);if p_nonce_hash !~ '^[a-f0-9]{64}$' or p_body_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_CHALLENGE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_wire::text,10));
 -- Remove expired records for the requesting identity; unauthenticated challenge
 -- requests cannot accumulate an unlimited history behind a slow global cleanup.
 delete from management_challenges where id in(select id from management_challenges where wire_device_id=p_wire and expires_at<now() order by expires_at limit 1000);
 if (select count(*) from management_challenges where wire_device_id=p_wire and created_at>now()-interval '1 minute')>=60 then raise exception 'MANAGEMENT_RATE_LIMIT';end if;
 insert into management_challenges(id,wire_device_id,nonce_hash,body_hash) values(p_id,p_wire,p_nonce_hash,p_body_hash);
end $$;
create function management_eligible(p_device uuid,p_artifact uuid,p_kind text) returns text language plpgsql security definer set search_path=public as $$declare p device_management_profiles;d devices;a firmware_artifacts;k firmware_signing_keys;begin
 select * into d from devices where id=p_device;select * into p from device_management_profiles where device_id=p_device;
 if d.secure_v2_enabled is not true or not exists(select 1 from secure_v2_credentials where wire_device_id=d.wire_device_id and device_id=d.id and revoked_at is null and (expires_at is null or expires_at>now())) then return 'current_credential_unavailable';end if;
 if d.lifecycle<>'enabled' then return 'device_disabled_or_revoked';end if;
 if p.device_id is null or not p.enabled or p.wire_device_id<>d.wire_device_id then return 'management_not_enrolled_for_current_epoch';end if;
 if p_kind='configuration' then if (p.capabilities->>'configuration')::boolean is not true then return 'configuration_unsupported';end if;return null;end if;
 select * into a from firmware_artifacts where id=p_artifact;select * into k from firmware_signing_keys where id=a.key_id;
 if a.id is null or k.id is null or a.organization_id is distinct from d.organization_id or a.state is distinct from 'approved' or k.revoked_at is not null then return 'artifact_not_approved_or_key_revoked';end if;
 if a.manifest->>'identityMode' is distinct from 'persistent-nvs-v1' then return 'identity_preservation_required';end if;
 if (p.capabilities->>'ota')::boolean is not true or (p.capabilities->>'rollback')::boolean is not true then return 'verified_ota_and_bootloader_rollback_required';end if;
 if p.capabilities->>'platform'<>a.manifest->>'platform' or p.capabilities->>'hardwareModel'<>a.manifest->>'hardwareModel' or p.capabilities->>'hardwareRevision'<>a.manifest->>'hardwareRevision' then return 'hardware_mismatch';end if;
 if (p.capabilities->>'partitionBytes')::integer<a.size or (p.capabilities->>'agentVersion')::integer<(a.manifest->>'minAgentVersion')::integer or (p.capabilities->>'bootloaderVersion')::integer<(a.manifest->>'minimumBootloaderVersion')::integer then return 'partition_agent_or_bootloader_incompatible';end if;
 if not (p.capabilities->'keyFingerprints' ? k.fingerprint) then return 'signing_key_not_device_anchored';end if;
 if greatest(p.security_version,coalesce((p.capabilities->>'securityVersion')::integer,0))>(a.manifest->>'securityVersion')::integer then return 'security_downgrade_forbidden';end if;
 if p.reported_firmware->>'sha256'=a.sha256 then return 'already_running_artifact';end if;return null;end $$;

create function management_admin(p_org uuid,p_actor uuid,p_action text,p_data jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare a firmware_artifacts;k firmware_signing_keys;d devices;r firmware_rollouts;result jsonb;begin
 perform management_enabled();perform enterprise_bind_actor(p_org,p_actor,case p_action when 'key' then 'firmware.manage_signing_keys' when 'revoke_key' then 'firmware.manage_signing_keys' when 'artifact' then 'firmware.upload' when 'uploaded' then 'firmware.upload' when 'approve' then 'firmware.approve' when 'enable_device' then 'device_operations.manage' when 'confirm' then case when p_data->>'kind'='configuration' then 'configuration.deploy' else 'firmware.deploy' end when 'advance' then 'firmware.deploy' when 'pause' then 'firmware.cancel' when 'resume' then 'firmware.deploy' when 'cancel' then 'firmware.cancel' else 'unknown' end,p_request);
 if octet_length(p_data::text)>20000 then raise exception 'INVALID_MANAGEMENT_DATA';end if;
 if (select count(*) from audit_logs where organization_id=p_org and event_action like 'management.%' and created_at>now()-interval '1 hour')>=120 then raise exception 'MANAGEMENT_ACTION_LIMIT';end if;
 if p_action='key' then
  if (select count(*) from firmware_signing_keys where organization_id=p_org)>=100 then raise exception 'MANAGEMENT_SIGNING_KEY_LIMIT';end if;
  insert into firmware_signing_keys(id,organization_id,public_pem,fingerprint,name,created_by) values((p_data->>'id')::uuid,p_org,p_data->>'publicPem',p_data->>'fingerprint',p_data->>'name',p_actor) returning to_jsonb(firmware_signing_keys) into result;
 elsif p_action='revoke_key' then update firmware_signing_keys set revoked_at=coalesce(revoked_at,now()) where id=(p_data->>'id')::uuid and organization_id=p_org returning jsonb_build_object('id',id) into result;
 elsif p_action='artifact' then
  select * into k from firmware_signing_keys where id=(p_data->'manifest'->>'keyId')::uuid and organization_id=p_org and revoked_at is null;if not found then raise exception 'INVALID_SIGNING_KEY';end if;
  if (select coalesce(sum(size),0) from firmware_artifacts where organization_id=p_org)+(p_data->'manifest'->>'size')::integer>536870912 then raise exception 'FIRMWARE_STORAGE_LIMIT';end if;
  if (select count(*) from firmware_artifacts where organization_id=p_org)>=1000 then raise exception 'MANAGEMENT_ARTIFACT_LIMIT';end if;
  if p_data->'manifest'->>'organizationId'<>p_org::text then raise exception 'FOREIGN_ARTIFACT';end if;
  insert into firmware_artifacts(id,organization_id,key_id,manifest,canonical,signature,sha256,size,object_path,release_notes,channel,created_by) values((p_data->'manifest'->>'artifactId')::uuid,p_org,k.id,p_data->'manifest',p_data->>'canonical',p_data->>'signature',p_data->'manifest'->>'sha256',(p_data->'manifest'->>'size')::integer,p_org::text||'/'||(p_data->'manifest'->>'artifactId')||'.bin',coalesce(p_data->>'releaseNotes',''),coalesce(p_data->>'channel','testing'),p_actor) returning to_jsonb(firmware_artifacts) into result;
 elsif p_action in ('uploaded','approve') then
  select * into a from firmware_artifacts where id=(p_data->>'id')::uuid and organization_id=p_org for update;if not found then raise exception 'ARTIFACT_UNAVAILABLE';end if;
  if p_action='uploaded' then if a.sha256<>p_data->>'sha256' or a.size<>(p_data->>'size')::integer or a.state not in ('draft','verified') then raise exception 'ARTIFACT_INTEGRITY_CONFLICT';end if;update firmware_artifacts set state='verified' where id=a.id;
  else if a.state<>'verified' or exists(select 1 from firmware_signing_keys where id=a.key_id and revoked_at is not null) then raise exception 'ARTIFACT_NOT_VERIFIED';end if;update firmware_artifacts set state='approved',approved_by=p_actor,approved_at=now() where id=a.id;end if;
  result:=jsonb_build_object('id',a.id);
 elsif p_action='enable_device' then
  select * into d from devices where id=(p_data->>'id')::uuid and organization_id=p_org and lifecycle='enabled' for update;if not found then raise exception 'DEVICE_UNAVAILABLE';end if;
  update device_management_profiles set enabled=(p_data->>'enabled')::boolean,updated_at=now() where device_id=d.id and wire_device_id=d.wire_device_id returning jsonb_build_object('id',device_id,'enabled',enabled) into result;
 else
  select * into r from firmware_rollouts where id=(p_data->>'id')::uuid and organization_id=p_org for update;if not found then raise exception 'ROLLOUT_UNAVAILABLE';end if;
  if p_action='confirm' then
   perform require_org_permission(p_org,p_actor,case when r.kind='configuration' then 'configuration.deploy' else 'firmware.deploy' end);
   if (p_data->>'confirm')::boolean is distinct from true or r.state<>'draft' or not exists(select 1 from rollout_targets where rollout_id=r.id and eligible) then raise exception 'INVALID_ROLLOUT_CONFIRMATION';end if;
   update firmware_rollouts set state='scheduled',approved_by=p_actor,updated_at=now() where id=r.id;
  elsif p_action='pause' and r.state in ('running','scheduled') then update firmware_rollouts set state='paused',reason='manual_pause',updated_at=now() where id=r.id;
  elsif p_action='resume' and r.state='paused' then update firmware_rollouts set state='running',reason=null,updated_at=now() where id=r.id;
  elsif p_action='advance' and r.state='running' then
   if not management_wave_ready(r.id) then raise exception 'WAVE_EVIDENCE_INCOMPLETE';end if;
   update firmware_rollouts set wave=wave+1,wave_started_at=now(),updated_at=now() where id=r.id and wave<waves;
  elsif p_action='cancel' and r.state in ('draft','scheduled','running','paused') then
   update firmware_rollouts set state='canceled',reason='unstarted_work_canceled',updated_at=now() where id=r.id;
   update rollout_targets set state='canceled' where rollout_id=r.id and state='waiting';
   update device_operations set state='canceled',completed_at=now() where rollout_id=r.id and state='available';
  else raise exception 'INVALID_ROLLOUT_TRANSITION';end if;
  result:=jsonb_build_object('id',r.id);
 end if;
 if result is null then raise exception 'MANAGEMENT_RESOURCE_UNAVAILABLE';end if;
 perform enterprise_audit(p_org,p_actor,'management.'||p_action,'device_operation',coalesce((result->>'id')::uuid,p_org),'success',p_request,null,jsonb_build_object('action',p_action));return result;
end $$;

create function management_preview(p_org uuid,p_actor uuid,p_request uuid,p_definition jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare r firmware_rollouts;s jsonb:=p_definition->'selection';d record;why text;count_all integer:=0;eligible_count integer;percentages integer[];previous integer:=0;percent integer;idx integer:=0;begin
 perform management_enabled();perform enterprise_bind_actor(p_org,p_actor,case when p_definition->>'kind'='configuration' then 'configuration.update' else 'firmware.deploy' end,p_request);
 if octet_length(p_definition::text)>262144 or jsonb_typeof(s)<>'object' or p_definition->>'kind' not in ('firmware','configuration') then raise exception 'INVALID_ROLLOUT';end if;
 select * into r from firmware_rollouts where organization_id=p_org and request_id=p_request;if found then if r.definition<>p_definition then raise exception 'IDEMPOTENCY_CONFLICT';end if;return r.id;end if;
 if (select count(*) from firmware_rollouts where organization_id=p_org)>=1000 then raise exception 'MANAGEMENT_HISTORY_LIMIT';end if;
 if (select count(*) from audit_logs where organization_id=p_org and event_action like 'management.%' and created_at>now()-interval '1 hour')>=120 then raise exception 'MANAGEMENT_ACTION_LIMIT';end if;
 if not(s ? 'ids' or s ? 'group' or s ? 'tag' or (s->>'all')::boolean is true) then raise exception 'EXPLICIT_SELECTION_REQUIRED';end if;
 if s ? 'ids' and (jsonb_array_length(s->'ids')>10000 or exists(select 1 from jsonb_array_elements_text(s->'ids') x where not exists(select 1 from devices where id=x::uuid and organization_id=p_org))) then raise exception 'FOREIGN_DEVICE_REFERENCE';end if;
 if s ? 'group' and not exists(select 1 from device_groups where id=(s->>'group')::uuid and organization_id=p_org) then raise exception 'FOREIGN_GROUP_REFERENCE';end if;
 if p_definition->>'kind'='configuration' and not management_config_valid(p_definition->'configuration') then raise exception 'INVALID_CONFIGURATION';end if;
 if p_definition->>'kind'='firmware' and not exists(select 1 from firmware_artifacts where id=(p_definition->>'artifactId')::uuid and organization_id=p_org and state='approved') then raise exception 'ARTIFACT_NOT_APPROVED';end if;
 percentages:=array(select jsonb_array_elements_text(coalesce(p_definition->'wavePercentages','[1,10,25,100]'))::integer);
 if cardinality(percentages) not between 1 and 6 or percentages[cardinality(percentages)]<>100 then raise exception 'INVALID_WAVES';end if;
 foreach percent in array percentages loop if percent<=previous or percent>100 then raise exception 'INVALID_WAVES';end if;previous:=percent;end loop;
 insert into firmware_rollouts(organization_id,created_by,request_id,kind,artifact_id,configuration,definition,waves,manual_advance,starts_at,ends_at,observation_seconds,minimum_samples,failure_percent,max_concurrent,per_minute,timeout_seconds)
 values(p_org,p_actor,p_request,p_definition->>'kind',(p_definition->>'artifactId')::uuid,p_definition->'configuration',p_definition,cardinality(percentages),coalesce((p_definition->>'manualAdvance')::boolean,true),coalesce((p_definition->>'startsAt')::timestamptz,now()),coalesce((p_definition->>'endsAt')::timestamptz,now()+interval '7 days'),coalesce((p_definition->>'observationSeconds')::integer,60),coalesce((p_definition->>'minimumSamples')::integer,1),coalesce((p_definition->>'failurePercent')::numeric,5),coalesce((p_definition->>'maxConcurrent')::integer,10),coalesce((p_definition->>'perMinute')::integer,30),coalesce((p_definition->>'timeoutSeconds')::integer,3600)) returning * into r;
 if r.ends_at<=r.starts_at or r.ends_at-r.starts_at>interval '30 days' then raise exception 'INVALID_ROLLOUT_WINDOW';end if;
 for d in select dd.id,dd.admin_version,dd.wire_device_id,p.capabilities from devices dd left join device_management_profiles p on p.device_id=dd.id where dd.organization_id=p_org and dd.lifecycle<>'deleted'
  and (not s ? 'ids' or dd.id in (select x::uuid from jsonb_array_elements_text(s->'ids')x))
  and (not s ? 'group' or exists(select 1 from device_group_members m where m.device_id=dd.id and m.group_id=(s->>'group')::uuid))
  and (not s ? 'tag' or dd.labels @> array[s->>'tag'])
  and (not s ? 'hardwareModel' or p.capabilities->>'hardwareModel'=s->>'hardwareModel')
  and (not s ? 'firmwareVersion' or coalesce(p.reported_firmware->>'version',p.capabilities->>'firmwareVersion')=s->>'firmwareVersion') order by md5(dd.id::text||r.id::text) limit 10001 loop
   count_all:=count_all+1;if count_all>10000 then raise exception 'ROLLOUT_TARGET_LIMIT';end if;
   why:=management_eligible(d.id,r.artifact_id,r.kind);
   insert into rollout_targets(rollout_id,organization_id,device_id,wave,eligible,reason,snapshot,state) values(r.id,p_org,d.id,1,why is null,why,jsonb_build_object('wireDeviceId',d.wire_device_id,'adminVersion',d.admin_version,'capabilities',d.capabilities),case when why is null then 'waiting' else 'ineligible' end);
 end loop;
 if (select count(*) from rollout_targets where organization_id=p_org)>1000000 then raise exception 'MANAGEMENT_TARGET_HISTORY_LIMIT';end if;
 select count(*) into eligible_count from rollout_targets where rollout_id=r.id and eligible;
 with ranked as (select device_id,row_number() over(order by md5(device_id::text||r.id::text)) rank from rollout_targets where rollout_id=r.id and eligible) update rollout_targets t set wave=(select min(i) from generate_subscripts(percentages,1)i where greatest(1,ceil(eligible_count*percentages[i]/100.0))>=ranked.rank) from ranked where t.rollout_id=r.id and t.device_id=ranked.device_id;
 perform enterprise_audit(p_org,p_actor,'management.preview','rollout',r.id,'success',p_request,r.id::text,jsonb_build_object('count',count_all));return r.id;
end $$;
create function management_wave_ready(p_rollout uuid) returns boolean language plpgsql security definer set search_path=public as $$declare r firmware_rollouts;total integer;success integer;waiting integer;begin
 select * into r from firmware_rollouts where id=p_rollout;
 select count(*),count(*) filter(where state in ('healthy','applied')) into total,success from device_operations where rollout_id=r.id and wave=r.wave;
 select count(*) into waiting from rollout_targets where rollout_id=r.id and wave=r.wave and state='waiting' and eligible;
 return waiting=0 and total=success and success>=least(r.minimum_samples,(select count(*) from rollout_targets where rollout_id=r.id and wave=r.wave and eligible)) and r.wave_started_at is not null and now()>=r.wave_started_at+make_interval(secs=>r.observation_seconds);
end $$;
create index management_operations_expiry on device_operations(created_at) where state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting');
create function management_expire(p_limit integer default 100) returns integer language plpgsql security definer set search_path=public as $$declare changed integer;begin
 perform management_enabled();if p_limit not between 1 and 1000 then raise exception 'INVALID_EXPIRY_BOUND';end if;
 with due as(select o.id from device_operations o join firmware_rollouts r on r.id=o.rollout_id where o.state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting') and o.created_at<now()-interval '60 seconds' and o.created_at<now()-make_interval(secs=>r.timeout_seconds) order by o.created_at limit p_limit for update of o skip locked),
 expired as(update device_operations set state='unknown',error_category='confirmation_timeout',completed_at=now() where id in(select id from due) returning id,organization_id)
 insert into device_operation_events(organization_id,operation_id,stage,evidence,category) select organization_id,id,'unknown','server','confirmation_timeout' from expired;
 get diagnostics changed=row_count;return changed;
end $$;
create function management_tick(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$declare r firmware_rollouts;t rollout_targets;p device_management_profiles;o device_operations;active integer;recent integer;created integer:=0;failed integer;total integer;why text;begin
 perform management_enabled();if p_limit not between 1 and 100 then raise exception 'INVALID_TICK_BOUND';end if;perform management_expire(p_limit);
 select * into r from firmware_rollouts where state in ('scheduled','running') and starts_at<=now() order by updated_at,id for update skip locked limit 1;if not found then return jsonb_build_object('scheduled',0);end if;
 if not org_has_permission(r.organization_id,coalesce(r.approved_by,r.created_by),case when r.kind='firmware' then 'firmware.deploy' else 'configuration.deploy' end) then update firmware_rollouts set state='paused',reason='initiator_permission_changed',updated_at=now() where id=r.id;return jsonb_build_object('paused',true);end if;
 if now()>r.ends_at then update firmware_rollouts set state='paused',reason='maintenance_or_rollout_window_ended',updated_at=now() where id=r.id;return jsonb_build_object('paused',true);end if;
 update firmware_rollouts set state='running',wave_started_at=coalesce(wave_started_at,now()),updated_at=now() where id=r.id;
 select count(*),count(*) filter(where state in ('failed','rejected','rolled_back','unknown')) into total,failed from device_operations where rollout_id=r.id and wave=r.wave;
 if failed>0 and failed*100.0/greatest(total,1)>=r.failure_percent then update firmware_rollouts set state='paused',reason='failure_or_unknown_threshold',updated_at=now() where id=r.id;return jsonb_build_object('paused',true);end if;
 if management_wave_ready(r.id) then
  if r.wave=r.waves or not exists(select 1 from rollout_targets where rollout_id=r.id and eligible and wave>r.wave) then update firmware_rollouts set state='completed',updated_at=now() where id=r.id;
  elsif not r.manual_advance then update firmware_rollouts set wave=wave+1,wave_started_at=now(),updated_at=now() where id=r.id;end if;
  return jsonb_build_object('waveReady',true);
 end if;
 select count(*) into active from device_operations where rollout_id=r.id and state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting');
 select count(*) into recent from device_operations where rollout_id=r.id and created_at>now()-interval '1 minute';
 for t in select * from rollout_targets where rollout_id=r.id and wave=r.wave and eligible and state='waiting' order by device_id limit least(p_limit,greatest(0,r.max_concurrent-active),greatest(0,r.per_minute-recent)) for update skip locked loop
  select * into p from device_management_profiles where device_id=t.device_id for update;
  why:=management_eligible(t.device_id,r.artifact_id,r.kind);
  if why is not null or p.wire_device_id<>(t.snapshot->>'wireDeviceId')::bigint then update rollout_targets set eligible=false,state='ineligible',reason=coalesce(why,'credential_epoch_changed') where rollout_id=r.id and device_id=t.device_id;update firmware_rollouts set state='paused',reason='eligibility_changed',updated_at=now() where id=r.id;return jsonb_build_object('paused',true);end if;
  if exists(select 1 from device_operations where device_id=t.device_id and state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting')) then continue;end if;
  if p.next_generation>=9007199254740991 then raise exception 'MANAGEMENT_GENERATION_EXHAUSTED';end if;
  update device_management_profiles set next_generation=next_generation+1,desired_config=case when r.kind='configuration' then r.configuration else desired_config end where device_id=p.device_id returning * into p;
  insert into device_operations(organization_id,device_id,wire_device_id,rollout_id,wave,kind,artifact_id,configuration,generation) values(r.organization_id,t.device_id,p.wire_device_id,r.id,r.wave,r.kind,r.artifact_id,r.configuration,p.next_generation) returning * into o;
  insert into device_operation_events(organization_id,operation_id,stage,evidence) values(r.organization_id,o.id,'available','server');
  update rollout_targets set state='dispatched' where rollout_id=r.id and device_id=t.device_id;created:=created+1;
 end loop;
 return jsonb_build_object('scheduled',created,'rolloutId',r.id);
end $$;

create function management_device(p_wire bigint,p_challenge uuid,p_nonce_hash text,p_body_hash text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$declare identity jsonb;c management_challenges;p device_management_profiles;o device_operations;a firmware_artifacts;k firmware_signing_keys;r firmware_rollouts;target text;result jsonb;begin
 identity:=management_identity(p_wire);
 perform 1 from devices where id=(identity->>'deviceId')::uuid and wire_device_id=p_wire and lifecycle='enabled' for update;if not found then raise exception 'MANAGEMENT_UNAVAILABLE';end if;
 select * into c from management_challenges where id=p_challenge for update;
 if not found or c.wire_device_id<>p_wire or c.nonce_hash<>p_nonce_hash or c.body_hash<>p_body_hash or c.used_at is not null or c.expires_at<=now() then raise exception 'CHALLENGE_EXPIRED_OR_REPLAYED';end if;
 update management_challenges set used_at=now() where id=c.id;
 if octet_length(p_data::text)>16384 then raise exception 'INVALID_DEVICE_MESSAGE';end if;
 if p_action='capabilities' then
  if p_data->>'agentVersion'<>'1' then raise exception 'UNSUPPORTED_AGENT';end if;
  insert into device_management_profiles(device_id,organization_id,wire_device_id,capabilities,last_checkin) values((identity->>'deviceId')::uuid,(identity->>'organizationId')::uuid,p_wire,p_data,now()) on conflict(device_id) do update set enabled=case when device_management_profiles.wire_device_id=excluded.wire_device_id and (device_management_profiles.capabilities-array['firmwareVersion','securityVersion'])=(excluded.capabilities-array['firmwareVersion','securityVersion']) then device_management_profiles.enabled else false end,wire_device_id=excluded.wire_device_id,capabilities=excluded.capabilities,last_checkin=now(),updated_at=now();return jsonb_build_object('registered',true,'approvalRequired',true);
 end if;
 select * into p from device_management_profiles where device_id=(identity->>'deviceId')::uuid for update;
 if not found or not p.enabled or p.wire_device_id<>p_wire then raise exception 'MANAGEMENT_NOT_ENROLLED';end if;
 update device_management_profiles set last_checkin=now() where device_id=p.device_id;
 if p_action='poll' then
  select * into o from device_operations where device_id=p.device_id and wire_device_id=p_wire and state in ('available','assigned','downloading','verified','installing','awaiting_reboot','booting') order by generation limit 1 for update;
  if not found then return jsonb_build_object('operation',null,'pollAfterSeconds',60);end if;
  select * into r from firmware_rollouts where id=o.rollout_id;
  if now()<r.starts_at or now()>=least(r.ends_at,o.created_at+make_interval(secs=>r.timeout_seconds)) then return jsonb_build_object('operation',null,'pollAfterSeconds',60,'reason','execution_window_closed');end if;
  if o.state='available' then update device_operations set state='assigned',assigned_at=now() where id=o.id returning * into o;insert into device_operation_events(organization_id,operation_id,stage,evidence) values(o.organization_id,o.id,'assigned','server');end if;
  result:=jsonb_build_object('id',o.id,'kind',o.kind,'generation',o.generation,'state',o.state,'configuration',o.configuration,'remainingSeconds',greatest(0,floor(extract(epoch from(least(r.ends_at,o.created_at+make_interval(secs=>r.timeout_seconds))-now())))));
  if o.kind='firmware' then
   select * into a from firmware_artifacts where id=o.artifact_id;select * into k from firmware_signing_keys where id=a.key_id;
   if a.state<>'approved' or k.revoked_at is not null then raise exception 'ARTIFACT_UNAVAILABLE';end if;
   if p_data->>'downloadHash' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_DOWNLOAD_TOKEN';end if;
   insert into firmware_download_tokens(id,operation_id,wire_device_id,token_hash) values((p_data->>'downloadId')::uuid,o.id,p_wire,p_data->>'downloadHash');
   result:=result||jsonb_build_object('canonical',a.canonical,'manifest',a.manifest,'signature',a.signature,'keyFingerprint',k.fingerprint);
  end if;return jsonb_build_object('operation',result,'pollAfterSeconds',60);
 elsif p_action='report' then
  select * into o from device_operations where id=(p_data->>'id')::uuid and device_id=p.device_id and wire_device_id=p_wire and generation=(p_data->>'generation')::bigint for update;
  if not found then raise exception 'FOREIGN_OR_STALE_OPERATION';end if;
  target:=p_data->>'stage';
  if o.state=target then return jsonb_build_object('recorded',true,'duplicate',true);end if;
  -- Timeout is unknown, not evidence of failure; a later authenticated terminal report may reconcile it.
  if o.state in ('healthy','applied','rejected','failed','rolled_back','canceled') then raise exception 'TERMINAL_OPERATION';end if;
  if o.kind='configuration' then
   if target not in ('applied','rejected') or o.generation<>p.next_generation or (target='applied' and p_data->'configuration' is distinct from o.configuration) then raise exception 'INVALID_CONFIGURATION_REPORT';end if;
  else
   if target='healthy' then
    select * into a from firmware_artifacts where id=o.artifact_id;
    if o.state not in ('booting','awaiting_reboot','unknown') or o.generation<>p.next_generation or p_data->>'sha256' is distinct from a.sha256 or (p_data->>'securityVersion')::integer is distinct from (a.manifest->>'securityVersion')::integer or p_data->>'healthValidated' is distinct from 'true' then raise exception 'HEALTH_EVIDENCE_REQUIRED';end if;
   elsif target not in ('failed','rolled_back','rejected') and not ((o.state='assigned' and target='downloading') or (o.state='downloading' and target='verified') or (o.state='verified' and target='installing') or (o.state='installing' and target='awaiting_reboot') or (o.state='awaiting_reboot' and target='booting')) then raise exception 'INVALID_OPERATION_TRANSITION';end if;
  end if;
  if coalesce(p_data->>'category','') !~ '^[a-z0-9_]{0,64}$' then raise exception 'INVALID_ERROR_CATEGORY';end if;
  update device_operations set state=target,error_category=nullif(p_data->>'category',''),reported_at=now(),completed_at=case when target in ('healthy','applied','failed','rolled_back','rejected') then now() else null end where id=o.id;
  insert into device_operation_events(organization_id,operation_id,stage,evidence,category) values(o.organization_id,o.id,target,'authenticated_device_claim',nullif(p_data->>'category',''));
  if target='applied' then update device_management_profiles set reported_config=o.configuration,reported_config_generation=o.generation where device_id=p.device_id and reported_config_generation<o.generation;
  elsif target='healthy' then update device_management_profiles set reported_firmware=jsonb_build_object('sha256',a.sha256,'version',a.manifest->>'version','securityVersion',a.manifest->'securityVersion','evidence','authenticated_device_claim'),security_version=greatest(security_version,(a.manifest->>'securityVersion')::integer) where device_id=p.device_id;end if;
  return jsonb_build_object('recorded',true);
 else raise exception 'UNSUPPORTED_MANAGEMENT_ACTION';end if;
end $$;

create function management_download(p_id uuid,p_hash text,p_operation uuid) returns jsonb language plpgsql security definer set search_path=public as $$declare token firmware_download_tokens;o device_operations;a firmware_artifacts;begin
 perform management_enabled();perform enterprise_check_recovery();select * into token from firmware_download_tokens where id=p_id and token_hash=p_hash and operation_id=p_operation and expires_at>now();if not found then raise exception 'DOWNLOAD_UNAVAILABLE';end if;
 if not exists(select 1 from device_operations job join firmware_rollouts rollout on rollout.id=job.rollout_id where job.id=p_operation and now()<least(rollout.ends_at,job.created_at+make_interval(secs=>rollout.timeout_seconds))) then raise exception 'DOWNLOAD_WINDOW_CLOSED';end if;
 perform management_identity(token.wire_device_id);if not exists(select 1 from device_management_profiles where wire_device_id=token.wire_device_id and enabled) then raise exception 'DOWNLOAD_UNAVAILABLE';end if;select * into o from device_operations where id=p_operation and wire_device_id=token.wire_device_id and state in ('assigned','downloading','verified','installing','awaiting_reboot','booting');if not found then raise exception 'DOWNLOAD_UNAVAILABLE';end if;
 select * into a from firmware_artifacts where id=o.artifact_id and state='approved';if not found or exists(select 1 from firmware_signing_keys where id=a.key_id and revoked_at is not null) then raise exception 'DOWNLOAD_UNAVAILABLE';end if;
 return jsonb_build_object('objectPath',a.object_path,'size',a.size,'sha256',a.sha256,'organizationId',a.organization_id,'operationId',o.id);
end $$;
create function management_transfer(p_operation uuid,p_bytes bigint,p_complete boolean) returns void language sql security definer set search_path=public as $$insert into firmware_transfer_metrics(organization_id,operation_id,bytes,complete) select organization_id,id,p_bytes,p_complete from device_operations where id=p_operation and p_bytes between 0 and 4194304$$;
create function management_overview(p_org uuid,p_actor uuid,p_page integer default 0,p_device uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$begin
 perform management_enabled();perform require_org_permission(p_org,p_actor,'device_operations.read');if p_page not between 0 and 2000 then raise exception 'INVALID_PAGE';end if;
 if p_device is not null and not exists(select 1 from devices where id=p_device and organization_id=p_org) then raise exception 'FOREIGN_DEVICE';end if;
 return jsonb_build_object('keys',(select coalesce(jsonb_agg(to_jsonb(k)),'[]') from (select id,name,fingerprint,public_pem,revoked_at from firmware_signing_keys where organization_id=p_org order by created_at desc limit 100)k),
 'artifacts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select id,manifest,signature,sha256,size,state,release_notes,channel,created_at from firmware_artifacts where organization_id=p_org order by created_at desc limit 100)a),
 'profiles',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from (select p.*,d.name from device_management_profiles p join devices d on d.id=p.device_id where p.organization_id=p_org and (p_device is null or p.device_id=p_device) order by p.updated_at desc,p.device_id limit 50 offset p_page*50)p),
 'rollouts',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('eligible',(select count(*) from rollout_targets where rollout_id=r.id and eligible),'ineligible',(select count(*) from rollout_targets where rollout_id=r.id and not eligible),'counts',(select coalesce(jsonb_object_agg(state,n),'{}') from(select state,count(*) n from device_operations where rollout_id=r.id group by state)s),'waveReady',management_wave_ready(r.id))),'[]') from (select * from firmware_rollouts where organization_id=p_org order by created_at desc limit 50)r),
 'operations',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from device_operation_events e where e.operation_id=o.id))),'[]') from (select * from device_operations where organization_id=p_org and (p_device is null or device_id=p_device) order by created_at desc,id limit 50 offset p_page*50)o),
 'transferObservations',(select count(*)::text from firmware_transfer_metrics where organization_id=p_org and created_at>now()-interval '30 days'),'transferBytes',(select coalesce(sum(bytes),0)::text from firmware_transfer_metrics where organization_id=p_org and created_at>now()-interval '30 days'));
end $$;
create function management_rollout(p_org uuid,p_actor uuid,p_id uuid,p_page integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$begin
 perform management_enabled();perform require_org_permission(p_org,p_actor,'device_operations.read');if p_page not between 0 and 2000 then raise exception 'INVALID_PAGE';end if;
 if not exists(select 1 from firmware_rollouts where id=p_id and organization_id=p_org) then raise exception 'FOREIGN_ROLLOUT';end if;
 return jsonb_build_object('id',p_id,'targets',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from(select t.*,d.name,o.state operation_state,o.error_category from rollout_targets t join devices d on d.id=t.device_id left join device_operations o on o.rollout_id=t.rollout_id and o.device_id=t.device_id where t.rollout_id=p_id order by t.wave,t.device_id limit 50 offset p_page*50)t),'count',(select count(*) from rollout_targets where rollout_id=p_id));
end $$;
create function management_cleanup() returns void language plpgsql security definer set search_path=public as $$declare expired uuid[];begin
 delete from management_challenges where id in(select id from management_challenges where expires_at<now() limit 1000);
 delete from firmware_download_tokens where id in(select id from firmware_download_tokens where expires_at<now() limit 1000);
 delete from firmware_transfer_metrics where id in(select id from firmware_transfer_metrics where created_at<now()-interval '30 days' limit 1000);
 -- Only terminal work of terminal rollouts expires; retain paused/in-flight work.
 select coalesce(array_agg(id),'{}') into expired from(select o.id from device_operations o join firmware_rollouts r on r.id=o.rollout_id where r.state in ('completed','canceled') and r.updated_at<now()-interval '90 days' and o.state in ('healthy','applied','rejected','failed','rolled_back','unknown','canceled') order by o.created_at limit 1000 for update of o skip locked)s;
 delete from device_operation_events where operation_id=any(expired);
 delete from firmware_download_tokens where operation_id=any(expired);
 delete from rollout_targets t using device_operations o where o.id=any(expired) and t.rollout_id=o.rollout_id and t.device_id=o.device_id;
 delete from device_operations where id=any(expired);
 delete from rollout_targets where (rollout_id,device_id) in(select t.rollout_id,t.device_id from rollout_targets t join firmware_rollouts r on r.id=t.rollout_id where r.state in ('completed','canceled') and r.updated_at<now()-interval '90 days' and not exists(select 1 from device_operations o where o.rollout_id=t.rollout_id and o.device_id=t.device_id) limit 1000);
 delete from firmware_rollouts where id in(select r.id from firmware_rollouts r where r.state in ('completed','canceled') and r.updated_at<now()-interval '90 days' and not exists(select 1 from rollout_targets where rollout_id=r.id) and not exists(select 1 from device_operations where rollout_id=r.id) limit 100);

end $$;
create function management_artifact_immutable() returns trigger language plpgsql as $$begin if row(new.manifest,new.canonical,new.signature,new.sha256,new.size,new.object_path,new.key_id,new.organization_id) is distinct from row(old.manifest,old.canonical,old.signature,old.sha256,old.size,old.object_path,old.key_id,old.organization_id) then raise exception 'ARTIFACT_IMMUTABLE';end if;return new;end $$;
create trigger immutable_firmware_artifact before update on firmware_artifacts for each row execute function management_artifact_immutable();
do $$declare f record;begin for f in select oid::regprocedure s from pg_proc where pronamespace='public'::regnamespace and proname like 'management_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.s);execute format('grant execute on function %s to service_role',f.s);end loop;end $$;
insert into role_permissions(role,capability) values ('owner','firmware.read'),('owner','configuration.read'),('owner','device_operations.read'),('owner','firmware.upload'),('owner','firmware.approve'),('owner','firmware.deploy'),('owner','firmware.cancel'),('owner','firmware.manage_signing_keys'),('owner','configuration.update'),('owner','configuration.deploy'),('owner','device_operations.manage'),('admin','firmware.read'),('admin','configuration.read'),('admin','device_operations.read'),('admin','firmware.upload'),('admin','firmware.approve'),('admin','firmware.deploy'),('admin','firmware.cancel'),('admin','firmware.manage_signing_keys'),('admin','configuration.update'),('admin','configuration.deploy'),('admin','device_operations.manage'),('developer','firmware.read'),('developer','configuration.read'),('developer','device_operations.read'),('developer','firmware.upload'),('developer','configuration.update'),('operator','firmware.read'),('operator','configuration.read'),('operator','device_operations.read'),('viewer','firmware.read'),('viewer','configuration.read'),('viewer','device_operations.read') on conflict do nothing;

alter table enterprise_service_config drop constraint enterprise_service_config_component_check;
alter table enterprise_service_config add constraint enterprise_service_config_component_check check(component in ('gateway','delivery','fleet','observability','enterprise','web','management'));
insert into enterprise_service_config(component,expected) values('management',false) on conflict do nothing;

-- Reuse the existing incident/notification lifecycle; never send notifications
-- merely because OTA is installed. Customers explicitly configure this rule.
alter table alert_rules drop constraint alert_rules_kind_check;
alter table alert_rules add constraint alert_rules_kind_check check(kind in ('inactivity','never_connected','readings','bytes','packet_size','rejections','delivery_failures','dead_backlog','queue_age','sensor','rollout_failures'));
do $extend$ declare source text;needle text:=$branch$ elsif r.kind='sensor' then$branch$;begin
 select pg_get_functiondef('evaluate_alert_rule(uuid,timestamp with time zone)'::regprocedure) into source;
 if position(needle in source)=0 then raise exception 'ALERT_EVALUATOR_EXTENSION_MISMATCH';end if;
 source:=replace(source,needle,$branch$ elsif r.kind='rollout_failures' then
  select count(*) into v from firmware_rollouts f where f.organization_id=r.organization_id and f.state='paused' and f.reason in ('failure_or_unknown_threshold','eligibility_changed','initiator_permission_changed','maintenance_or_rollout_window_ended') and exists(select 1 from rollout_targets t where t.rollout_id=f.id and t.device_id=any(scope_ids));
 elsif r.kind='sensor' then$branch$);execute source;
end $extend$;
