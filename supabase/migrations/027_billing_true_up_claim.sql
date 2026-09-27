-- Serialize usage true-ups across webhook retries and concurrent workers.
-- The claim is short-lived; Stripe invoice-item metadata is reconciled before
-- creating a charge so a crash after Stripe accepts it can be recovered.
alter table public.organization_device_usage_periods
  add column if not exists true_up_claim_token uuid,
  add column if not exists true_up_claim_expires_at timestamptz;

create index if not exists org_usage_periods_due_idx
  on public.organization_device_usage_periods (organization_id, stripe_period_end)
  where status = 'open';

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
    and (true_up_claim_token is null or true_up_claim_expires_at <= now())
  returning * into v_period;

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
