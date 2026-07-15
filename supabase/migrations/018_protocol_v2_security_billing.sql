-- Protocol v2 credentials, durable replay nonces, ACK downlinks, monthly usage true-up.

-- ─── Protocol v2 device credentials ───────────────────────────────────────────
alter table public.devices
  add column if not exists key_id text,
  add column if not exists api_secret_encrypted text,
  add column if not exists api_secret_preview text,
  add column if not exists protocol_version integer not null default 2;

comment on column public.devices.key_id is
  'Public 16-char device identifier on the wire (Protocol v2).';
comment on column public.devices.api_secret_encrypted is
  'AES-256-GCM encrypted API secret; service role / gateway only.';
comment on column public.devices.api_secret_preview is
  'Last four characters of the API secret for dashboard display.';

-- Backfill existing devices: key_id from legacy api_key; secrets must be rotated in dashboard.
update public.devices
set key_id = api_key,
    protocol_version = 2
where key_id is null;

alter table public.devices
  alter column key_id set not null;

create unique index if not exists devices_key_id_uidx on public.devices (key_id);

-- ─── Durable replay nonce store ───────────────────────────────────────────────
create table if not exists public.device_replay_nonces (
  device_id uuid not null references public.devices(id) on delete cascade,
  nonce bytea not null check (octet_length(nonce) = 12),
  frame_timestamp timestamptz not null,
  first_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (device_id, nonce)
);

create index if not exists device_replay_nonces_expires_idx
  on public.device_replay_nonces (expires_at);

alter table public.device_replay_nonces enable row level security;
grant all on public.device_replay_nonces to service_role;

create or replace function public.reserve_device_nonce(
  p_device_id uuid,
  p_nonce bytea,
  p_frame_timestamp timestamptz,
  p_skew_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_skew interval := make_interval(secs => greatest(p_skew_seconds, 1));
  v_expires timestamptz;
  v_inserted integer;
begin
  if p_device_id is null or p_nonce is null or octet_length(p_nonce) <> 12 then
    raise exception 'Invalid replay reservation payload';
  end if;

  if abs(extract(epoch from (v_now - p_frame_timestamp))) > p_skew_seconds then
    raise exception 'REPLAY_TIMESTAMP_SKEW';
  end if;

  v_expires := p_frame_timestamp + v_skew;

  insert into public.device_replay_nonces (device_id, nonce, frame_timestamp, expires_at)
  values (p_device_id, p_nonce, p_frame_timestamp, v_expires)
  on conflict (device_id, nonce) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    return true;
  end if;

  if exists (
    select 1
    from public.device_replay_nonces drn
    where drn.device_id = p_device_id
      and drn.nonce = p_nonce
      and drn.expires_at <= v_now
  ) then
    update public.device_replay_nonces
    set
      frame_timestamp = p_frame_timestamp,
      first_seen_at = v_now,
      expires_at = v_expires
    where device_id = p_device_id
      and nonce = p_nonce;
    return true;
  end if;

  raise exception 'REPLAY_DUPLICATE_NONCE';
end;
$$;

grant execute on function public.reserve_device_nonce(uuid, bytea, timestamptz, integer)
  to service_role;

-- ─── ACK downlink lifecycle ───────────────────────────────────────────────────
alter table public.pending_commands
  add column if not exists command_id uuid not null default gen_random_uuid(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists last_error text,
  add column if not exists device_result text;

alter table public.pending_commands
  drop constraint if exists pending_commands_status_check;

alter table public.pending_commands
  add constraint pending_commands_status_check
  check (status in ('pending', 'claimed', 'sent', 'acknowledged', 'failed'));

create unique index if not exists pending_commands_command_id_uidx
  on public.pending_commands (command_id);

create index if not exists pending_commands_retry_idx
  on public.pending_commands (device_id, next_attempt_at)
  where status in ('pending', 'sent');

create or replace function public.claim_pending_downlinks(
  p_device_id uuid,
  p_gateway_id text,
  p_limit integer default 8
)
returns setof public.pending_commands
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select pc.id
    from public.pending_commands pc
    where pc.device_id = p_device_id
      and (
        pc.status = 'pending'
        or (
          pc.status = 'sent'
          and pc.lease_expires_at is not null
          and pc.lease_expires_at <= now()
        )
      )
      and pc.next_attempt_at <= now()
      and (pc.expires_at is null or pc.expires_at > now())
    order by pc.created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  ),
  claimed as (
    update public.pending_commands pc
    set
      status = 'claimed',
      claimed_by = p_gateway_id,
      lease_expires_at = now() + interval '30 seconds',
      attempt_count = pc.attempt_count + 1
    from candidates c
    where pc.id = c.id
    returning pc.*
  )
  select * from claimed;
end;
$$;

grant execute on function public.claim_pending_downlinks(uuid, text, integer)
  to service_role;

create or replace function public.acknowledge_pending_command(
  p_device_id uuid,
  p_command_id uuid,
  p_result_code smallint default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  update public.pending_commands
  set
    status = 'acknowledged',
    acknowledged_at = now(),
    delivered_at = coalesce(delivered_at, now()),
    device_result = p_result_code::text,
    lease_expires_at = null,
    last_error = null
  where device_id = p_device_id
    and command_id = p_command_id
    and status in ('claimed', 'sent')
  returning id into updated_id;

  return updated_id is not null;
end;
$$;

grant execute on function public.acknowledge_pending_command(uuid, uuid, smallint)
  to service_role;

-- ─── Monthly usage true-up periods ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'usage_period_status') then
    create type public.usage_period_status as enum ('open', 'invoiced', 'void');
  end if;
end $$;

create table if not exists public.organization_device_usage_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_subscription_id text,
  stripe_period_start timestamptz not null,
  stripe_period_end timestamptz not null,
  tier text not null,
  included_paid_quantity integer not null default 0,
  peak_device_count integer not null default 0,
  peak_paid_quantity integer not null default 0,
  true_up_amount_cents integer,
  true_up_invoice_item_id text,
  status public.usage_period_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, stripe_period_start)
);

