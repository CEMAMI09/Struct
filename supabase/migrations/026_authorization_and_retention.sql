-- Close direct PostgREST privilege paths without changing the service-role gateway.
-- Deploy the dashboard changes that select explicit safe columns and use the
-- writer-only secret RPCs before applying this migration to a live project.

-- Billing state is Stripe/service-owned. Workspace creation already uses
-- create_organization(), and the only browser-side organization update is name.
revoke insert, update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;
drop policy if exists "organizations_insert_authenticated" on public.organizations;
drop policy if exists "organizations_select_unclaimed" on public.organizations;

-- All membership mutations must pass the guarded RPCs. The old direct grants
-- permitted admins to grant owner and permitted deletion of the last owner.
revoke insert, update, delete on public.organization_members from authenticated;
drop policy if exists "organization_members_insert_writer" on public.organization_members;
drop policy if exists "organization_members_insert_self_owner" on public.organization_members;
drop policy if exists "organization_members_update_owner" on public.organization_members;
drop policy if exists "organization_members_delete_writer" on public.organization_members;

-- The gateway is the sole authority for accepted telemetry and device identity.
-- A member must not be able to manufacture a gateway-authenticated event by
-- inserting a row through PostgREST (which also enqueues a webhook).
revoke insert on public.telemetry from authenticated;
drop policy if exists "telemetry_insert_writer" on public.telemetry;

-- Table-level SELECT includes every column, including device encryption keys and
-- webhook signing secrets. Grant only safe columns to authenticated clients.
-- Device creation/deletion and credential rotation already use service-role APIs;
-- browser writes are restricted to tags and the explicit encryption RPC below.
revoke select, insert, update, delete on public.devices from authenticated;
grant select (
  id, user_id, name, api_key, last_seen, created_at, tags,
  encryption_enabled, organization_id, mac_address, key_id,
  api_secret_preview, protocol_version, profile_id, hardware_id,
  debug_trace_until
) on public.devices to authenticated;
grant update (tags) on public.devices to authenticated;

revoke select, insert, update on public.destinations from authenticated;
grant select (
  id, user_id, name, device_id, enabled, created_at,
  organization_id, routing_rule, event_types
) on public.destinations to authenticated;
grant insert (
  user_id, organization_id, name, url, device_id, enabled,
  routing_rule, event_types
) on public.destinations to authenticated;
grant update (
  name, url, device_id, enabled, routing_rule, event_types
) on public.destinations to authenticated;

-- Historical webhook URLs can also carry credentials in query strings. A
-- viewer still sees delivery status, but only a writer can reveal the endpoint.
revoke select on public.webhook_deliveries from authenticated;
grant select (
  id, event_id, organization_id, destination_id, body, routing_rule,
  status, attempts, replay_count, next_attempt_at, created_at,
  delivered_at, last_error
) on public.webhook_deliveries to authenticated;

-- Do not accept a foreign device_id on a destination in another organization.
drop policy if exists "destinations_insert_writer" on public.destinations;
create policy "destinations_insert_writer" on public.destinations
  for insert to authenticated with check (
    public.is_org_writer(organization_id)
    and user_id = auth.uid()
    and (device_id is null or exists (
      select 1 from public.devices d
      where d.id = device_id and d.organization_id = destinations.organization_id
    ))
  );
drop policy if exists "destinations_update_writer" on public.destinations;
create policy "destinations_update_writer" on public.destinations
  for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (
    public.is_org_writer(organization_id)
    and (device_id is null or exists (
      select 1 from public.devices d
      where d.id = device_id and d.organization_id = destinations.organization_id
    ))
  );

-- Supabase Realtime change payloads are not a safe way to expose a table that
-- also holds secrets. The dashboard polls the safe projection for presence.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'devices'
  ) then
    alter publication supabase_realtime drop table public.devices;
  end if;
end $$;

