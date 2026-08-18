-- Device Profiles (fleet schema templates) + Master Fleet Key + zero-touch identity.

-- ─── device_profiles ──────────────────────────────────────────────────────────
create table if not exists public.device_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  device_model text not null default '',
  firmware_version text not null default '',
  schema_definition jsonb not null default '[]'::jsonb,
  -- Field name in schema_definition used as wire identity (e.g. device_id char[6]).
  identity_field text not null default 'device_id',
  -- Public Master Fleet Key on the Protocol v2 key_id field (shared by the fleet).
  fleet_key_id text not null,
  fleet_secret_encrypted text not null,
  fleet_secret_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_profiles_name_nonempty check (length(trim(name)) > 0),
  constraint device_profiles_fleet_key_len check (length(fleet_key_id) = 16),
  constraint device_profiles_identity_nonempty check (length(trim(identity_field)) > 0)
);

comment on table public.device_profiles is
  'Reusable packed-struct template for a hardware fleet; Master Fleet Key authenticates zero-touch devices.';
comment on column public.device_profiles.fleet_key_id is
  'Public Master Fleet Key — same value flashed on every unit of this profile.';
comment on column public.device_profiles.identity_field is
  'Schema field that holds the per-unit hardware id (usually a char[N] device_id).';

create unique index if not exists device_profiles_fleet_key_id_uidx
  on public.device_profiles (fleet_key_id);

create unique index if not exists device_profiles_org_name_uidx
  on public.device_profiles (organization_id, lower(trim(name)));

create index if not exists device_profiles_organization_id_idx
  on public.device_profiles (organization_id);

alter table public.device_profiles enable row level security;

grant select, insert, update, delete on public.device_profiles to authenticated;
grant all on public.device_profiles to service_role;

create policy "device_profiles_select_member"
  on public.device_profiles for select to authenticated
  using (public.is_org_member(organization_id));

create policy "device_profiles_insert_writer"
  on public.device_profiles for insert to authenticated
  with check (public.is_org_writer(organization_id));

create policy "device_profiles_update_writer"
  on public.device_profiles for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy "device_profiles_delete_writer"
  on public.device_profiles for delete to authenticated
  using (public.is_org_writer(organization_id));

-- ─── Link devices to profiles / wire identity ─────────────────────────────────
alter table public.devices
  add column if not exists profile_id uuid references public.device_profiles(id) on delete set null,
  add column if not exists hardware_id text;

comment on column public.devices.profile_id is
  'Optional Device Profile this unit was provisioned from (fleet schema + Master Fleet Key).';
comment on column public.devices.hardware_id is
  'Stable identity extracted from the packed struct (e.g. device_id char[6] as hex) or CSV serial.';

create index if not exists devices_profile_id_idx
  on public.devices (profile_id)
  where profile_id is not null;

-- One hardware id per profile within an org (nulls allowed for classic devices).
create unique index if not exists devices_org_profile_hardware_uidx
  on public.devices (organization_id, profile_id, hardware_id)
  where profile_id is not null and hardware_id is not null;