create index if not exists org_usage_periods_open_idx
  on public.organization_device_usage_periods (organization_id, status)
  where status = 'open';

alter table public.organization_device_usage_periods enable row level security;

create policy "org_usage_periods_select_writer"
  on public.organization_device_usage_periods for select to authenticated
  using (public.is_org_writer(organization_id));

grant select on public.organization_device_usage_periods to authenticated;
grant all on public.organization_device_usage_periods to service_role;

create or replace function public.record_org_device_peak(
  p_org_id uuid,
  p_active_device_count integer
)
returns public.organization_device_usage_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_period public.organization_device_usage_periods%rowtype;
  v_floor integer;
  v_peak_paid integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_org from public.organizations where id = p_org_id;
  if not found then
    raise exception 'Organization not found';
  end if;

  v_period_start := date_trunc('month', now());
  v_period_end := v_period_start + interval '1 month';

  v_floor := case v_org.subscription_tier
    when 'flexible' then 5
    when 'pro' then 150
    when 'scale' then 1000
    else 0
  end;

  insert into public.organization_device_usage_periods (
    organization_id,
    stripe_subscription_id,
    stripe_period_start,
    stripe_period_end,
    tier,
    included_paid_quantity,
    peak_device_count,
    peak_paid_quantity
  )
  values (
    p_org_id,
    v_org.stripe_subscription_id,
    v_period_start,
    v_period_end,
    v_org.subscription_tier,
    v_floor,
    greatest(p_active_device_count, 0),
    greatest(p_active_device_count - 5, v_floor)
  )
  on conflict (organization_id, stripe_period_start) do update
    set
      peak_device_count = greatest(
        organization_device_usage_periods.peak_device_count,
        excluded.peak_device_count
      ),
      peak_paid_quantity = greatest(
        organization_device_usage_periods.peak_paid_quantity,
        excluded.peak_paid_quantity
      ),
      tier = excluded.tier,
      included_paid_quantity = excluded.included_paid_quantity,
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, organization_device_usage_periods.stripe_subscription_id),
      updated_at = now()
  returning * into v_period;

  return v_period;
end;
$$;

grant execute on function public.record_org_device_peak(uuid, integer)
  to service_role;

-- ─── Bulk insert: protocol v2 credential fields ───────────────────────────────
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
       or coalesce(trim(elem->>'key_id'), '') = ''
       or coalesce(trim(elem->>'api_secret_encrypted'), '') = ''
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
      encryption_enabled
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
