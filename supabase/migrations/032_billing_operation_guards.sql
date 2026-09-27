-- Checkout retries must use the original tier/body with their retained Stripe
-- idempotency key. Paid plan updates need a separate per-org operation guard.
alter table public.organization_checkout_claims
  add column if not exists target_tier text;

alter table public.organization_checkout_claims
  add constraint organization_checkout_claims_target_tier_check
  check (target_tier in ('flexible', 'pro', 'scale')) not valid;

drop function if exists public.claim_org_checkout_session(uuid, uuid);
create function public.claim_org_checkout_session(
  p_org_id uuid,
  p_claim_token uuid,
  p_target_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id text;
  v_claim public.organization_checkout_claims%rowtype;
begin
  if p_org_id is null or p_claim_token is null or
     p_target_tier not in ('flexible', 'pro', 'scale') then
    raise exception 'valid organization, claim token, and paid tier are required';
  end if;

  select stripe_subscription_id into v_subscription_id
  from public.organizations where id = p_org_id for update;
  if not found then raise exception 'organization not found'; end if;
  if v_subscription_id is not null then
    return jsonb_build_object('status', 'subscribed');
  end if;

  select * into v_claim from public.organization_checkout_claims
  where organization_id = p_org_id for update;
  if not found then
    insert into public.organization_checkout_claims
      (organization_id, claim_token, claim_expires_at, target_tier)
    values (p_org_id, p_claim_token, now() + interval '5 minutes', p_target_tier);
    return jsonb_build_object('status', 'claimed', 'claimToken', p_claim_token);
  end if;

  if v_claim.target_tier is distinct from p_target_tier then
    return jsonb_build_object('status', 'different_plan');
  end if;
  if v_claim.stripe_session_id is not null then
    return jsonb_build_object('status', 'session', 'sessionId', v_claim.stripe_session_id);
  end if;
  if v_claim.claim_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;

  update public.organization_checkout_claims
  set claim_expires_at = now() + interval '5 minutes', updated_at = now()
  where organization_id = p_org_id;
  return jsonb_build_object('status', 'claimed', 'claimToken', v_claim.claim_token);
end;
$$;

revoke all on function public.claim_org_checkout_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_org_checkout_session(uuid, uuid, text) to service_role;

create table if not exists public.organization_plan_change_claims (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  claim_token uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.organization_plan_change_claims enable row level security;
revoke all on public.organization_plan_change_claims from public, anon, authenticated;
grant all on public.organization_plan_change_claims to service_role;

create or replace function public.claim_org_plan_change(p_org_id uuid, p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null or p_claim_token is null then
    raise exception 'organization and plan-change token are required';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id and stripe_subscription_id is not null) then
    return false;
  end if;
  insert into public.organization_plan_change_claims (organization_id, claim_token)
  values (p_org_id, p_claim_token)
  on conflict (organization_id) do nothing;
  return found;
end;
$$;

create or replace function public.release_org_plan_change(p_org_id uuid, p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.organization_plan_change_claims
  where organization_id = p_org_id and claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_org_plan_change(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_org_plan_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_org_plan_change(uuid, uuid) to service_role;
grant execute on function public.release_org_plan_change(uuid, uuid) to service_role;
