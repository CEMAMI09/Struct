-- Phase 9 additive authorization and operations. Apply after 039 commits; no production activation.
create table public.enterprise_settings(id boolean primary key default true check(id),enabled boolean not null default false);
insert into enterprise_settings values(true,false);
create table public.role_permissions(role text not null,capability text not null,primary key(role,capability));
insert into role_permissions values ('owner','organization.read'),('owner','members.read'),('owner','devices.read'),('owner','schemas.read'),('owner','telemetry.read'),('owner','delivery.read'),('owner','integrations.read'),('owner','alerts.read'),('owner','analytics.read'),('owner','support.export'),('owner','devices.create'),('owner','devices.update'),('owner','devices.disable'),('owner','devices.provision'),('owner','schemas.create'),('owner','schemas.update'),('owner','telemetry.export'),('owner','integrations.manage'),('owner','delivery.retry'),('owner','delivery.replay'),('owner','alerts.manage'),('owner','organization.manage'),('owner','members.invite'),('owner','members.remove'),('owner','members.manage_roles'),('owner','devices.revoke'),('owner','devices.delete'),('owner','devices.export_credentials'),('owner','integrations.manage_credentials'),('owner','billing.read'),('owner','billing.manage'),('owner','audit.read'),('owner','audit.export'),('owner','api_keys.manage'),('owner','operations.read'),('owner','organization.transfer'),('owner','members.manage_admins'),('owner','alerts.acknowledge'),('admin','organization.read'),('admin','members.read'),('admin','devices.read'),('admin','schemas.read'),('admin','telemetry.read'),('admin','delivery.read'),('admin','integrations.read'),('admin','alerts.read'),('admin','analytics.read'),('admin','support.export'),('admin','devices.create'),('admin','devices.update'),('admin','devices.disable'),('admin','devices.provision'),('admin','schemas.create'),('admin','schemas.update'),('admin','telemetry.export'),('admin','integrations.manage'),('admin','delivery.retry'),('admin','delivery.replay'),('admin','alerts.manage'),('admin','organization.manage'),('admin','members.invite'),('admin','members.remove'),('admin','members.manage_roles'),('admin','devices.revoke'),('admin','devices.delete'),('admin','devices.export_credentials'),('admin','integrations.manage_credentials'),('admin','billing.read'),('admin','billing.manage'),('admin','audit.read'),('admin','audit.export'),('admin','api_keys.manage'),('admin','operations.read'),('admin','alerts.acknowledge'),('developer','organization.read'),('developer','members.read'),('developer','devices.read'),('developer','schemas.read'),('developer','telemetry.read'),('developer','delivery.read'),('developer','integrations.read'),('developer','alerts.read'),('developer','analytics.read'),('developer','support.export'),('developer','devices.create'),('developer','devices.update'),('developer','devices.disable'),('developer','devices.provision'),('developer','schemas.create'),('developer','schemas.update'),('developer','telemetry.export'),('developer','integrations.manage'),('developer','delivery.retry'),('developer','delivery.replay'),('developer','alerts.manage'),('developer','alerts.acknowledge'),('operator','organization.read'),('operator','members.read'),('operator','devices.read'),('operator','schemas.read'),('operator','telemetry.read'),('operator','delivery.read'),('operator','integrations.read'),('operator','alerts.read'),('operator','analytics.read'),('operator','support.export'),('operator','delivery.retry'),('operator','alerts.acknowledge'),('viewer','organization.read'),('viewer','members.read'),('viewer','devices.read'),('viewer','schemas.read'),('viewer','telemetry.read'),('viewer','delivery.read'),('viewer','integrations.read'),('viewer','alerts.read'),('viewer','analytics.read'),('viewer','support.export');
revoke all on role_permissions,enterprise_settings from public,anon,authenticated;
grant select on role_permissions to authenticated;
grant all on role_permissions,enterprise_settings to service_role;
create function public.role_has_permission(p_role text,p_cap text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from role_permissions where role=p_role and capability=p_cap)$$;
create function public.org_has_permission(p_org uuid,p_actor uuid,p_cap text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from organization_members where organization_id=p_org and user_id=p_actor and role_has_permission(role::text,p_cap))$$;
create function public.require_org_permission(p_org uuid,p_actor uuid,p_cap text) returns void language plpgsql security definer set search_path=public as $$begin
 if not coalesce(org_has_permission(p_org,p_actor,p_cap),false) then raise exception 'PERMISSION_DENIED' using errcode='42501';end if;end $$;
create or replace function public.is_org_writer(p_org_id uuid) returns boolean language sql stable security definer set search_path=public as $$select org_has_permission(p_org_id,auth.uid(),'devices.update')$$;
revoke all on function org_has_permission(uuid,uuid,text),require_org_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function org_has_permission(uuid,uuid,text),require_org_permission(uuid,uuid,text) to service_role;
revoke all on function role_has_permission(text,text) from public,anon;
grant execute on function role_has_permission(text,text) to authenticated,service_role;

-- Extend the existing audit source. Historic actor/outcome uncertainty is preserved.
alter table audit_logs add column event_action text;
alter table audit_logs add column outcome text not null default 'success' check(outcome in ('success','denied','failed'));
alter table audit_logs add column actor_type text not null default 'unknown' check(actor_type in ('user','machine','system','unknown'));
alter table audit_logs add column request_id uuid;
alter table audit_logs add column reference_id text;
create index audit_actor_window on audit_logs(organization_id,user_id,created_at desc);
create index audit_action_window on audit_logs(organization_id,event_action,created_at desc);
create index audit_reference on audit_logs(organization_id,reference_id,created_at desc);
create index audit_request on audit_logs(organization_id,request_id) where request_id is not null;
drop policy if exists audit_logs_select_member on audit_logs;
create policy audit_logs_select_member on audit_logs for select to authenticated using(org_has_entitlement(organization_id,'audit_logs') and org_has_permission(organization_id,auth.uid(),'audit.read'));
create function public.enterprise_audit(p_org uuid,p_actor uuid,p_action text,p_resource text,p_id uuid,p_outcome text default 'success',p_request uuid default null,p_reference text default null,p_summary jsonb default '{}') returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 if length(p_action)>100 or length(p_resource)>60 or octet_length(p_summary::text)>4096 then raise exception 'INVALID_AUDIT';end if;
 insert into audit_logs(organization_id,user_id,action,table_name,record_id,event_action,outcome,actor_type,request_id,reference_id,new_data)
 values(p_org,p_actor,'INSERT',p_resource,coalesce(p_id,p_org),p_action,p_outcome,case when p_actor is null then 'system' when current_setting('struct.machine',true)='true' then 'machine' else 'user' end,coalesce(p_request,nullif(current_setting('struct.request',true),'')::uuid),left(p_reference,150),p_summary) returning id into result;return result;end $$;
