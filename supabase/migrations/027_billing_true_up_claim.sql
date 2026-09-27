-- Serialize usage true-ups across webhook retries and concurrent workers.
-- The claim is short-lived; Stripe invoice-item metadata is reconciled before
-- creating a charge so a crash after Stripe accepts it can be recovered.
alter table public.organization_device_usage_periods
  add column if not exists true_up_claim_token uuid,
  add column if not exists true_up_claim_expires_at timestamptz,
  add column if not exists true_up_baseline_verified boolean not null default true;

-- The old peak function stored only a tier floor and could overwrite a higher
-- paid quantity or tier. Current Stripe state cannot prove the historical
-- maximum even for this month, so reconcile every preexisting open period.
update public.organization_device_usage_periods
set true_up_baseline_verified = false, updated_at = now()
where status = 'open';

create index if not exists org_usage_periods_due_idx
  on public.organization_device_usage_periods (organization_id, stripe_period_end)
  where status = 'open';

-- The included quantity is the quantity already paid for in Stripe. A tier
-- floor alone can bill those same devices again as overage. Keep the monthly
-- snapshot monotonic when a later peak arrives after a plan/quantity change.
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
  v_included integer;
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
  v_included := greatest(v_floor, v_org.stripe_quantity);

  insert into public.organization_device_usage_periods (
    organization_id, stripe_subscription_id, stripe_period_start,
    stripe_period_end, tier, included_paid_quantity, peak_device_count,
    peak_paid_quantity
  ) values (
    p_org_id, v_org.stripe_subscription_id, v_period_start, v_period_end,
    v_org.subscription_tier, v_included,
    greatest(p_active_device_count, 0),
    greatest(p_active_device_count - 5, v_included)
  )
  on conflict (organization_id, stripe_period_start) do update set
    peak_device_count = greatest(
      organization_device_usage_periods.peak_device_count,
      excluded.peak_device_count
    ),
    peak_paid_quantity = greatest(
      organization_device_usage_periods.peak_paid_quantity,
      excluded.peak_paid_quantity,
      organization_device_usage_periods.included_paid_quantity,
      excluded.included_paid_quantity
    ),
    included_paid_quantity = greatest(
      organization_device_usage_periods.included_paid_quantity,
      excluded.included_paid_quantity
    ),
    tier = case
      when public.subscription_tier_rank(excluded.tier) >
           public.subscription_tier_rank(organization_device_usage_periods.tier)
        then excluded.tier
      else organization_device_usage_periods.tier
    end,
    stripe_subscription_id = coalesce(
      excluded.stripe_subscription_id,
      organization_device_usage_periods.stripe_subscription_id
    ),
    updated_at = now()
  returning * into v_period;

  return v_period;
end;
$$;

-- Capture every service-created device in the same transaction as its insert,
-- including bulk imports, profile provisioning and zero-touch registration.
-- The same org lock used by bulk imports makes a count after concurrent inserts
-- observe the prior committed insert before raising the monthly peak.
create or replace function public.record_inserted_device_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_count integer;
begin
  for v_org_id in
    select distinct organization_id from inserted_devices
    where organization_id is not null
    order by organization_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_org_id::text, 0));
    select count(*)::integer into v_count from public.devices
    where organization_id = v_org_id;
    if v_count > 5 and exists (
      select 1 from public.organizations o
      where o.id = v_org_id and o.subscription_tier = 'free'
    ) then
      raise exception 'FREE_DEVICE_LIMIT_EXCEEDED' using errcode = '42501';
    end if;
    perform public.record_org_device_peak(v_org_id, v_count);
  end loop;
  return null;
end;
$$;

drop trigger if exists record_inserted_device_usage on public.devices;
create trigger record_inserted_device_usage
after insert on public.devices
referencing new table as inserted_devices
for each statement execute function public.record_inserted_device_usage();

