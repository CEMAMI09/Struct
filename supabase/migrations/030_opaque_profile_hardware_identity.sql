-- Device identities are opaque values decoded from the profile schema.
-- Preserve printable bytes exactly across fleet ingestion, web zero-touch and
-- CSV provisioning. Case folding or stripping separators can merge two units.
-- Apply before deploying the matching gateway and web code.

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
  hw text := p_hardware_id;
  device_name text;
begin
  if p_profile_id is null or hw is null or length(hw) not between 1 and 128
     or hw !~ '^[ -~]+$' or btrim(hw) = '' then
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
    where (elem->>'hardware_id') is null
       or length(elem->>'hardware_id') not between 1 and 128
       or (elem->>'hardware_id') !~ '^[ -~]+$'
       or btrim(elem->>'hardware_id') = ''
       or coalesce(trim(elem->>'name'), '') = ''
       or coalesce(trim(elem->>'key_id'), '') = ''
       or coalesce(trim(elem->>'api_secret_encrypted'), '') = ''
  ) then
    raise exception 'Invalid device row in profile bulk payload';
  end if;

  select elem->>'hardware_id' into conflict_hw
  from jsonb_array_elements(p_devices) elem
  where exists (
    select 1
    from public.devices d
    where d.organization_id = p_org_id
      and d.profile_id = p_profile_id
      and d.hardware_id = (elem->>'hardware_id')
  )
  limit 1;

  if conflict_hw is not null then
    raise exception 'HARDWARE_ID_CONFLICT:%', conflict_hw
      using errcode = 'P0001';
  end if;

  if exists (
    select elem->>'hardware_id'
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
      (elem->>'hardware_id') as hardware_id,
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