revoke all on function enterprise_audit(uuid,uuid,text,text,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function enterprise_audit(uuid,uuid,text,text,uuid,text,uuid,text,jsonb) to service_role;
create function public.enterprise_safe_snapshot(p_table text,p_row jsonb) returns jsonb language sql immutable as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(p_row,'{}')) where key=any(array['id','organization_id','device_id','group_id','destination_id','user_id','actor_id','job_id','version','schema_slot','slot','encoding','name','changed_fields','capability','count','cycles','errors','aggregated','evaluated','pending','lastSuccess','queued','dropped','unattributed','commitGaps','db_roundtrip_ms','requests','processing_ms','packetAttempts','authenticatedSecureV2Packets','newCommittedSecureV2Packets','duplicateSecureV2Packets','processingFailures','decodeFailures','processingMs','lifecycle','enabled','paused_at','role','status','operation','affected','action','admin_version','revoked_at','expires_at']);$$;
create or replace function public.capture_infrastructure_audit() returns trigger language plpgsql security definer set search_path=public,auth as $$declare row_data jsonb;old_data jsonb;new_data jsonb;org uuid;resource uuid;actor uuid;begin
 if tg_op<>'INSERT' then old_data:=enterprise_safe_snapshot(tg_table_name,to_jsonb(old));end if;
 if tg_op<>'DELETE' then new_data:=enterprise_safe_snapshot(tg_table_name,to_jsonb(new));end if;
 -- Audit only configuration changes: monitored commit/last-seen/counter traffic is excluded.
 if tg_op='UPDATE' and (to_jsonb(old)-array['last_seen','first_telemetry_at','last_monitored_commit_at','last_monitored_schema_slot','secure_v2_first_telemetry_at','credential_epoch_first_seen_at']) is not distinct from (to_jsonb(new)-array['last_seen','first_telemetry_at','last_monitored_commit_at','last_monitored_schema_slot','secure_v2_first_telemetry_at','credential_epoch_first_seen_at']) then return new;end if;
 if tg_op='UPDATE' then new_data:=new_data||jsonb_build_object('changed_fields',(select jsonb_agg(key) from jsonb_each(to_jsonb(new)) n where n.value is distinct from (to_jsonb(old)->n.key)));end if;
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 org:=coalesce(nullif(row_data->>'organization_id','')::uuid,case when tg_table_name='organizations' then (row_data->>'id')::uuid else null end);
 if org is null and row_data ? 'device_id' then select organization_id into org from devices where id=(row_data->>'device_id')::uuid;end if;
 if org is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 resource:=coalesce(nullif(row_data->>'id','')::uuid,nullif(row_data->>'destination_id','')::uuid,nullif(row_data->>'device_id','')::uuid,org);
 actor:=coalesce(auth.uid(),nullif(current_setting('struct.actor',true),'')::uuid);
 insert into audit_logs(organization_id,user_id,action,table_name,record_id,previous_data,new_data,event_action,actor_type,request_id)
 values(org,actor,tg_op,tg_table_name,resource,old_data,new_data,tg_table_name||'.'||lower(tg_op),case when actor is null then 'system' else 'user' end,nullif(current_setting('struct.request',true),'')::uuid);
 if tg_op='DELETE' then return old;else return new;end if;end $$;
-- Existing snapshots are retained; new capture is strictly allowlisted. Do not rewrite historical evidence.

create function public.enterprise_bind_actor(p_org uuid,p_actor uuid,p_cap text,p_request uuid default null) returns void language plpgsql security definer set search_path=public as $$begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,1));
 perform require_org_permission(p_org,p_actor,p_cap);
 perform set_config('struct.actor',p_actor::text,true);
 perform set_config('struct.request',coalesce(p_request::text,gen_random_uuid()::text),true);
