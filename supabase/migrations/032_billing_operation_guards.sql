-- Keep the two-argument RPC during rollout so the currently deployed app stays
-- compatible. New Checkout claims bind the requested plan and never blindly
-- repeat an ambiguous create after the lease expires.
alter table public.organization_checkout_claims
  add column if not exists target_tier text;

alter table public.organization_checkout_claims
  add constraint organization_checkout_claims_target_tier_check
  check (target_tier in ('flexible', 'pro', 'scale')) not valid;

create function public.claim_org_checkout_session(
  p_org_id uuid, p_claim_token uuid, p_target_tier text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_subscription_id text;
  v_claim public.organization_checkout_claims%rowtype;
begin
  if p_org_id is null or p_claim_token is null or p_target_tier is null or
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
  -- Legacy recorded sessions can be checked against their Stripe metadata.
  if v_claim.stripe_session_id is not null then
    return jsonb_build_object('status', 'session', 'sessionId', v_claim.stripe_session_id);
  end if;
  if v_claim.target_tier is distinct from p_target_tier then
    return jsonb_build_object('status', 'different_plan');
  end if;
  if v_claim.claim_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  -- Find a possibly created Stripe session before deciding whether a new
  -- payment is safe. Never rotate an ambiguous idempotency key automatically.
  return jsonb_build_object('status', 'reconcile', 'claimToken', v_claim.claim_token);
end;
$$;
revoke all on function public.claim_org_checkout_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_org_checkout_session(uuid, uuid, text) to service_role;

-- Hold this guard while retrieving Stripe state AND committing entitlements.
-- Plan changes use the same guard, preventing stale webhook snapshots from
-- overwriting a later paid upgrade. Ambiguous mutations retain it for repair.
create table public.organization_billing_operation_claims (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  claim_token uuid not null,
  claimed_at timestamptz not null default now(),
  claim_expires_at timestamptz not null default now() + interval '5 minutes',
  mutation_token uuid
);
alter table public.organization_billing_operation_claims enable row level security;
revoke all on public.organization_billing_operation_claims from public, anon, authenticated;
grant all on public.organization_billing_operation_claims to service_role;

create function public.claim_org_billing_operation(p_org_id uuid, p_claim_token uuid, p_read_only boolean default true)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_claim public.organization_billing_operation_claims%rowtype;
begin
  if p_org_id is null or p_claim_token is null then
    raise exception 'organization and billing-operation token are required';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    return false;
  end if;
  insert into public.organization_billing_operation_claims (organization_id, claim_token)
  values (p_org_id, p_claim_token) on conflict (organization_id) do nothing;
  if found then return true; end if;
  select * into v_claim from public.organization_billing_operation_claims
  where organization_id = p_org_id for update;
  if v_claim.claim_expires_at > now() then return false; end if;
  -- Reading can restore/revoke entitlements after an uncertain payment, but
  -- another mutation remains blocked until the original outcome is reviewed.
  if v_claim.mutation_token is not null and not p_read_only then return false; end if;
  update public.organization_billing_operation_claims
  set claim_token = p_claim_token, claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes'
  where organization_id = p_org_id;
  return true;
end;
$$;

create function public.mark_org_billing_mutation(p_org_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.organization_billing_operation_claims
  set mutation_token = p_claim_token
  where organization_id = p_org_id and claim_token = p_claim_token
    and claim_expires_at > now() and mutation_token is null;
  return found;
end;
$$;

create function public.release_org_billing_operation(p_org_id uuid, p_claim_token uuid, p_clear_mutation boolean default false)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_mutation_token uuid;
begin
  select mutation_token into v_mutation_token
  from public.organization_billing_operation_claims
  where organization_id = p_org_id and claim_token = p_claim_token for update;
  if not found then return false; end if;
  if v_mutation_token is not null and v_mutation_token <> p_claim_token and not p_clear_mutation then
    update public.organization_billing_operation_claims set claim_expires_at = now()
    where organization_id = p_org_id and claim_token = p_claim_token;
    return true;
  end if;
  delete from public.organization_billing_operation_claims
  where organization_id = p_org_id and claim_token = p_claim_token;
  return found;
end;
$$;

create function public.apply_org_billing_state(
  p_org_id uuid, p_claim_token uuid, p_expected_subscription_id text,
  p_subscription_id text, p_customer_id text, p_item_id text,
  p_tier text, p_quantity integer
)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if p_tier not in ('free', 'flexible', 'pro', 'scale') or p_tier is null or p_quantity < 0 or p_quantity is null then
    raise exception 'invalid billing entitlement';
  end if;
  -- Fence a slow worker whose read lease was taken over. Lock and commit the
  -- claim check and entitlement update in the same database transaction.
  perform 1 from public.organization_billing_operation_claims
  where organization_id = p_org_id and claim_token = p_claim_token
    and (claim_expires_at > now() or mutation_token = p_claim_token) for update;
  if not found then return false; end if;
  update public.organizations
  set stripe_subscription_id = p_subscription_id,
      stripe_customer_id = p_customer_id, stripe_item_id = p_item_id,
      subscription_tier = p_tier::public.subscription_tier_enum, stripe_quantity = p_quantity
  where id = p_org_id and stripe_subscription_id is not distinct from p_expected_subscription_id;
  return found;
end;
$$;
revoke all on function public.claim_org_billing_operation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.mark_org_billing_mutation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_org_billing_operation(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.apply_org_billing_state(uuid, uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_org_billing_operation(uuid, uuid, boolean) to service_role;
grant execute on function public.mark_org_billing_mutation(uuid, uuid) to service_role;
grant execute on function public.release_org_billing_operation(uuid, uuid, boolean) to service_role;
grant execute on function public.apply_org_billing_state(uuid, uuid, text, text, text, text, text, integer) to service_role;