revoke all on function public.record_inserted_device_usage() from public, anon, authenticated;
grant execute on function public.record_inserted_device_usage() to service_role;

-- A single-device request used to do three writes and then record usage. An
-- error between those calls could leave a provisioned device without its
-- one-time credentials being returned to the user. Keep the whole write in
-- one service-only database transaction.
create or replace function public.create_device_with_usage(
  p_org_id uuid,
  p_user_id uuid,
  p_name text,
  p_key_id text,
  p_api_secret_encrypted text,
  p_api_secret_preview text,
  p_mac_address text,
  p_expected_current_count integer
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.devices%rowtype;
  v_count integer;
begin
  if p_org_id is null or p_user_id is null or
     coalesce(trim(p_name), '') = '' or
     coalesce(trim(p_key_id), '') = '' or
     coalesce(trim(p_api_secret_encrypted), '') = '' or
     p_expected_current_count is null or p_expected_current_count < 0 then
    raise exception 'Invalid device creation request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));
  select count(*)::integer into v_count from public.devices
  where organization_id = p_org_id;
  if v_count <> p_expected_current_count then
    raise exception 'DEVICE_COUNT_CHANGED:%:%', v_count, p_expected_current_count
      using errcode = 'P0001';
  end if;

  insert into public.devices (
    user_id, organization_id, name, api_key, key_id,
    api_secret_encrypted, api_secret_preview, protocol_version,
    tags, encryption_enabled, mac_address
  ) values (
    p_user_id, p_org_id, trim(p_name), trim(p_key_id), trim(p_key_id),
    trim(p_api_secret_encrypted), nullif(trim(p_api_secret_preview), ''), 2,
    '{}'::jsonb, false, nullif(lower(trim(p_mac_address)), '')
  ) returning * into v_device;

  insert into public.schemas(device_id, organization_id, schema_definition, version)
  values(v_device.id, p_org_id, '[]'::jsonb, 1);
  insert into public.schema_versions(device_id, version, schema_definition)
  values(v_device.id, 1, '[]'::jsonb);

  return v_device;
end;
$$;

revoke all on function public.create_device_with_usage(uuid,uuid,text,text,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.create_device_with_usage(uuid,uuid,text,text,text,text,text,integer)
  to service_role;

-- Portal and webhook updates can increase the paid Stripe quantity without a
-- new device peak. Refresh the current calendar row so a later true-up does
-- not charge for capacity already on the subscription invoice.
create or replace function public.refresh_org_usage_paid_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor integer;
  v_included integer;
begin
  if new.stripe_quantity <= old.stripe_quantity and
     public.subscription_tier_rank(new.subscription_tier::text) <=
     public.subscription_tier_rank(old.subscription_tier::text) then
    return new;
  end if;

  v_floor := case new.subscription_tier
    when 'flexible' then 5
    when 'pro' then 150
    when 'scale' then 1000
    else 0
  end;
  v_included := greatest(v_floor, new.stripe_quantity);

  update public.organization_device_usage_periods p
  set included_paid_quantity = greatest(p.included_paid_quantity, v_included),
      peak_paid_quantity = greatest(p.peak_paid_quantity, v_included),
      tier = case
        when public.subscription_tier_rank(new.subscription_tier::text) >
             public.subscription_tier_rank(p.tier)
          then new.subscription_tier::text
        else p.tier
      end,
      stripe_subscription_id = coalesce(new.stripe_subscription_id, p.stripe_subscription_id),
      updated_at = now()
  where p.organization_id = new.id
    and p.status = 'open'
    and p.stripe_period_start <= now()
    and p.stripe_period_end > now();

  return new;
end;
$$;

drop trigger if exists refresh_org_usage_paid_baseline on public.organizations;
create trigger refresh_org_usage_paid_baseline
after update of stripe_quantity, subscription_tier on public.organizations
for each row execute function public.refresh_org_usage_paid_baseline();

revoke all on function public.refresh_org_usage_paid_baseline() from public, anon, authenticated;
grant execute on function public.refresh_org_usage_paid_baseline() to service_role;

-- Bring preexisting current calendar rows up to the live Stripe quantity as a
-- starting point for reconciliation. This does not verify their past maximum.
update public.organization_device_usage_periods p
set included_paid_quantity = greatest(
      p.included_paid_quantity,
      o.stripe_quantity,
      case o.subscription_tier
        when 'flexible' then 5 when 'pro' then 150
        when 'scale' then 1000 else 0
      end
    ),
    peak_paid_quantity = greatest(
      p.peak_paid_quantity,
      p.included_paid_quantity,
      o.stripe_quantity,
      case o.subscription_tier
        when 'flexible' then 5 when 'pro' then 150
        when 'scale' then 1000 else 0
      end
    ),
    tier = case
      when public.subscription_tier_rank(o.subscription_tier::text) >
           public.subscription_tier_rank(p.tier)
        then o.subscription_tier::text
      else p.tier
    end,
    stripe_subscription_id = coalesce(o.stripe_subscription_id, p.stripe_subscription_id),
    updated_at = now()
from public.organizations o
where p.organization_id = o.id
  and p.status = 'open'
  and p.stripe_period_start = date_trunc('month', now())
  and p.stripe_period_end = date_trunc('month', now()) + interval '1 month';

create or replace function public.claim_org_usage_true_up(
  p_period_id uuid,
  p_claim_token uuid
)
returns public.organization_device_usage_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.organization_device_usage_periods%rowtype;
begin
  if p_claim_token is null then
    raise exception 'Claim token is required';
  end if;

  update public.organization_device_usage_periods
  set true_up_claim_token = p_claim_token,
      true_up_claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where id = p_period_id
    and status = 'open'
    and stripe_period_end <= now()
    and true_up_baseline_verified
    and (true_up_claim_token is null or true_up_claim_expires_at <= now())
  returning * into v_period;

  if not found and exists (
    select 1 from public.organization_device_usage_periods
    where id = p_period_id and status = 'open' and not true_up_baseline_verified
  ) then
    raise exception 'USAGE_BASELINE_RECONCILIATION_REQUIRED for period %', p_period_id;
  end if;

  return v_period;
end;
$$;

create or replace function public.complete_org_usage_true_up(
  p_period_id uuid,
  p_claim_token uuid,
  p_invoice_item_id text,
  p_amount_cents integer,
  p_status public.usage_period_status default 'invoiced'
)
returns public.organization_device_usage_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.organization_device_usage_periods%rowtype;
begin
  if p_status not in ('invoiced', 'void') then
    raise exception 'Invalid true-up completion status';
  end if;

  update public.organization_device_usage_periods
  set status = p_status,
      true_up_amount_cents = p_amount_cents,
      true_up_invoice_item_id = p_invoice_item_id,
      true_up_claim_token = null,
      true_up_claim_expires_at = null,
      updated_at = now()
  where id = p_period_id
    and status = 'open'
    and true_up_claim_token = p_claim_token
  returning * into v_period;

  if not found then
    raise exception 'Usage true-up claim was lost for period %', p_period_id;
  end if;

  return v_period;
end;
$$;

create or replace function public.release_org_usage_true_up(
  p_period_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organization_device_usage_periods
  set true_up_claim_token = null,
      true_up_claim_expires_at = null,
      updated_at = now()
  where id = p_period_id
    and status = 'open'
    and true_up_claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_org_usage_true_up(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_org_usage_true_up(uuid, uuid, text, integer, public.usage_period_status) from public, anon, authenticated;
revoke all on function public.release_org_usage_true_up(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_org_usage_true_up(uuid, uuid) to service_role;
grant execute on function public.complete_org_usage_true_up(uuid, uuid, text, integer, public.usage_period_status) to service_role;
grant execute on function public.release_org_usage_true_up(uuid, uuid) to service_role;