end $$;
revoke all on function enterprise_bind_actor(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function enterprise_bind_actor(uuid,uuid,text,uuid) to service_role;

create table public.organization_invitations(
 id uuid primary key,organization_id uuid not null references organizations,invited_by uuid not null,
 email text not null check(length(email) between 3 and 254),role public.org_role not null check(role::text<>'owner'),
 token_hash bytea not null check(octet_length(token_hash)=32),expires_at timestamptz not null,
 created_at timestamptz not null default now(),revoked_at timestamptz,accepted_at timestamptz,accepted_by uuid,
 version integer not null default 1
);
create unique index invitations_active_email on organization_invitations(organization_id,email) where accepted_at is null and revoked_at is null;
create index invitations_expiry on organization_invitations(expires_at) where accepted_at is null and revoked_at is null;
create table public.enterprise_api_keys(
 id uuid primary key,organization_id uuid not null references organizations,created_by uuid not null,
 name text not null check(length(name) between 1 and 80),token_hash bytea not null check(octet_length(token_hash)=32),
 scopes text[] not null check(cardinality(scopes) between 1 and 8),created_at timestamptz not null default now(),
 expires_at timestamptz not null,revoked_at timestamptz,last_used_at timestamptz,version integer not null default 1
);
create index enterprise_keys_org on enterprise_api_keys(organization_id,created_at desc);
create table enterprise_key_usage(key_id uuid not null references enterprise_api_keys on delete cascade,bucket timestamptz not null,requests integer not null,primary key(key_id,bucket));
alter table enterprise_key_usage enable row level security;
revoke all on enterprise_key_usage from public,anon,authenticated;
grant all on enterprise_key_usage to service_role;
alter table organization_invitations enable row level security;
alter table enterprise_api_keys enable row level security;
revoke all on organization_invitations,enterprise_api_keys from public,anon,authenticated;
grant all on organization_invitations,enterprise_api_keys to service_role;

create function public.enterprise_team_command(p_org uuid,p_actor uuid,p_action text,p_data jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare target organization_members;inv organization_invitations;new_id uuid;email_normal text;desired public.org_role;secret_hash bytea;result jsonb:='{}';begin
 if not(select enabled from enterprise_settings where id) then raise exception 'ENTERPRISE_DISABLED';end if;
 if octet_length(p_data::text)>8192 then raise exception 'INVALID_TEAM_REQUEST';end if;
 perform enterprise_bind_actor(p_org,p_actor,case p_action when 'rename' then 'organization.manage' when 'invite' then 'members.invite' when 'resend' then 'members.invite' when 'revoke_invite' then 'members.invite' when 'remove' then 'members.remove' when 'role' then 'members.manage_roles' when 'transfer' then 'organization.transfer' else 'unknown' end,p_request);
 if p_action<>'rename' and not org_has_entitlement(p_org,'team_rbac') then raise exception 'TEAM_REQUIRES_SCALE';end if;
 if (select count(*) from audit_logs where organization_id=p_org and user_id=p_actor and created_at>now()-interval '1 hour' and table_name='team')>=60 then raise exception 'TEAM_RATE_LIMIT';end if;
 if p_action='rename' then
  if length(trim(p_data->>'name')) not between 1 and 100 then raise exception 'INVALID_NAME';end if;
  update organizations set name=trim(p_data->>'name') where id=p_org;
 elsif p_action in ('invite','resend','revoke_invite') then
  if p_action='invite' then
   new_id:=(p_data->>'id')::uuid;email_normal:=lower(trim(p_data->>'email'));desired:=(p_data->>'role')::org_role;
   if email_normal !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(email_normal)>254 or desired::text='owner' then raise exception 'INVALID_INVITATION';end if;
   if desired::text='admin' then perform require_org_permission(p_org,p_actor,'members.manage_admins');end if;
   if exists(select 1 from organization_members m join auth.users u on u.id=m.user_id where m.organization_id=p_org and lower(u.email)=email_normal) then raise exception 'ALREADY_MEMBER';end if;
   secret_hash:=decode(p_data->>'hash','hex');
   if octet_length(secret_hash)<>32 then raise exception 'INVALID_INVITATION';end if;
   select * into inv from organization_invitations where organization_id=p_org and email=email_normal and accepted_at is null and revoked_at is null order by created_at desc limit 1 for update;
   if found and inv.revoked_at is null and inv.accepted_at is null and inv.expires_at>now() then
    if inv.id=new_id then return jsonb_build_object('id',inv.id,'duplicate',true);end if;
    raise exception 'INVITATION_ALREADY_PENDING';
   end if;
   if inv.id is not null then update organization_invitations set revoked_at=now() where id=inv.id;end if;
   insert into organization_invitations(id,organization_id,invited_by,email,role,token_hash,expires_at) values(new_id,p_org,p_actor,email_normal,desired,secret_hash,now()+interval '7 days');
   result:=jsonb_build_object('id',new_id);
  else
   select * into strict inv from organization_invitations where id=(p_data->>'id')::uuid and organization_id=p_org for update;
   if inv.role::text='admin' then perform require_org_permission(p_org,p_actor,'members.manage_admins');end if;
   if p_action='revoke_invite' then update organization_invitations set revoked_at=now(),version=version+1 where id=inv.id;
   else
    if inv.accepted_at is not null or inv.revoked_at is not null then raise exception 'INVITATION_CLOSED';end if;
    secret_hash:=decode(p_data->>'hash','hex');if octet_length(secret_hash)<>32 then raise exception 'INVALID_INVITATION';end if;
    update organization_invitations set token_hash=secret_hash,expires_at=now()+interval '7 days',version=version+1 where id=inv.id;
    result:=jsonb_build_object('id',inv.id);
   end if;
  end if;
 elsif p_action in ('remove','role','transfer') then
  select * into strict target from organization_members where id=(p_data->>'member')::uuid and organization_id=p_org for update;
  if target.role::text in ('owner','admin') then perform require_org_permission(p_org,p_actor,'members.manage_admins');end if;
  if p_action='transfer' then
   if target.user_id=p_actor then raise exception 'INVALID_OWNER_TARGET';end if;
   update organization_members set role='owner' where id=target.id;
   update organization_members set role='admin' where organization_id=p_org and user_id=p_actor;
  elsif p_action='remove' then
   if target.role::text='owner' and (select count(*) from organization_members where organization_id=p_org and role='owner')<=1 then raise exception 'LAST_OWNER';end if;
   delete from organization_members where id=target.id;
   update enterprise_api_keys set revoked_at=coalesce(revoked_at,now()) where organization_id=p_org and created_by=target.user_id;
  else
   desired:=(p_data->>'role')::org_role;
   if desired::text in ('owner','admin') then perform require_org_permission(p_org,p_actor,'members.manage_admins');end if;
   if desired::text='owner' then raise exception 'USE_EXPLICIT_TRANSFER';end if;
   if target.role::text='owner' and (select count(*) from organization_members where organization_id=p_org and role='owner')<=1 then raise exception 'LAST_OWNER';end if;
   update organization_members set role=desired where id=target.id;
  end if;
 else raise exception 'INVALID_TEAM_ACTION';end if;
 perform enterprise_audit(p_org,p_actor,'team.'||p_action,'team',coalesce(target.id,new_id,inv.id,p_org),'success',p_request,null,jsonb_build_object('role',desired));
 return result;
end $$;

create function public.enterprise_accept_invitation(p_actor uuid,p_id uuid,p_hash bytea) returns uuid language plpgsql security definer set search_path=public as $$declare inv organization_invitations;verified_email text;begin
 if not(select enabled from enterprise_settings where id) then raise exception 'ENTERPRISE_DISABLED';end if;
 select * into inv from organization_invitations where id=p_id;
 if inv.id is null then raise exception 'INVITATION_UNAVAILABLE';end if;
 perform pg_advisory_xact_lock(hashtextextended(inv.organization_id::text,1));
 select * into inv from organization_invitations where id=p_id for update;
 select lower(u.email) into verified_email from auth.users u where u.id=p_actor and to_jsonb(u)->>'email_confirmed_at' is not null;
 if inv.token_hash is distinct from p_hash or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=now() or verified_email is distinct from inv.email or not org_has_entitlement(inv.organization_id,'team_rbac') then raise exception 'INVITATION_UNAVAILABLE';end if;
 -- Do not resurrect or escalate an existing membership via an old invitation.
 if exists(select 1 from organization_members where organization_id=inv.organization_id and user_id=p_actor) then raise exception 'ALREADY_MEMBER';end if;
 if not org_has_permission(inv.organization_id,inv.invited_by,case when inv.role::text='admin' then 'members.manage_admins' else 'members.invite' end) then raise exception 'INVITATION_UNAVAILABLE';end if;
 insert into organization_members(organization_id,user_id,role) values(inv.organization_id,p_actor,inv.role);
 update organization_invitations set accepted_at=now(),accepted_by=p_actor where id=p_id;
 perform enterprise_audit(inv.organization_id,p_actor,'team.join','team',p_id);
 return inv.organization_id;
end $$;

create function public.enterprise_key_command(p_org uuid,p_actor uuid,p_action text,p_data jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare k enterprise_api_keys;scopes_in text[];h bytea;new_id uuid;cap text;begin
 if not(select enabled from enterprise_settings where id) then raise exception 'ENTERPRISE_DISABLED';end if;
 perform enterprise_bind_actor(p_org,p_actor,'api_keys.manage',p_request);
 if (select count(*) from audit_logs where organization_id=p_org and table_name='api_key' and created_at>now()-interval '1 hour')>=60 then raise exception 'KEY_OPERATION_LIMIT';end if;
 if octet_length(p_data::text)>4096 then raise exception 'INVALID_KEY';end if;
 new_id:=(p_data->>'id')::uuid;
 if p_action='create' then
  if (select count(*) from enterprise_api_keys where organization_id=p_org and revoked_at is null and expires_at>now())>=20 then raise exception 'KEY_LIMIT';end if;
  scopes_in:=array(select jsonb_array_elements_text(p_data->'scopes'));
  if cardinality(scopes_in) not between 1 and 8 then raise exception 'INVALID_SCOPES';end if;
  foreach cap in array scopes_in loop
   if cap not in ('devices.read','devices.create','analytics.read','integrations.read') then raise exception 'UNSUPPORTED_SCOPE';end if;
   perform require_org_permission(p_org,p_actor,cap);
  end loop;
  if (p_data->>'days')::integer not between 1 and 366 then raise exception 'INVALID_EXPIRY';end if;
  h:=decode(p_data->>'hash','hex');
  insert into enterprise_api_keys(id,organization_id,created_by,name,token_hash,scopes,expires_at) values(new_id,p_org,p_actor,p_data->>'name',h,scopes_in,now()+make_interval(days=>(p_data->>'days')::integer));
 elsif p_action in ('revoke','rotate') then
  select * into strict k from enterprise_api_keys where id=new_id and organization_id=p_org for update;
  if p_action='revoke' then update enterprise_api_keys set revoked_at=coalesce(revoked_at,now()),version=version+1 where id=k.id;
  else
   if k.revoked_at is not null or k.expires_at<=now() then raise exception 'KEY_REVOKED';end if;
   update enterprise_api_keys set token_hash=decode(p_data->>'hash','hex'),version=version+1 where id=k.id;
  end if;
 else raise exception 'INVALID_KEY_ACTION';end if;
 perform enterprise_audit(p_org,p_actor,'api_key.'||p_action,'api_key',new_id,'success',p_request);
 return jsonb_build_object('id',new_id);
end $$;

create function public.enterprise_verify_key(p_id uuid,p_hash bytea,p_cap text) returns jsonb language plpgsql security definer set search_path=public as $$declare k enterprise_api_keys;begin
 if not(select enabled from enterprise_settings where id) then raise exception 'ENTERPRISE_DISABLED';end if;
 select * into k from enterprise_api_keys where id=p_id and token_hash=p_hash;
 if k.id is null then raise exception 'INVALID_MANAGEMENT_KEY';end if;
 perform pg_advisory_xact_lock(hashtextextended(k.organization_id::text,1));
 select * into k from enterprise_api_keys where id=p_id for share;
 if k.token_hash is distinct from p_hash or k.revoked_at is not null or k.expires_at<=now() or not(p_cap=any(k.scopes)) or not org_has_permission(k.organization_id,k.created_by,p_cap) then raise exception 'INVALID_MANAGEMENT_KEY';end if;
 insert into enterprise_key_usage(key_id,bucket,requests) values(k.id,date_trunc('minute',now(),'UTC'),1) on conflict(key_id,bucket) do update set requests=enterprise_key_usage.requests+1;
 if (select requests from enterprise_key_usage where key_id=k.id and bucket=date_trunc('minute',now(),'UTC'))>120 then raise exception 'KEY_RATE_LIMIT';end if;
 update enterprise_api_keys set last_used_at=now() where id=k.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 perform set_config('struct.machine','true',true);perform enterprise_bind_actor(k.organization_id,k.created_by,p_cap);
 return jsonb_build_object('organization_id',k.organization_id,'actor_id',k.created_by);
end $$;

create function public.current_org_permission(p_org uuid,p_cap text) returns boolean language sql stable security definer set search_path=public as $$select org_has_permission(p_org,auth.uid(),p_cap)$$;
revoke all on function current_org_permission(uuid,text) from public,anon;
grant execute on function current_org_permission(uuid,text) to authenticated,service_role;
drop policy audit_logs_select_member on audit_logs;
create policy audit_logs_select_member on audit_logs for select to authenticated using(org_has_entitlement(organization_id,'audit_logs') and current_org_permission(organization_id,'audit.read'));
-- Guard legacy invitation entry points: joining now requires an expiring invitation.
do $$declare src text;begin select pg_get_functiondef('public.add_org_member_by_email(uuid,text,org_role)'::regprocedure) into src;src:=replace(src,'FUNCTION public.add_org_member_by_email(','FUNCTION public.add_org_member_by_email_phase9_legacy(');execute src;end $$;
revoke all on function add_org_member_by_email_phase9_legacy(uuid,text,org_role) from public,anon,authenticated;
create or replace function public.add_org_member_by_email(p_org_id uuid,p_email text,p_role public.org_role default 'viewer') returns uuid language plpgsql security definer set search_path=public as $$begin perform require_org_permission(p_org_id,auth.uid(),'members.invite');if (select enabled from enterprise_settings where id) then raise exception 'USE_INVITATION_WORKFLOW';end if;return add_org_member_by_email_phase9_legacy(p_org_id,p_email,p_role);end $$;
-- Existing direct organization name writes require organization.manage, not generic device write.
drop policy if exists organizations_update_writer on organizations;
create policy organizations_enterprise_update on organizations for update to authenticated using(current_org_permission(id,'organization.manage')) with check(current_org_permission(id,'organization.manage'));

-- Every new mutating RPC is private service-only. Browser sessions are validated in APIs.
do $$declare r record;begin for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'enterprise_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
end loop;end $$;

create table public.enterprise_mail_jobs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,invitation_id uuid not null references organization_invitations on delete cascade,
 invitation_version integer not null,token_ciphertext text not null check(length(token_ciphertext)<=512),
 status text not null default 'pending' check(status in ('pending','sending','delivered','dead','suppressed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 created_at timestamptz not null default now(),completed_at timestamptz,last_category text,unique(invitation_id,invitation_version)
);
create index enterprise_mail_ready on enterprise_mail_jobs(available_at) where status in ('pending','sending');
create table public.enterprise_mail_attempts(id bigint generated always as identity primary key,job_id uuid not null references enterprise_mail_jobs on delete cascade,attempt integer not null,outcome text not null,category text,http_status integer,created_at timestamptz not null default now(),unique(job_id,attempt));
alter table enterprise_mail_jobs enable row level security;
alter table enterprise_mail_attempts enable row level security;
revoke all on enterprise_mail_jobs,enterprise_mail_attempts from public,anon,authenticated;
grant all on enterprise_mail_jobs,enterprise_mail_attempts to service_role;
grant usage,select on sequence enterprise_mail_attempts_id_seq to service_role;

-- Queue the explicit invitation email in the same team transaction; encrypt only
-- the transient delivery copy. The authoritative invitation stores a hash.
do $mail$declare src text;begin
 select pg_get_functiondef('enterprise_team_command(uuid,uuid,text,jsonb,uuid)'::regprocedure) into src;
 src:=replace(src, 'perform enterprise_audit(p_org,p_actor,''team.''||p_action', $insert$if p_action in ('invite','resend') and (p_data->>'sendEmail')::boolean is true then
  select * into inv from organization_invitations where id=coalesce(new_id,inv.id) and organization_id=p_org;
  if p_data->>'mail_cipher' is null or p_data->>'mail_cipher' !~ '^v1:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$' then raise exception 'INVALID_MAIL_CREDENTIAL';end if;
  update enterprise_mail_jobs set status='suppressed',completed_at=now(),last_category='invitation_replaced' where invitation_id=inv.id and status in ('pending','sending');
  insert into enterprise_mail_jobs(organization_id,invitation_id,invitation_version,token_ciphertext) values(p_org,inv.id,inv.version,p_data->>'mail_cipher');
 end if;
 perform enterprise_audit(p_org,p_actor,'team.'||p_action$insert$);execute src;
end $mail$;

create function public.enterprise_claim_mail() returns jsonb language plpgsql security definer set search_path=public as $$declare job enterprise_mail_jobs;inv organization_invitations;token uuid:=gen_random_uuid();begin
 if not(select enabled from enterprise_settings where id) then return null;end if;
 select * into job from enterprise_mail_jobs where status in ('pending','sending') and available_at<=now() and (lease_until is null or lease_until<=now()) order by available_at,id limit 1 for update skip locked;
 if job.id is null then return null;end if;
 select * into inv from organization_invitations where id=job.invitation_id;
 if inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at<=now() or inv.version<>job.invitation_version or not org_has_entitlement(inv.organization_id,'team_rbac') or not org_has_permission(inv.organization_id,inv.invited_by,case when inv.role::text='admin' then 'members.manage_admins' else 'members.invite' end) then
  update enterprise_mail_jobs set status='suppressed',completed_at=now(),last_category='invitation_unavailable' where id=job.id;return null;
 end if;
 if job.attempts>=8 or job.created_at<now()-interval '24 hours' then update enterprise_mail_jobs set status='dead',completed_at=now(),last_category='retry_exhausted' where id=job.id;return null;end if;
 if job.status='sending' then insert into enterprise_mail_attempts(job_id,attempt,outcome,category) values(job.id,job.attempts,'unknown','lease_expired') on conflict do nothing;end if;
 update enterprise_mail_jobs set status='sending',lease_token=token,lease_until=now()+interval '30 seconds',attempts=attempts+1 where id=job.id;
 return jsonb_build_object('id',job.id,'invitation_id',inv.id,'token',token,'to',inv.email,'ciphertext',job.token_ciphertext,'hash',encode(inv.token_hash,'hex'));
end $$;
create function public.enterprise_finish_mail(p_id uuid,p_token uuid,p_outcome text,p_category text default null,p_status integer default null,p_after integer default 0) returns boolean language plpgsql security definer set search_path=public as $$declare job enterprise_mail_jobs;terminal boolean;begin
 select * into job from enterprise_mail_jobs where id=p_id and status='sending' and lease_token=p_token and lease_until>now() for update;
 if job.id is null then return false;end if;
 if p_outcome not in ('delivered','retry','dead') then raise exception 'INVALID_MAIL_OUTCOME';end if;
 terminal:=p_outcome<>'retry' or job.attempts>=8 or job.created_at<now()-interval '24 hours';
 insert into enterprise_mail_attempts(job_id,attempt,outcome,category,http_status) values(job.id,job.attempts,p_outcome,left(p_category,60),p_status);
 update enterprise_mail_jobs set status=case when p_outcome='delivered' then 'delivered' when terminal then 'dead' else 'pending' end,
  available_at=now()+make_interval(secs=>greatest(least(greatest(p_after,0),3600),least(3600,5*power(2,job.attempts)))+random()*5),completed_at=case when terminal then now() else null end,
  last_category=left(p_category,60),lease_until=null,lease_token=null,token_ciphertext=case when terminal then '' else token_ciphertext end where id=job.id;return true;
end $$;

create function public.enterprise_machine_request(p_id uuid,p_hash bytea,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$declare principal jsonb;org uuid;actor uuid;job uuid;rows_in jsonb;quantity integer;begin
 if octet_length(p_data::text)>8192 then raise exception 'INVALID_MACHINE_REQUEST';end if;
 principal:=enterprise_verify_key(p_id,p_hash,case p_action when 'inventory' then 'devices.read' when 'job' then 'devices.read' when 'preview_create' then 'devices.create' when 'confirm_create' then 'devices.create' when 'usage' then 'analytics.read' when 'integrations' then 'integrations.read' else 'unknown' end);
 org:=(principal->>'organization_id')::uuid;actor:=(principal->>'actor_id')::uuid;
 if p_action='inventory' then return fleet_inventory(org,actor,coalesce(p_data->'filter','{}'),coalesce((p_data->>'page')::integer,0),50);
 elsif p_action='usage' then return usage_analytics(org,actor,(p_data->>'from')::timestamptz,(p_data->>'to')::timestamptz,coalesce(p_data->'filter','{}'));
 elsif p_action='integrations' then return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'enabled',d.enabled,'kind',i.kind,'version',i.version)),'[]') from integration_definitions i join destinations d on d.id=i.destination_id where i.organization_id=org and i.deleted_at is null);
 elsif p_action='preview_create' then
  quantity:=(p_data->>'quantity')::integer;
  if quantity not between 1 and 1000 or length(p_data->>'prefix') not between 1 and 64 then raise exception 'INVALID_QUANTITY';end if;
  select jsonb_agg(jsonb_build_object('name',(p_data->>'prefix')||g)) into rows_in from generate_series(1,quantity)g;
  job:=fleet_preview(org,actor,(p_data->>'requestId')::uuid,'create','{}',rows_in,null);return jsonb_build_object('jobId',job,'scheduled',false);
 elsif p_action in ('confirm_create','job') then
  job:=(p_data->>'jobId')::uuid;
  if not exists(select 1 from fleet_jobs where id=job and organization_id=org and actor_id=actor and operation='create') then raise exception 'PERMISSION_DENIED';end if;
  if p_action='confirm_create' then
   if (p_data->>'confirm')::boolean is distinct from true then raise exception 'INVALID_CONFIRMATION';end if;
   perform fleet_job_action(org,actor,job,'confirm');return jsonb_build_object('jobId',job,'scheduled',true);
  end if;
  return (select jsonb_build_object('jobId',id,'status',status,'counts',fleet_job_counts(org,job)) from fleet_jobs where id=job);
 else raise exception 'INVALID_MACHINE_ACTION';end if;
end $$;

-- Private operational observations, never raw cross-tenant traffic or credentials.
create table public.enterprise_service_config(component text primary key check(component in ('gateway','delivery','fleet','observability','enterprise','web')),expected boolean not null default true,fresh_seconds integer not null default 90 check(fresh_seconds between 30 and 600),objective numeric not null default 99 check(objective between 0 and 100));
insert into enterprise_service_config(component) values('gateway'),('delivery'),('fleet'),('observability'),('enterprise'),('web');
create table public.enterprise_heartbeats(instance_id uuid primary key,component text not null references enterprise_service_config,observed_at timestamptz not null default now(),ready boolean not null,details jsonb not null default '{}');
create index enterprise_heartbeat_time on enterprise_heartbeats(component,observed_at desc);
create table public.enterprise_health_history(component text not null references enterprise_service_config,bucket timestamptz not null,observed_at timestamptz not null default now(),ready boolean not null,primary key(component,bucket));
alter table enterprise_heartbeats enable row level security;alter table enterprise_health_history enable row level security;alter table enterprise_service_config enable row level security;
revoke all on enterprise_heartbeats,enterprise_health_history,enterprise_service_config from public,anon,authenticated;
grant all on enterprise_heartbeats,enterprise_health_history,enterprise_service_config to service_role;
create function public.enterprise_heartbeat(p_instance uuid,p_component text,p_ready boolean,p_details jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$begin
 if not(select enabled from enterprise_settings where id) then return;end if;
 if p_ready is null or octet_length(p_details::text)>2048 then raise exception 'INVALID_HEALTH';end if;
 insert into enterprise_heartbeats(instance_id,component,ready,details) values(p_instance,p_component,p_ready,enterprise_safe_snapshot('health',p_details)) on conflict(instance_id) do update set observed_at=now(),ready=excluded.ready,details=excluded.details;
 insert into enterprise_health_history(component,bucket,ready) values(p_component,date_trunc('minute',now(),'UTC'),p_ready) on conflict(component,bucket) do update set observed_at=now(),ready=excluded.ready;
end $$;
create function public.enterprise_operations(p_org uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$begin
 perform require_org_permission(p_org,p_actor,'operations.read');
 return jsonb_build_object('observedAt',now(),'boundary','Sampled process/dependency readiness, not public ingestion availability or contractual uptime',
 'services',(select jsonb_agg(jsonb_build_object('component',c.component,'expected',c.expected,'lastObserved',h.observed_at,'state',case when not c.expected then 'not_expected' when h.observed_at is null or h.observed_at<now()-make_interval(secs=>c.fresh_seconds) then 'unknown' when h.ready then 'ready' else 'degraded' end,'plannedObjectivePercent',c.objective,
 'observedReadyPercent',(select round(100.0*count(*) filter(where ready)/nullif(count(*),0),2) from enterprise_health_history where component=c.component and bucket>=now()-interval '24 hours'),
 'observedMinutes',(select count(*) from enterprise_health_history where component=c.component and bucket>=now()-interval '24 hours'))) from enterprise_service_config c left join lateral(select * from enterprise_heartbeats where component=c.component order by observed_at desc limit 1)h on true),
 'delivery',(select jsonb_build_object('pending',count(*) filter(where status='pending'),'sending',count(*) filter(where status='sending'),'dead',count(*) filter(where status='dead'),'oldestPending',min(created_at) filter(where status in ('pending','sending'))) from webhook_deliveries where organization_id=p_org),
 'metrics',(select jsonb_build_object('lastAggregated',last_aggregated_at) from monitoring_preferences where organization_id=p_org),
 'invitationMail',(select jsonb_build_object('pending',count(*) filter(where status in ('pending','sending')),'dead',count(*) filter(where status='dead')) from enterprise_mail_jobs where organization_id=p_org));
end $$;

create table public.ingestion_recovery_gate(id boolean primary key default true check(id),blocked boolean not null default false,blocked_at timestamptz,reason text,check(not blocked or blocked_at is not null));
insert into ingestion_recovery_gate values(true,false,null,null);
alter table ingestion_recovery_gate enable row level security;revoke all on ingestion_recovery_gate from public,anon,authenticated;grant all on ingestion_recovery_gate to service_role;
create function public.enterprise_check_recovery() returns void language plpgsql security definer set search_path=public as $$begin if (select blocked from ingestion_recovery_gate where id) then raise exception 'RECOVERY_INGESTION_BLOCKED';end if;end $$;
do $recovery$declare r record;src text;begin for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('ingest_secure_v2_telemetry','ingest_device_telemetry','bootstrap_secure_v2_counter') loop
 src:=pg_get_functiondef(r.oid);src:=regexp_replace(src,'\mBEGIN\M',E'BEGIN\n perform enterprise_check_recovery();','i');execute src;end loop;end $recovery$;
create function public.enterprise_release_recovery() returns void language plpgsql security definer set search_path=public as $$declare gate ingestion_recovery_gate;begin
 select * into gate from ingestion_recovery_gate where id for update;
 if not gate.blocked then return;end if;
 if gate.blocked_at is null or gate.blocked_at>now() then raise exception 'INVALID_RECOVERY_GATE';end if;
 if exists(select 1 from secure_v2_credentials where revoked_at is null and (expires_at is null or expires_at>now()) and created_at<=gate.blocked_at) then raise exception 'RESTORED_CREDENTIALS_REQUIRE_REPROVISIONING';end if;
 update ingestion_recovery_gate set blocked=false,reason=null where id;
end $$;

-- Application/service callers cannot alter audit records; bounded retention is
-- a separately privileged maintenance path and is itself recorded.
create or replace function public.prevent_audit_log_mutation() returns trigger language plpgsql set search_path=public as $$begin
 if tg_op='DELETE' and current_setting('struct.audit_retention',true)='true' and old.created_at<now()-interval '90 days' then return old;end if;
 raise exception 'audit_logs is append-only';end $$;
create function public.enterprise_cleanup() returns integer language plpgsql security definer set search_path=public as $$declare n integer;r record;begin
 perform set_config('struct.audit_retention','true',true);
 n:=0;
 for r in with removed as (delete from audit_logs where id in(select id from audit_logs where created_at<now()-interval '90 days' order by created_at limit 1000) returning organization_id) select organization_id,count(*)::int as removed_count from removed group by organization_id loop
  n:=n+r.removed_count;
  perform enterprise_audit(r.organization_id,null,'audit.retention','audit',r.organization_id,'success',null,null,jsonb_build_object('count',r.removed_count));
 end loop;
 perform set_config('struct.audit_retention','false',true);
 delete from enterprise_key_usage where bucket<now()-interval '1 day';
 delete from enterprise_heartbeats where observed_at<now()-interval '1 day';delete from enterprise_health_history where bucket<now()-interval '30 days';
 update enterprise_mail_jobs set status='dead',completed_at=now(),last_category='retry_exhausted' where status in ('pending','sending') and created_at<now()-interval '24 hours';
 update enterprise_mail_jobs set token_ciphertext='' where status in ('dead','delivered','suppressed');
 delete from enterprise_mail_jobs where status in ('dead','delivered','suppressed') and completed_at<now()-interval '7 days';
 delete from organization_invitations where expires_at<now()-interval '30 days';
 return n;end $$;
do $$declare r record;begin for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'enterprise_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
end loop;end $$;

-- Extend known existing functions in place; preserve their validation, transactions,
-- signatures and grants. Fail the migration if a required dependency is absent.
do $upgrade$declare r record;src text;guard text;begin
 for r in select * from (values
 ('create_secure_device_with_usage','p_org_id','p_user_id',quote_literal('devices.create')),
 ('bulk_insert_devices','p_org_id','p_user_id',quote_literal('devices.export_credentials')),
 ('bulk_provision_profile_devices','p_org_id','p_user_id',quote_literal('devices.export_credentials')),
 ('finalize_bulk_device_import','p_org_id','p_user_id',quote_literal('devices.export_credentials')),
 ('save_integration','p_org_id','p_actor_id',$$case when p_credentials is not null then 'integrations.manage_credentials' else 'integrations.manage' end$$),
 ('integration_action','p_org_id','p_actor_id',quote_literal('integrations.manage')),
 ('fleet_preview','p_org','p_actor',$$case p_operation when 'create' then 'devices.create' when 'revoke' then 'devices.revoke' when 'delete' then 'devices.delete' when 'rotate' then 'devices.export_credentials' when 'reprovision' then 'devices.export_credentials' else 'devices.update' end$$),
 ('fleet_manifest','p_org','p_actor',quote_literal('devices.export_credentials')),
 ('fleet_job_action','p_org','p_actor',$$case (select operation from fleet_jobs where id=p_job and organization_id=p_org) when 'create' then 'devices.create' when 'revoke' then 'devices.revoke' when 'delete' then 'devices.delete' when 'rotate' then 'devices.export_credentials' when 'reprovision' then 'devices.export_credentials' else 'devices.update' end$$),
 ('observability_command','p_org','p_actor',$$case p_action when 'acknowledge' then 'alerts.acknowledge' when 'email_preferences' then 'alerts.read' else 'alerts.manage' end$$)
 )x(name,org_arg,actor_arg,cap) loop
  select pg_get_functiondef(p.oid) into strict src from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=r.name;
  src:=replace(src,$$role in ('owner','admin')$$,$$role::text in ('owner','admin','developer')$$);
  guard:=format(E'BEGIN\n perform public.enterprise_bind_actor(%s,%s,%s);',r.org_arg,r.actor_arg,r.cap);
  if r.name like 'fleet_%' then guard:=format(E'BEGIN\n BEGIN perform public.enterprise_bind_actor(%s,%s,%s); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION ''FLEET_FORBIDDEN''; END;',r.org_arg,r.actor_arg,r.cap);
  elsif r.name in ('save_integration','integration_action') then guard:=format(E'BEGIN\n BEGIN perform public.enterprise_bind_actor(%s,%s,%s); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION ''Not authorized''; END;',r.org_arg,r.actor_arg,r.cap);
  elsif r.name='observability_command' then guard:=format(E'BEGIN\n BEGIN perform public.enterprise_bind_actor(%s,%s,%s); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION ''OBSERVABILITY_FORBIDDEN''; END;',r.org_arg,r.actor_arg,r.cap);end if;
  src:=regexp_replace(src,'\mBEGIN\M',guard,'i');
  if r.name='observability_command' then src:=replace(src,$$p_action<>'email_preferences'$$,$$p_action not in ('email_preferences','acknowledge')$$);end if;
  execute src;
 end loop;
 for r in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('fleet_authorize','save_integration','integration_action','observability_authorize','fleet_finish') loop
  src:=pg_get_functiondef(r.oid);src:=replace(src,$$role in ('owner','admin')$$,$$role::text in ('owner','admin','developer')$$);
  if r.proname='fleet_finish' then
   src:=replace(src,'perform fleet_authorize(job.organization_id,job.actor_id);',E'perform enterprise_bind_actor(job.organization_id,job.actor_id,case job.operation when ''create'' then ''devices.create'' when ''revoke'' then ''devices.revoke'' when ''delete'' then ''devices.delete'' when ''rotate'' then ''devices.export_credentials'' when ''reprovision'' then ''devices.export_credentials'' else ''devices.update'' end);\n perform fleet_authorize(job.organization_id,job.actor_id);');
  end if;execute src;
 end loop;
 -- Session-authorized recovery keeps auth.uid() and its existing idempotency.
 select pg_get_functiondef('delivery_recovery(uuid,uuid[],text,uuid,boolean)'::regprocedure) into src;
 src:=replace(src,'if not public.is_org_writer(p_org_id)', $$if not current_org_permission(p_org_id,case when p_action like '%replay%' or p_action like '%cancel%' then 'delivery.replay' else 'delivery.retry' end)$$);
 src:=regexp_replace(src,'\mBEGIN\M',E'BEGIN\n perform enterprise_bind_actor(p_org_id,auth.uid(),case when p_action like ''%replay%'' or p_action like ''%cancel%'' then ''delivery.replay'' else ''delivery.retry'' end,p_request_id);','i');execute src;
 -- Stored destination signing credentials are an explicit restricted permission.
 select pg_get_functiondef('get_destination_signing_secret(uuid)'::regprocedure) into src;
 src:=replace(src,'public.is_org_writer(d.organization_id)', $$current_org_permission(d.organization_id,'integrations.manage_credentials')$$);execute src;
end $upgrade$;

-- Intent tables bridge worker/service actors without storing payloads or secrets.
create function public.enterprise_capture_intent() returns trigger language plpgsql security definer set search_path=public as $$declare j jsonb:=to_jsonb(new);org uuid;actor uuid;resource uuid;begin
 org:=(j->>'organization_id')::uuid;actor:=coalesce(nullif(j->>'actor_id','')::uuid,nullif(current_setting('struct.actor',true),'')::uuid,auth.uid());
 resource:=coalesce(nullif(j->>'job_id','')::uuid,nullif(j->>'destination_id','')::uuid,org);
 perform enterprise_audit(org,actor,tg_table_name||'.'||coalesce(j->>'action','changed'),tg_table_name,resource,'success',null,j->>'job_id',enterprise_safe_snapshot(tg_table_name,j));return new;end $$;
create trigger enterprise_fleet_intent after insert on fleet_audit for each row execute function enterprise_capture_intent();
create trigger enterprise_integration_intent after insert on integration_audit for each row execute function enterprise_capture_intent();
create trigger enterprise_delivery_intent after insert on delivery_actions for each row execute function enterprise_capture_intent();
do $$declare tab text;begin
 foreach tab in array array['organizations','organization_members','secure_v2_schema_slots','secure_v2_credentials','device_groups','device_group_members','alert_rules','device_monitoring','monitoring_preferences','device_profiles'] loop
  execute format('create trigger enterprise_audit_changes after insert or update or delete on public.%I for each row execute function capture_infrastructure_audit()',tab);
 end loop;
end $$;

-- Membership removal is independent of creator ownership; machine keys lose access immediately.
create function public.enterprise_member_removed() returns trigger language plpgsql security definer set search_path=public as $$begin
 update enterprise_api_keys set revoked_at=coalesce(revoked_at,now()) where organization_id=old.organization_id and created_by=old.user_id;
 update organization_invitations set revoked_at=coalesce(revoked_at,now()) where organization_id=old.organization_id and invited_by=old.user_id and accepted_at is null;return old;end $$;
create trigger enterprise_revoke_member_keys after delete on organization_members for each row execute function enterprise_member_removed();

-- Explicit bounded search/export. Historic snapshots are projected through the
-- same safe allowlist; credentials in old versions never leave this RPC.
create function public.enterprise_audit_search(p_org uuid,p_actor uuid,p_filter jsonb default '{}',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform require_org_permission(p_org,p_actor,'audit.read');
 if not org_has_entitlement(p_org,'audit_logs') then raise exception 'AUDIT_REQUIRES_SCALE';end if;
 if p_limit not between 1 and 500 or octet_length(p_filter::text)>2048 then raise exception 'INVALID_AUDIT_FILTER';end if;
 if p_limit>50 then perform require_org_permission(p_org,p_actor,'audit.export');perform enterprise_audit(p_org,p_actor,'audit.export','audit',p_org);end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,id desc),'[]') into result from(
  select id,organization_id,user_id,coalesce(event_action,table_name||'.'||lower(action)) event_action,table_name,record_id,outcome,actor_type,request_id,reference_id,created_at,
   enterprise_safe_snapshot(table_name,previous_data) previous_data,enterprise_safe_snapshot(table_name,new_data) new_data
  from audit_logs where organization_id=p_org
   and (not(p_filter ? 'actor') or user_id=(p_filter->>'actor')::uuid)
   and (not(p_filter ? 'action') or coalesce(event_action,table_name||'.'||lower(action))=p_filter->>'action')
   and (not(p_filter ? 'resource') or table_name=p_filter->>'resource')
   and (not(p_filter ? 'id') or record_id=(p_filter->>'id')::uuid)
   and (not(p_filter ? 'outcome') or outcome=p_filter->>'outcome')
   and (not(p_filter ? 'reference') or reference_id=p_filter->>'reference')
   and (not(p_filter ? 'from') or created_at>=(p_filter->>'from')::timestamptz)
   and (not(p_filter ? 'to') or created_at<=(p_filter->>'to')::timestamptz)
   and (p_before is null or (created_at,id)<(p_before,p_before_id))
  order by created_at desc,id desc limit p_limit
 )q;return result;end $$;

create function public.enterprise_overview(p_org uuid,p_actor uuid,p_page integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform require_org_permission(p_org,p_actor,'organization.read');
 if p_page not between 0 and 2000 then raise exception 'INVALID_MEMBER_PAGE';end if;
 select jsonb_build_object('organization',jsonb_build_object('id',o.id,'name',o.name),'role',m.role,'teamAllowed',org_has_entitlement(p_org,'team_rbac'),
 'permissions',(select jsonb_agg(capability order by capability) from role_permissions where role=m.role::text),
 'membersTotal',(select count(*) from organization_members where organization_id=p_org),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',mm.id,'user_id',mm.user_id,'email',case when org_has_permission(p_org,p_actor,'members.invite') then u.email else null end,'role',mm.role,'created_at',mm.created_at) order by mm.created_at),'[]') from (select * from organization_members where organization_id=p_org order by created_at,id limit 50 offset p_page*50)mm join auth.users u on u.id=mm.user_id),
 'invitations',case when org_has_permission(p_org,p_actor,'members.invite') then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expires_at',expires_at,'revoked_at',revoked_at,'accepted_at',accepted_at,'version',version) order by created_at desc),'[]') from (select * from organization_invitations where organization_id=p_org order by created_at desc limit 100)i) else '[]'::jsonb end,
 'keys',case when org_has_permission(p_org,p_actor,'api_keys.manage') then (select coalesce(jsonb_agg(to_jsonb(k)-'token_hash'),'[]') from (select * from enterprise_api_keys where organization_id=p_org order by created_at desc limit 100)k) else '[]'::jsonb end)
 into result from organizations o join organization_members m on m.organization_id=o.id and m.user_id=p_actor where o.id=p_org;
 return result;end $$;

create function public.enterprise_sensitive_read(p_org uuid,p_actor uuid,p_device uuid,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform enterprise_bind_actor(p_org,p_actor,'devices.provision',p_request);
 select to_jsonb(c) into result from secure_v2_credentials c join devices d on d.wire_device_id=c.wire_device_id where d.id=p_device and d.organization_id=p_org and d.lifecycle='enabled' and c.revoked_at is null;
 if result is null then raise exception 'DEVICE_UNAVAILABLE';end if;
 perform enterprise_audit(p_org,p_actor,'device.credentials_read','device',p_device,'success',p_request);
 return result;end $$;

-- Grants are repeated after all definitions to make service-only trust explicit.
do $$declare r record;begin for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'enterprise_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
end loop;end $$;

create function public.enterprise_quarantine(p_reason text default 'restore') returns void language plpgsql security definer set search_path=public as $$begin
 if p_reason not in ('restore','counter_unknown','manual') then raise exception 'INVALID_RECOVERY_REASON';end if;
 update ingestion_recovery_gate set blocked=true,blocked_at=now(),reason=p_reason where id;end $$;
revoke all on function enterprise_quarantine(text) from public,anon,authenticated;grant execute on function enterprise_quarantine(text) to service_role;
-- Deleting a human account must never cascade away organizational infrastructure.
-- Account deletion requires an explicit creator-reassignment/ownership procedure.
create function public.enterprise_guard_account_deletion() returns trigger language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from organization_members where user_id=old.id and role='owner') or exists(select 1 from devices where user_id=old.id and organization_id is not null) or exists(select 1 from destinations where user_id=old.id and organization_id is not null) or exists(select 1 from device_profiles where user_id=old.id and organization_id is not null) then raise exception 'ORGANIZATION_RESOURCES_REQUIRE_REASSIGNMENT';end if;return old;end $$;
create trigger enterprise_guard_account before delete on auth.users for each row execute function enterprise_guard_account_deletion();
revoke all on function enterprise_guard_account_deletion() from public,anon,authenticated;

create function public.enterprise_device_admin(p_org uuid,p_actor uuid,p_action text,p_device uuid,p_data jsonb,p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform enterprise_bind_actor(p_org,p_actor,case when p_action='slot' then 'schemas.update' else 'devices.provision' end,p_request);
 if octet_length(p_data::text)>65536 or not exists(select 1 from devices where id=p_device and organization_id=p_org) then raise exception 'PERMISSION_DENIED';end if;
 if p_action in ('enroll','rotate') then
  select to_jsonb(c) into result from enroll_device_secure_v2(p_device,p_org,p_data->>'rootEncrypted',p_data->>'preview',p_data->>'bootstrapEncrypted',decode(p_data->>'bootstrapHash','hex'),p_action='rotate',coalesce((p_data->>'grace')::integer,0))c;
 elsif p_action='slot' then
  select to_jsonb(s) into result from publish_secure_v2_schema_slot(p_device,p_org,(p_data->>'slot')::integer,p_data->>'encoding',p_data->'definition',(p_data->>'bytes')::integer,(p_data->>'legacySchemaVersion')::integer,(p_data->>'sampleIntervalMs')::integer)s;
 else raise exception 'INVALID_DEVICE_ADMIN_ACTION';end if;
 perform enterprise_audit(p_org,p_actor,case when p_action='slot' then 'schema.publish_slot' else 'device.'||p_action end,'device',p_device,'success',p_request);
 return result;end $$;
revoke all on function enterprise_device_admin(uuid,uuid,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function enterprise_device_admin(uuid,uuid,text,uuid,jsonb,uuid) to service_role;

create function public.enterprise_record_denied(p_org uuid,p_actor uuid,p_cap text,p_request uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if not(select enabled from enterprise_settings where id) or not exists(select 1 from organization_members where organization_id=p_org and user_id=p_actor) or not exists(select 1 from role_permissions where capability=p_cap) then return;end if;
 if (select count(*) from audit_logs where organization_id=p_org and user_id=p_actor and event_action='authorization.denied' and created_at>now()-interval '1 hour')>=30 then return;end if;
 perform enterprise_audit(p_org,p_actor,'authorization.denied','permission',p_org,'denied',p_request,null,jsonb_build_object('capability',p_cap));
end $$;
revoke all on function enterprise_record_denied(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function enterprise_record_denied(uuid,uuid,text,uuid) to service_role;

-- Older management endpoints still require a live actor in the write transaction.
-- Never turn an old hard-delete endpoint into a way to erase durable event history.
create function public.enterprise_legacy_admin(p_org uuid,p_actor uuid,p_action text,p_device uuid,p_data jsonb default '{}',p_request uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$declare result jsonb;begin
 perform enterprise_bind_actor(p_org,p_actor,case p_action when 'profile' then 'devices.export_credentials' when 'delete' then 'devices.delete' when 'legacy_key' then 'devices.provision' else 'unknown' end,p_request);
 if octet_length(p_data::text)>65536 then raise exception 'INVALID_LEGACY_ADMIN_DATA';end if;
 if p_action='profile' then
  insert into device_profiles(organization_id,user_id,name,device_model,firmware_version,schema_definition,identity_field,fleet_key_id,fleet_secret_encrypted,fleet_secret_preview)
  values(p_org,p_actor,p_data->>'name',p_data->>'device_model',p_data->>'firmware_version',p_data->'schema_definition',p_data->>'identity_field',p_data->>'key_id',p_data->>'secret_encrypted',p_data->>'secret_preview') returning to_jsonb(device_profiles) into result;
 else
  perform 1 from devices where id=p_device and organization_id=p_org for update;
  if not found then raise exception 'DEVICE_UNAVAILABLE';end if;
  if p_action='legacy_key' then
   update devices set api_key=p_data->>'key_id',key_id=p_data->>'key_id',api_secret_encrypted=p_data->>'secret_encrypted',api_secret_preview=p_data->>'secret_preview',protocol_version=2 where id=p_device returning to_jsonb(devices) into result;
  elsif p_action='delete' then
   if exists(select 1 from telemetry where device_id=p_device) or exists(select 1 from telemetry_events where device_id=p_device) or exists(select 1 from secure_v2_credentials where device_id=p_device) or exists(select 1 from devices where id=p_device and last_seen is not null) then raise exception 'USE_FLEET_ARCHIVE';end if;
   delete from devices where id=p_device;result:='{"ok":true}';
  end if;
 end if;
 perform enterprise_audit(p_org,p_actor,'legacy_admin.'||p_action,case when p_action='profile' then 'device_profile' else 'device' end,coalesce(p_device,(result->>'id')::uuid),'success',p_request);
 return result;end $$;
revoke all on function enterprise_legacy_admin(uuid,uuid,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function enterprise_legacy_admin(uuid,uuid,text,uuid,jsonb,uuid) to service_role;

do $selection$declare src text;begin select pg_get_functiondef('delivery_recovery_selection(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,text)'::regprocedure) into src;src:=replace(src,'public.is_org_writer(p_org_id)', 'current_org_permission(p_org_id,''delivery.retry'')');execute src;end $selection$;
