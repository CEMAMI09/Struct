-- Database-enforced feature entitlements.
-- UI feature hiding is only presentation; these triggers prevent direct API bypass.

create or replace function public.subscription_tier_rank(p_tier text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_tier, 'free'))
    when 'scale' then 3
    when 'pro' then 2
    when 'flexible' then 1
    else 0
  end;
$$;

create or replace function public.org_has_entitlement(
  p_org_id uuid,
  p_entitlement text
)
returns boolean
language sql
stable
security definer
set search_path = public
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
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

grant execute on function public.org_has_entitlement(uuid, text)
  to authenticated, service_role;

create or replace function public.enforce_device_encryption_entitlement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    tg_op = 'INSERT'
    and (new.encryption_enabled or new.encryption_key is not null)
  ) or (
    tg_op = 'UPDATE'
    and new.encryption_enabled
    and (
      new.encryption_enabled is distinct from old.encryption_enabled
      or new.encryption_key is distinct from old.encryption_key
    )
  ) then
    if not public.org_has_entitlement(new.organization_id, 'chacha20') then
      raise exception 'ChaCha20 encryption requires the Pro plan or higher'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_device_encryption_plan on public.devices;
create trigger enforce_device_encryption_plan
before insert or update on public.devices
for each row execute function public.enforce_device_encryption_entitlement();

create or replace function public.enforce_downlink_entitlement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  select d.organization_id
    into target_org_id
    from public.devices d
   where d.id = new.device_id;

  if not public.org_has_entitlement(target_org_id, 'downlinks') then
    raise exception 'Device downlinks require the Pro plan or higher'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_downlink_plan on public.pending_commands;
create trigger enforce_downlink_plan
before insert on public.pending_commands
for each row execute function public.enforce_downlink_entitlement();

create or replace function public.enforce_routing_entitlement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.routing_rule is not null
     and not public.org_has_entitlement(new.organization_id, 'logical_routing') then
    raise exception 'Webhook logical routing requires the Scale plan'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_destination_routing_plan on public.destinations;
create trigger enforce_destination_routing_plan
before insert or update on public.destinations
for each row execute function public.enforce_routing_entitlement();

create or replace function public.enforce_team_rbac_entitlement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_org_id uuid := coalesce(new.organization_id, old.organization_id);
  member_count integer;
begin
  -- The first owner membership is required to create every organization.
  if tg_op = 'INSERT' then
    select count(*) into member_count
      from public.organization_members
     where organization_id = target_org_id;

    if member_count = 0 then
      return new;
    end if;
  end if;

  if not public.org_has_entitlement(target_org_id, 'team_rbac') then
    raise exception 'Team RBAC requires the Scale plan'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_team_rbac_plan on public.organization_members;
create trigger enforce_team_rbac_plan
before insert or update on public.organization_members
for each row execute function public.enforce_team_rbac_entitlement();
