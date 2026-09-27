-- One in-flight paid Checkout per organization. A service-only lease keeps
-- concurrent requests from creating separate paid subscriptions. Retain the
-- claim token after a timeout so a retry reuses Stripe's idempotency key.
create table if not exists public.organization_checkout_claims (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  claim_token uuid not null,
  claim_expires_at timestamptz not null,
  stripe_session_id text unique,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_checkout_claims enable row level security;
revoke all on public.organization_checkout_claims from public, anon, authenticated;
grant all on public.organization_checkout_claims to service_role;

create or replace function public.claim_org_checkout_session(
  p_org_id uuid,
  p_claim_token uuid
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
  if p_org_id is null or p_claim_token is null then
    raise exception 'organization and checkout claim token are required';
  end if;

  -- Serializes concurrent Checkout starts with subscription reconciliation.
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
      (organization_id, claim_token, claim_expires_at)
    values (p_org_id, p_claim_token, now() + interval '5 minutes');
    return jsonb_build_object('status', 'claimed', 'claimToken', p_claim_token);
  end if;

  if v_claim.stripe_session_id is not null then
    return jsonb_build_object('status', 'session', 'sessionId', v_claim.stripe_session_id);
  end if;

  if v_claim.claim_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;

  -- An API timeout may have hidden a successful Stripe session creation.
  -- Reuse the same token/idempotency key on the next request.
  update public.organization_checkout_claims
  set claim_expires_at = now() + interval '5 minutes', updated_at = now()
  where organization_id = p_org_id;
  return jsonb_build_object('status', 'claimed', 'claimToken', v_claim.claim_token);
end;
$$;

create or replace function public.complete_org_checkout_session(
  p_org_id uuid,
  p_claim_token uuid,
  p_session_id text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organization_checkout_claims
  set stripe_session_id = p_session_id,
      session_expires_at = p_expires_at,
      updated_at = now()
  where organization_id = p_org_id
    and claim_token = p_claim_token
    and (stripe_session_id is null or stripe_session_id = p_session_id);
  return found;
end;
$$;

create or replace function public.release_org_checkout_session(
  p_org_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.organization_checkout_claims
  where organization_id = p_org_id and stripe_session_id = p_session_id;
  return found;
end;
$$;

create or replace function public.release_org_checkout_claim(
  p_org_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.organization_checkout_claims
  where organization_id = p_org_id
    and claim_token = p_claim_token
    and stripe_session_id is null;
  return found;
end;
$$;

revoke all on function public.claim_org_checkout_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_org_checkout_session(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_org_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.release_org_checkout_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_org_checkout_session(uuid, uuid) to service_role;
grant execute on function public.complete_org_checkout_session(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.release_org_checkout_session(uuid, text) to service_role;
grant execute on function public.release_org_checkout_claim(uuid, uuid) to service_role;
