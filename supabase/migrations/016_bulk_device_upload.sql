-- Bulk device uploads: required organization-unique MAC addresses +
-- idempotent import job records and an atomic insert RPC.

-- ─── devices.mac_address ─────────────────────────────────────────────────────
alter table public.devices
  add column if not exists mac_address text;

comment on column public.devices.mac_address is
  'Canonical 12-char lowercase hex MAC (no separators). Unique per organization when set.';

-- Normalize accidental uppercase / separators if any data already exists.
update public.devices
set mac_address = lower(regexp_replace(mac_address, '[^0-9a-fA-F]', '', 'g'))
where mac_address is not null
  and mac_address !~ '^[0-9a-f]{12}$';

alter table public.devices
  drop constraint if exists devices_mac_address_format_check;

alter table public.devices
  add constraint devices_mac_address_format_check
  check (
    mac_address is null
    or mac_address ~ '^[0-9a-f]{12}$'
  );

create unique index if not exists devices_organization_mac_address_uidx
  on public.devices (organization_id, mac_address)
  where mac_address is not null;

-- ─── bulk_device_imports (quote + claim lifecycle) ────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'bulk_import_status') then
    create type public.bulk_import_status as enum (
      'quoted',
      'processing',
      'completed',
      'failed',
      'expired'
    );
  end if;
end $$;

create table if not exists public.bulk_device_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload_hash text not null,
  devices jsonb not null,
  status public.bulk_import_status not null default 'quoted',
  current_device_count integer not null,
  projected_device_count integer not null,
  previous_stripe_quantity integer not null,
  target_stripe_quantity integer not null,
  estimated_proration_amount integer,
  currency text,
  stripe_idempotency_key text not null,
  error_message text,
  created_device_ids uuid[] not null default '{}',
  quoted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bulk_device_imports_org_status_idx
  on public.bulk_device_imports (organization_id, status);

create index if not exists bulk_device_imports_expires_at_idx
  on public.bulk_device_imports (expires_at)
  where status = 'quoted';

comment on table public.bulk_device_imports is
  'Short-lived bulk import quotes bound to a payload hash. Used for Stripe confirm + atomic insert.';

alter table public.bulk_device_imports enable row level security;

drop policy if exists "bulk_device_imports_select_writer" on public.bulk_device_imports;
create policy "bulk_device_imports_select_writer"
  on public.bulk_device_imports for select to authenticated
  using (public.is_org_writer(organization_id));

-- Mutations go through the service role from Nuxt API routes.
grant select on public.bulk_device_imports to authenticated;
grant all on public.bulk_device_imports to service_role;

-- ─── Atomic bulk insert (devices + schemas + schema_versions) ────────────────
create or replace function public.bulk_insert_devices(
  p_org_id uuid,
  p_user_id uuid,
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
  conflict_mac text;
  inserted_ids uuid[];
begin
  if p_org_id is null or p_user_id is null then
    raise exception 'organization and user are required';
  end if;

  if p_devices is null or jsonb_typeof(p_devices) <> 'array' or jsonb_array_length(p_devices) = 0 then
    raise exception 'devices array is required';
  end if;

  -- Serialize concurrent imports for the same organization.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select count(*)::integer into actual_count
  from public.devices
  where organization_id = p_org_id;

  if actual_count <> p_expected_current_count then
    raise exception 'DEVICE_COUNT_CHANGED:%:%', actual_count, p_expected_current_count
      using errcode = 'P0001';
  end if;

  select d.mac_address into conflict_mac
  from public.devices d
  where d.organization_id = p_org_id
    and d.mac_address in (
      select lower(trim(elem->>'mac_address'))
      from jsonb_array_elements(p_devices) elem
    )
  limit 1;

  if conflict_mac is not null then
    raise exception 'MAC_CONFLICT:%', conflict_mac
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_devices) elem
    where coalesce(trim(elem->>'name'), '') = ''
       or lower(trim(elem->>'mac_address')) !~ '^[0-9a-f]{12}$'
       or coalesce(trim(elem->>'api_key'), '') = ''
  ) then
    raise exception 'Invalid device row in bulk payload';
  end if;

  if exists (
    select lower(trim(elem->>'mac_address'))
    from jsonb_array_elements(p_devices) elem
    group by 1
    having count(*) > 1
  ) then
    raise exception 'Duplicate MAC addresses in bulk payload';
  end if;

  with staged as (
    select
      gen_random_uuid() as id,
      trim(elem->>'name') as name,
      lower(trim(elem->>'mac_address')) as mac_address,
      trim(elem->>'api_key') as api_key,
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
      mac_address,
      tags,
      encryption_enabled
    )
    select
      s.id,
      p_user_id,
      p_org_id,
      s.name,
      s.api_key,
      s.mac_address,
      s.tags,
      false
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
      '[]'::jsonb,
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
      '[]'::jsonb
    from ins_devices d
  )
  select array_agg(d.id) into inserted_ids
  from ins_devices d;

  return query
  select d.*
  from public.devices d
  where d.id = any(inserted_ids)
  order by d.created_at desc;
end;
$$;

grant execute on function public.bulk_insert_devices(uuid, uuid, jsonb, integer)
  to service_role;
