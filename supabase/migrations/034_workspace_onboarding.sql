-- Additive: deploy before the Phase 1/2 dashboard. No packet format changes.
alter table public.organizations add column first_telemetry_at timestamptz,
  add column onboarding_dismissed_at timestamptz;
alter table public.devices add column first_telemetry_at timestamptz,
  add column starter_downloaded_at timestamptz,
  add column configuration_acknowledged_at timestamptz,
  add column expected_report_interval_ms integer
    check(expected_report_interval_ms between 1000 and 604800000);
grant select(first_telemetry_at,starter_downloaded_at,configuration_acknowledged_at,
  expected_report_interval_ms) on public.devices to authenticated;

-- Only durable proof of committed storage counts; last_seen alone can describe
-- an authenticated connection, not necessarily a successfully stored reading.
update public.devices d set first_telemetry_at = coalesce(
  (select min(t.timestamp) from public.telemetry t where t.device_id=d.id), now())
where exists(select 1 from public.telemetry t where t.device_id=d.id)
  or exists(select 1 from public.device_event_ids e where e.device_id=d.id)
  or exists(select 1 from public.secure_v2_packets p join public.secure_v2_credentials c
    on c.wire_device_id=p.wire_device_id where c.device_id=d.id and cardinality(p.event_ids)>0);
update public.organizations o set first_telemetry_at=(
  select min(d.first_telemetry_at) from public.devices d where d.organization_id=o.id)
where exists(select 1 from public.devices d where d.organization_id=o.id and d.first_telemetry_at is not null);

create function public.record_first_telemetry() returns trigger language plpgsql
security definer set search_path=public as $$
declare target_org uuid;
begin
  select organization_id into target_org from public.devices where id=new.device_id;
  update public.devices set first_telemetry_at=now()
    where id=new.device_id and first_telemetry_at is null;
  -- The conditional UPDATE serializes concurrent first commits and is idempotent.
  update public.organizations set first_telemetry_at=now()
    where id=target_org and first_telemetry_at is null;
  return new;
end $$;
create trigger record_first_telemetry after insert on public.telemetry
  for each row execute function public.record_first_telemetry();
revoke all on function public.record_first_telemetry() from public,anon,authenticated;

create function public.workspace_onboarding(p_org_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_org_member(p_org_id) then raise exception 'Not authorized'; end if;
  return (select jsonb_build_object('first_packet_at',first_telemetry_at,
    'dismissed_at',onboarding_dismissed_at,'schema_device_ids',(select coalesce(jsonb_agg(distinct s.device_id),'[]'::jsonb) from public.secure_v2_schema_slots s join public.devices d on d.id=s.device_id where d.organization_id=p_org_id)) from public.organizations where id=p_org_id);
end $$;
create function public.dismiss_workspace_onboarding(p_org_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_org_writer(p_org_id) then raise exception 'Not authorized'; end if;
  -- Dismissal is deliberately separate from proof of telemetry.
  update public.organizations set onboarding_dismissed_at=now()
    where id=p_org_id and onboarding_dismissed_at is null;
end $$;
create function public.update_device_setup(p_device_id uuid,p_step text,p_interval_ms integer default null)
returns void language plpgsql security definer set search_path=public as $$
declare target_org uuid;
begin
  select organization_id into target_org from public.devices where id=p_device_id;
  if target_org is null or not public.is_org_writer(target_org) then raise exception 'Not authorized'; end if;
  if p_step='downloaded' then
    update public.devices set starter_downloaded_at=coalesce(starter_downloaded_at,now()) where id=p_device_id;
  elsif p_step='configured' then
    update public.devices set configuration_acknowledged_at=coalesce(configuration_acknowledged_at,now()) where id=p_device_id;
  elsif p_step='interval' then
    if p_interval_ms is not null and (p_interval_ms<1000 or p_interval_ms>604800000) then
      raise exception 'Reporting interval must be 1000..604800000 ms'; end if;
    update public.devices set expected_report_interval_ms=p_interval_ms where id=p_device_id;
  else raise exception 'Invalid setup step'; end if;
end $$;
revoke all on function public.workspace_onboarding(uuid),public.dismiss_workspace_onboarding(uuid),
  public.update_device_setup(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.workspace_onboarding(uuid),public.dismiss_workspace_onboarding(uuid),
  public.update_device_setup(uuid,text,integer) to authenticated;

-- Customer device creation and Secure V2 enrollment commit together. The legacy
-- columns remain populated for existing constraints; their secret is never exported.
create function public.create_secure_device_with_usage(
 p_org_id uuid,p_user_id uuid,p_name text,p_key_id text,p_api_secret_encrypted text,
 p_api_secret_preview text,p_mac_address text,p_expected_current_count integer,
 p_root_secret_encrypted text,p_secret_preview text,p_bootstrap_token_encrypted text,p_bootstrap_token_hash bytea)
returns public.devices language plpgsql security definer set search_path=public as $$
declare created public.devices;
begin
 created:=public.create_device_with_usage(p_org_id,p_user_id,p_name,p_key_id,
  p_api_secret_encrypted,p_api_secret_preview,p_mac_address,p_expected_current_count);
 perform public.enroll_device_secure_v2(created.id,p_org_id,p_root_secret_encrypted,
  p_secret_preview,p_bootstrap_token_encrypted,p_bootstrap_token_hash,false,0);
 select * into created from public.devices where id=created.id;
 return created;
end $$;
revoke all on function public.create_secure_device_with_usage(uuid,uuid,text,text,text,text,text,integer,text,text,text,bytea)
 from public,anon,authenticated;
grant execute on function public.create_secure_device_with_usage(uuid,uuid,text,text,text,text,text,integer,text,text,text,bytea) to service_role;