-- ─── Atomic zero-touch find-or-create ─────────────────────────────────────────
create or replace function public.zero_touch_register_device(
  p_profile_id uuid,
  p_hardware_id text,
  p_name text default null,
  p_key_id text default null,
  p_api_secret_encrypted text default null,
  p_api_secret_preview text default null
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.device_profiles%rowtype;
  existing public.devices%rowtype;
  created public.devices%rowtype;
  hw text := lower(trim(coalesce(p_hardware_id, '')));
  device_name text;
begin
  if p_profile_id is null or hw = '' then
    raise exception 'profile_id and hardware_id are required';
  end if;

  select * into profile_row
  from public.device_profiles
  where id = p_profile_id
  for share;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select * into existing
  from public.devices
  where organization_id = profile_row.organization_id
    and profile_id = p_profile_id
    and hardware_id = hw
  limit 1;

  if found then
    return existing;
  end if;

  if coalesce(trim(p_key_id), '') = ''
     or coalesce(trim(p_api_secret_encrypted), '') = '' then
    raise exception 'Device credentials are required for first registration';
  end if;

  device_name := coalesce(nullif(trim(p_name), ''), profile_row.name || ' / ' || hw);

  insert into public.devices (
    user_id,
    organization_id,
    name,
    api_key,
    key_id,
    api_secret_encrypted,
    api_secret_preview,
    protocol_version,
    tags,
    encryption_enabled,
    profile_id,
    hardware_id
  )
  values (
    profile_row.user_id,
    profile_row.organization_id,
    device_name,
    trim(p_key_id),
    trim(p_key_id),
    trim(p_api_secret_encrypted),
    nullif(trim(p_api_secret_preview), ''),
    2,
    jsonb_build_object(
      'Profile', profile_row.name,
      'Model', profile_row.device_model,
      'Firmware', profile_row.firmware_version
    ),
    false,
    profile_row.id,
    hw
  )
  returning * into created;

  insert into public.schemas (
    device_id,
    organization_id,
    schema_definition,
    version
  )
  values (
    created.id,
    profile_row.organization_id,
    profile_row.schema_definition,
    1
  );

  insert into public.schema_versions (
    device_id,
    version,
    schema_definition
  )
  values (
    created.id,
    1,
    profile_row.schema_definition
  );

  return created;
exception
  when unique_violation then
    -- Race: another frame registered the same hardware_id.
    select * into existing
    from public.devices
    where organization_id = profile_row.organization_id
      and profile_id = p_profile_id
      and hardware_id = hw
    limit 1;
    if found then
      return existing;
    end if;
    raise;
end;
$$;

grant execute on function public.zero_touch_register_device(uuid, text, text, text, text, text)
  to service_role;

-- ─── Bulk provision under a profile (serials / hardware ids) ──────────────────
create or replace function public.bulk_provision_profile_devices(
  p_org_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_devices jsonb,
  p_expected_current_count integer
)
returns setof public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_count integer;
  profile_row public.device_profiles%rowtype;
  conflict_hw text;
  inserted_ids uuid[];
begin
  if p_org_id is null or p_user_id is null or p_profile_id is null then
    raise exception 'organization, user, and profile are required';
  end if;

  if p_devices is null or jsonb_typeof(p_devices) <> 'array' or jsonb_array_length(p_devices) = 0 then
    raise exception 'devices array is required';
  end if;

  select * into profile_row
  from public.device_profiles
  where id = p_profile_id
    and organization_id = p_org_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select count(*)::integer into actual_count
  from public.devices
  where organization_id = p_org_id;

  if actual_count <> p_expected_current_count then
    raise exception 'DEVICE_COUNT_CHANGED:%:%', actual_count, p_expected_current_count
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_devices) elem
    where coalesce(trim(elem->>'hardware_id'), '') = ''
       or coalesce(trim(elem->>'name'), '') = ''
       or coalesce(trim(elem->>'key_id'), '') = ''
       or coalesce(trim(elem->>'api_secret_encrypted'), '') = ''
  ) then
    raise exception 'Invalid device row in profile bulk payload';
  end if;

  select lower(trim(elem->>'hardware_id')) into conflict_hw
  from jsonb_array_elements(p_devices) elem
  where exists (
    select 1
    from public.devices d
    where d.organization_id = p_org_id
      and d.profile_id = p_profile_id
      and d.hardware_id = lower(trim(elem->>'hardware_id'))
  )
  limit 1;

  if conflict_hw is not null then
    raise exception 'HARDWARE_ID_CONFLICT:%', conflict_hw
      using errcode = 'P0001';
  end if;

  if exists (
    select lower(trim(elem->>'hardware_id'))
    from jsonb_array_elements(p_devices) elem
    group by 1
    having count(*) > 1
  ) then
    raise exception 'Duplicate hardware ids in bulk payload';
  end if;

  with staged as (
    select
      gen_random_uuid() as id,
      trim(elem->>'name') as name,
      lower(trim(elem->>'hardware_id')) as hardware_id,
      nullif(lower(trim(elem->>'mac_address')), '') as mac_address,
      trim(elem->>'key_id') as key_id,
      trim(elem->>'api_secret_encrypted') as api_secret_encrypted,
      nullif(trim(elem->>'api_secret_preview'), '') as api_secret_preview,
      coalesce(elem->'tags', '{}'::jsonb) as tags
    from jsonb_array_elements(p_devices) elem
  ),
  ins_devices as (
    insert into public.devices (
      id,
      user_id,
      organization_id,
      name,
      api_key,
      key_id,
      api_secret_encrypted,
      api_secret_preview,
      protocol_version,
      mac_address,
      tags,
      encryption_enabled,
      profile_id,
      hardware_id
    )
    select
      s.id,
      p_user_id,
      p_org_id,
      s.name,
      s.key_id,
      s.key_id,
      s.api_secret_encrypted,
      s.api_secret_preview,
      2,
      s.mac_address,
      s.tags,
      false,
      p_profile_id,
      s.hardware_id
    from staged s
    returning id
  ),
  ins_schemas as (
    insert into public.schemas (
      device_id,
      organization_id,
      schema_definition,
      version
    )
    select
      d.id,
      p_org_id,
      profile_row.schema_definition,
      1
    from ins_devices d
  ),
  ins_versions as (
    insert into public.schema_versions (
      device_id,
      version,
      schema_definition
    )
    select
      d.id,
      1,
      profile_row.schema_definition
    from ins_devices d
  )
  select array_agg(d.id) into inserted_ids
  from ins_devices d;

  return query
  select d.*
  from public.devices d
  where d.id = any (inserted_ids);
end;
$$;

grant execute on function public.bulk_provision_profile_devices(uuid, uuid, uuid, jsonb, integer)
  to service_role;