-- Only organization writers may intentionally reveal these secrets. Ordinary
-- device/destination reads, including viewer reads, cannot include them.
create or replace function public.get_device_encryption_key(p_device_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
declare v_key text;
begin
  select d.encryption_key into v_key from public.devices d
  where d.id = p_device_id and public.is_org_writer(d.organization_id);
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  return v_key;
end $$;

create or replace function public.configure_device_encryption(
  p_device_id uuid, p_enabled boolean, p_rotate boolean default false
)
returns text language plpgsql security definer set search_path = public
as $$
declare v_device public.devices%rowtype;
begin
  if p_enabled is null or p_rotate is null or (p_rotate and not p_enabled) then
    raise exception 'Invalid encryption configuration' using errcode = '22023';
  end if;
  select * into v_device from public.devices where id = p_device_id for update;
  if not found or not public.is_org_writer(v_device.organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.devices
     set encryption_enabled = p_enabled,
         encryption_key = case
           when p_enabled and (p_rotate or encryption_key is null)
             then encode(gen_random_bytes(32), 'hex')
           else encryption_key
         end
   where id = p_device_id
   returning encryption_key into v_device.encryption_key;
  if p_enabled then return v_device.encryption_key; end if;
  return null;
end $$;

create or replace function public.get_destination_signing_secret(p_destination_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
declare v_secret text;
begin
  select d.signing_secret into v_secret from public.destinations d
  where d.id = p_destination_id and public.is_org_writer(d.organization_id);
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  return v_secret;
end $$;

create or replace function public.get_destination_url(p_destination_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
declare v_url text;
begin
  select d.url into v_url from public.destinations d
  where d.id = p_destination_id and public.is_org_writer(d.organization_id);
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  return v_url;
end $$;

create or replace function public.get_webhook_delivery_destination_url(p_delivery_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
declare v_url text;
begin
  select d.destination_url into v_url from public.webhook_deliveries d
  where d.id = p_delivery_id and public.is_org_writer(d.organization_id);
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  return v_url;
end $$;

-- Existing audit rows contain old/new row snapshots. Remove old copies, then
-- redact new snapshots at capture time. Destination URLs are omitted because
-- query strings can contain customer credentials.
create or replace function public.redact_infrastructure_audit_data(
  p_table_name text, p_data jsonb
)
returns jsonb language sql immutable set search_path = public
as $$
  select case
    when p_data is null then null
    when p_table_name = 'devices' then
      p_data - 'api_key' - 'api_secret_encrypted' - 'encryption_key'
    when p_table_name = 'destinations' then
      p_data - 'signing_secret' - 'url'
    else p_data
  end;
$$;

alter table public.audit_logs disable trigger audit_logs_immutable;
update public.audit_logs
set previous_data = public.redact_infrastructure_audit_data(table_name, previous_data),
    new_data = public.redact_infrastructure_audit_data(table_name, new_data)
where table_name in ('devices', 'destinations');
alter table public.audit_logs enable trigger audit_logs_immutable;

create or replace function public.capture_infrastructure_audit()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  audit_organization_id uuid;
  audit_record_id uuid;
begin
  if tg_table_name = 'devices' and tg_op = 'UPDATE'
     and (to_jsonb(old) - 'last_seen') = (to_jsonb(new) - 'last_seen') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    row_data := to_jsonb(new);
    new_data := public.redact_infrastructure_audit_data(tg_table_name, row_data);
  elsif tg_op = 'UPDATE' then
    row_data := to_jsonb(new);
    old_data := public.redact_infrastructure_audit_data(tg_table_name, to_jsonb(old));
    new_data := public.redact_infrastructure_audit_data(tg_table_name, row_data);
  elsif tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    old_data := public.redact_infrastructure_audit_data(tg_table_name, row_data);
  else
    raise exception 'Unsupported audit operation: %', tg_op;
  end if;

  audit_record_id := nullif(row_data ->> 'id', '')::uuid;
  audit_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  if audit_organization_id is null and nullif(row_data ->> 'device_id', '') is not null then
    select d.organization_id into audit_organization_id from public.devices d
    where d.id = (row_data ->> 'device_id')::uuid;
  end if;
  if audit_organization_id is null then
    raise exception 'Cannot audit %.% without an organization_id', tg_table_schema, tg_table_name;
  end if;

  insert into public.audit_logs (
    organization_id, user_id, action, table_name, record_id, previous_data, new_data
  ) values (
    audit_organization_id, auth.uid(), tg_op, tg_table_name,
    audit_record_id, old_data, new_data
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Use the existing hourly retention job, but cover every event-payload copy and
-- expired replay nonce, not only the telemetry table. Event IDs remain forever
-- during the device lifetime to preserve queued-event deduplication.
create or replace function public.purge_expired_telemetry()
returns bigint language plpgsql security definer set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.webhook_deliveries w
  using public.organizations o
  where w.organization_id = o.id
    and w.created_at < now() - make_interval(days => case o.subscription_tier::text
      when 'scale' then 30 when 'pro' then 30
      when 'flexible' then 7 else 1 end);

  delete from public.packet_traces p
  using public.organizations o
  where p.organization_id = o.id
    and p.created_at < now() - make_interval(days => case o.subscription_tier::text
      when 'scale' then 30 when 'pro' then 30
      when 'flexible' then 7 else 1 end);

  delete from public.telemetry t
  using public.devices d, public.organizations o
  where t.device_id = d.id and d.organization_id = o.id
    and t.timestamp < now() - make_interval(days => case o.subscription_tier::text
      when 'scale' then 30 when 'pro' then 30
      when 'flexible' then 7 else 1 end);
  get diagnostics deleted_count = row_count;

  delete from public.device_replay_nonces
  where expires_at < now() - interval '1 hour';
  return deleted_count;
end $$;

-- Do not allow an admin to demote an owner through add_org_member_by_email's
-- former UPSERT branch. All role changes now require an owner, including a
-- repeated invitation for an existing user.
create or replace function public.add_org_member_by_email(
  p_org_id uuid, p_email text, p_role public.org_role default 'viewer'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_id uuid; member_id uuid; existing_role public.org_role;
begin
  -- Serialize all membership changes for this organization. Authorization must
  -- be checked after the lock so a concurrently demoted admin cannot add users.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 1));
  if not public.is_org_writer(p_org_id) then
    raise exception 'Only owners and admins can add members';
  end if;
  if p_role = 'owner' and not public.is_org_owner(p_org_id) then
    raise exception 'Only owners can grant the owner role';
  end if;
  select u.id into target_id from auth.users u
  where lower(u.email) = lower(trim(p_email)) limit 1;
  if target_id is null then
    raise exception 'No Struct account found for that email — they must sign up first';
  end if;
  select m.id, m.role into member_id, existing_role
  from public.organization_members m
  where m.organization_id = p_org_id and m.user_id = target_id for update;
  if member_id is not null then
    if not public.is_org_owner(p_org_id) then
      raise exception 'Only owners can change roles';
    end if;
    if existing_role = 'owner' and p_role <> 'owner' and
       (select count(*) from public.organization_members
        where organization_id = p_org_id and role = 'owner') <= 1 then
      raise exception 'Cannot demote the last owner';
    end if;
    update public.organization_members set role = p_role where id = member_id;
    return member_id;
  end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (p_org_id, target_id, p_role) returning id into member_id;
  return member_id;
end $$;

create or replace function public.update_org_member_role(
  p_member_id uuid, p_role public.org_role
)
returns void language plpgsql security definer set search_path = public
as $$
declare target_org uuid; target_role public.org_role;
begin
  -- Read only the immutable org key first, then re-read the row under the
  -- org-wide mutation lock. Direct client updates of this table are revoked.
  select organization_id into target_org
  from public.organization_members where id = p_member_id;
  if target_org is null then raise exception 'Member not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 1));
  select role into target_role from public.organization_members
  where id = p_member_id and organization_id = target_org for update;
  if not found then raise exception 'Member not found'; end if;
  if not public.is_org_owner(target_org) then
    raise exception 'Only owners can change roles';
  end if;
  if target_role = 'owner' and p_role <> 'owner' and
     (select count(*) from public.organization_members
      where organization_id = target_org and role = 'owner') <= 1 then
    raise exception 'Cannot demote the last owner';
  end if;
  update public.organization_members set role = p_role where id = p_member_id;
end $$;

create or replace function public.remove_org_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_org uuid;
  target_user uuid;
  target_role public.org_role;
begin
  select organization_id into target_org
  from public.organization_members where id = p_member_id;
  if target_org is null then raise exception 'Member not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 1));
  select user_id, role into target_user, target_role
  from public.organization_members
  where id = p_member_id and organization_id = target_org for update;
  if not found then raise exception 'Member not found'; end if;

  if target_user = auth.uid() then
    if target_role = 'owner' and
       (select count(*) from public.organization_members
        where organization_id = target_org and role = 'owner') <= 1 then
      raise exception 'Cannot leave as the last owner — transfer ownership or delete the workspace';
    end if;
  else
    if not public.is_org_owner(target_org) then
      raise exception 'Only owners can remove other members';
    end if;
    if target_role = 'owner' and
       (select count(*) from public.organization_members
        where organization_id = target_org and role = 'owner') <= 1 then
      raise exception 'Cannot remove the last owner';
    end if;
  end if;

  delete from public.organization_members where id = p_member_id;
end $$;

-- SECURITY DEFINER functions get PUBLIC EXECUTE by default. Revoke every
-- anonymous/public grant now and explicitly permit only intended client RPCs.
do $$
declare fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname, fn.proname, fn.args);
    execute format('grant execute on function %I.%I(%s) to service_role',
      fn.nspname, fn.proname, fn.args);
  end loop;
end $$;

grant execute on function public.is_org_member(uuid), public.is_org_writer(uuid),
  public.is_org_owner(uuid), public.create_organization(text),
  public.list_org_members(uuid), public.add_org_member_by_email(uuid,text,public.org_role),
  public.update_org_member_role(uuid,public.org_role), public.remove_org_member(uuid),
  public.get_org_device_limit(uuid), public.org_has_entitlement(uuid,text),
  public.telemetry_retention_days(uuid), public.publish_device_schema(uuid,jsonb,integer),
  public.enable_packet_tracing(uuid), public.replay_webhook_delivery(uuid),
  public.get_device_encryption_key(uuid),
  public.configure_device_encryption(uuid,boolean,boolean),
  public.get_destination_signing_secret(uuid), public.get_destination_url(uuid),
  public.get_webhook_delivery_destination_url(uuid)
to authenticated;

-- These helper functions contain information about a tenant's paid plan.
-- Keep them callable for members but deny cross-tenant lookups.
create or replace function public.get_org_device_limit(p_org_id uuid)
returns integer language sql stable security invoker set search_path = public
as $$
  select 5 + coalesce(o.stripe_quantity, 0)
  from public.organizations o where o.id = p_org_id;
$$;

create or replace function public.telemetry_retention_days(p_org_id uuid)
returns integer language sql stable security invoker set search_path = public
as $$
  select case o.subscription_tier::text when 'scale' then 30 when 'pro' then 30
    when 'flexible' then 7 else 1 end
  from public.organizations o where o.id = p_org_id;
$$;

create or replace function public.org_has_entitlement(p_org_id uuid, p_entitlement text)
returns boolean language sql stable security invoker set search_path = public
as $$
  select case p_entitlement
    when 'basic_webhooks' then true
    when 'live_debugger' then true
    when 'chacha20' then public.subscription_tier_rank(o.subscription_tier::text) >= 2
    when 'downlinks' then public.subscription_tier_rank(o.subscription_tier::text) >= 2
    when 'telemetry_30d' then public.subscription_tier_rank(o.subscription_tier::text) >= 2
    when 'team_rbac' then public.subscription_tier_rank(o.subscription_tier::text) >= 3
    when 'audit_logs' then public.subscription_tier_rank(o.subscription_tier::text) >= 3
    when 'logical_routing' then public.subscription_tier_rank(o.subscription_tier::text) >= 3
    else false
  end from public.organizations o where o.id = p_org_id;
$$;

-- The legacy key-ID generator only uses pg_catalog built-ins; pin its lookup
-- path rather than inheriting a caller-controlled schema order.
alter function public.generate_device_api_key() set search_path = pg_catalog;
