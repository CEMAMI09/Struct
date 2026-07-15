-- Stripe hybrid billing: base tier + auto-scaling quantity.
-- Device limit = 5 (free pool) + stripe_quantity (paid pool).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_tier_enum') then
    create type public.subscription_tier_enum as enum ('free', 'flexible', 'pro', 'scale');
  end if;
end $$;

alter table public.organizations
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_item_id text,
  add column if not exists stripe_quantity integer not null default 0;

alter table public.organizations
  alter column subscription_tier drop default;

alter table public.organizations
  alter column subscription_tier type public.subscription_tier_enum
  using (
    case lower(trim(subscription_tier::text))
      when 'flexible' then 'flexible'::public.subscription_tier_enum
      when 'pro' then 'pro'::public.subscription_tier_enum
      when 'scale' then 'scale'::public.subscription_tier_enum
      when 'studio' then 'scale'::public.subscription_tier_enum
      when 'enterprise' then 'scale'::public.subscription_tier_enum
      else 'free'::public.subscription_tier_enum
    end
  );

alter table public.organizations
  alter column subscription_tier set default 'free'::public.subscription_tier_enum;

create index if not exists organizations_stripe_subscription_id_idx
  on public.organizations(stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.organizations.stripe_quantity is
  'Paid device pool billed through Stripe. Total device limit = 5 + stripe_quantity.';

create or replace function public.get_org_device_limit(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 5 + coalesce(o.stripe_quantity, 0)
  from public.organizations o
  where o.id = p_org_id;
$$;

grant execute on function public.get_org_device_limit(uuid) to authenticated, service_role;

-- Enterprise audit-log access maps to the Scale tier.
drop policy if exists "audit_logs_select_member" on public.audit_logs;
create policy "audit_logs_select_member"
  on public.audit_logs
  for select
  to authenticated
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1
      from public.organizations o
      where o.id = audit_logs.organization_id
        and o.subscription_tier = 'scale'
    )
  );
