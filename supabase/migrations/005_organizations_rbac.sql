-- Multi-tenant B2B Organizations + RBAC
-- Run after 001–004 (schema versioning).
-- Transitions from single-user B2C (user_id ownership) to organization membership.

-- ─── Role enum ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_role') then
    create type public.org_role as enum ('owner', 'admin', 'viewer');
  end if;
end $$;

-- ─── organizations ───────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text,
  subscription_tier text not null default 'free',
  created_at timestamptz not null default now()
);

comment on table public.organizations is
  'B2B tenant; devices/schemas/destinations belong to an organization';

create index if not exists organizations_stripe_customer_id_idx
  on public.organizations(stripe_customer_id)
  where stripe_customer_id is not null;

-- ─── organization_members ────────────────────────────────────────────────────
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

create index if not exists organization_members_org_id_idx
  on public.organization_members(organization_id);

comment on table public.organization_members is
  'Links auth.users to organizations with RBAC role (owner | admin | viewer)';

-- ─── Helper predicates (SECURITY DEFINER — avoid RLS recursion) ──────────────
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_writer(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_writer(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;

-- ─── Add organization_id columns ─────────────────────────────────────────────
alter table public.devices
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.schemas
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.destinations
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Optional: pending_commands / schema_versions stay device-scoped; RLS joins via devices.organization_id

-- ─── Backfill: one org per legacy user_id, owner membership, stamp rows ───────
do $$
declare
  r record;
  new_org_id uuid;
begin
  for r in
    select distinct user_id
    from public.devices
    where user_id is not null
    union
    select distinct user_id
    from public.destinations
    where user_id is not null
  loop
    -- Reuse an org the user already owns if present
    select om.organization_id into new_org_id
    from public.organization_members om
    where om.user_id = r.user_id and om.role = 'owner'
    limit 1;

    if new_org_id is null then
      insert into public.organizations (name, subscription_tier)
      values ('Personal', 'free')
      returning id into new_org_id;

      insert into public.organization_members (organization_id, user_id, role)
      values (new_org_id, r.user_id, 'owner')
      on conflict (organization_id, user_id) do nothing;
    end if;

    update public.devices
    set organization_id = new_org_id
    where user_id = r.user_id
      and organization_id is null;

    update public.destinations
    set organization_id = new_org_id
    where user_id = r.user_id
      and organization_id is null;
  end loop;

  -- Schemas inherit org from their device
  update public.schemas s
  set organization_id = d.organization_id
  from public.devices d
  where s.device_id = d.id
    and s.organization_id is null
    and d.organization_id is not null;
end $$;

create index if not exists devices_organization_id_idx on public.devices(organization_id);
create index if not exists schemas_organization_id_idx on public.schemas(organization_id);
create index if not exists destinations_organization_id_idx on public.destinations(organization_id);

-- ─── Grants ──────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant all on public.organizations to service_role;
grant all on public.organization_members to service_role;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- ─── Drop legacy user_id RLS policies ────────────────────────────────────────
drop policy if exists "devices_select_own" on public.devices;
drop policy if exists "devices_insert_own" on public.devices;
drop policy if exists "devices_update_own" on public.devices;
drop policy if exists "devices_delete_own" on public.devices;

drop policy if exists "schemas_select_own" on public.schemas;
drop policy if exists "schemas_insert_own" on public.schemas;
drop policy if exists "schemas_update_own" on public.schemas;
drop policy if exists "schemas_delete_own" on public.schemas;

drop policy if exists "telemetry_select_own" on public.telemetry;
drop policy if exists "telemetry_insert_own" on public.telemetry;

drop policy if exists "destinations_select_own" on public.destinations;
drop policy if exists "destinations_insert_own" on public.destinations;
drop policy if exists "destinations_update_own" on public.destinations;
drop policy if exists "destinations_delete_own" on public.destinations;

drop policy if exists "pending_commands_select_own" on public.pending_commands;
drop policy if exists "pending_commands_insert_own" on public.pending_commands;
drop policy if exists "pending_commands_update_own" on public.pending_commands;
drop policy if exists "pending_commands_delete_own" on public.pending_commands;

drop policy if exists "schema_versions_select_own" on public.schema_versions;
drop policy if exists "schema_versions_insert_own" on public.schema_versions;
drop policy if exists "schema_versions_update_own" on public.schema_versions;
drop policy if exists "schema_versions_delete_own" on public.schema_versions;

-- ─── organizations RLS ───────────────────────────────────────────────────────
create policy "organizations_select_member"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "organizations_insert_authenticated"
  on public.organizations for insert to authenticated
  with check (true);

create policy "organizations_update_owner"
  on public.organizations for update to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

create policy "organizations_delete_owner"
  on public.organizations for delete to authenticated
  using (public.is_org_owner(id));

-- ─── organization_members RLS ────────────────────────────────────────────────
create policy "organization_members_select_member"
  on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

create policy "organization_members_insert_writer"
  on public.organization_members for insert to authenticated
  with check (public.is_org_writer(organization_id));

create policy "organization_members_update_owner"
  on public.organization_members for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "organization_members_delete_writer"
  on public.organization_members for delete to authenticated
  using (
    public.is_org_owner(organization_id)
    or (
      public.is_org_writer(organization_id)
      and role <> 'owner'
    )
  );

-- Allow a user creating a brand-new org to insert themselves as owner
-- (is_org_writer would fail before the first membership row exists).
create policy "organization_members_insert_self_owner"
  on public.organization_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_members.organization_id
    )
  );

-- ─── devices RLS ─────────────────────────────────────────────────────────────
-- All members can SELECT; only owner/admin can mutate (viewers are SELECT-only).
create policy "devices_select_member"
  on public.devices for select to authenticated
  using (public.is_org_member(organization_id));

create policy "devices_insert_writer"
  on public.devices for insert to authenticated
  with check (public.is_org_writer(organization_id));

create policy "devices_update_writer"
  on public.devices for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy "devices_delete_writer"
  on public.devices for delete to authenticated
  using (public.is_org_writer(organization_id));

-- ─── schemas RLS ─────────────────────────────────────────────────────────────
-- Viewers: SELECT only. Writers: full CRUD within their org.
create policy "schemas_select_member"
  on public.schemas for select to authenticated
  using (public.is_org_member(organization_id));

create policy "schemas_insert_writer"
  on public.schemas for insert to authenticated
  with check (
    public.is_org_writer(organization_id)
    and exists (
      select 1 from public.devices d
      where d.id = schemas.device_id
        and d.organization_id = schemas.organization_id
    )
  );

create policy "schemas_update_writer"
  on public.schemas for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (
    public.is_org_writer(organization_id)
    and exists (
      select 1 from public.devices d
      where d.id = schemas.device_id
        and d.organization_id = schemas.organization_id
    )
  );

create policy "schemas_delete_writer"
  on public.schemas for delete to authenticated
  using (public.is_org_writer(organization_id));

-- ─── destinations RLS ────────────────────────────────────────────────────────
create policy "destinations_select_member"
  on public.destinations for select to authenticated
  using (public.is_org_member(organization_id));

create policy "destinations_insert_writer"
  on public.destinations for insert to authenticated
  with check (public.is_org_writer(organization_id));

create policy "destinations_update_writer"
  on public.destinations for update to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy "destinations_delete_writer"
  on public.destinations for delete to authenticated
  using (public.is_org_writer(organization_id));

-- ─── telemetry RLS (via device → organization) ───────────────────────────────
create policy "telemetry_select_member"
  on public.telemetry for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = telemetry.device_id
        and public.is_org_member(d.organization_id)
    )
  );

create policy "telemetry_insert_writer"
  on public.telemetry for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = telemetry.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

-- ─── pending_commands RLS (via device → organization) ────────────────────────
create policy "pending_commands_select_member"
  on public.pending_commands for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id
        and public.is_org_member(d.organization_id)
    )
  );

create policy "pending_commands_insert_writer"
  on public.pending_commands for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

create policy "pending_commands_update_writer"
  on public.pending_commands for update to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id
        and public.is_org_writer(d.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

create policy "pending_commands_delete_writer"
  on public.pending_commands for delete to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

-- ─── schema_versions RLS (via device → organization; writers mutate) ─────────
create policy "schema_versions_select_member"
  on public.schema_versions for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id
        and public.is_org_member(d.organization_id)
    )
  );

create policy "schema_versions_insert_writer"
  on public.schema_versions for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

create policy "schema_versions_update_writer"
  on public.schema_versions for update to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id
        and public.is_org_writer(d.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id
        and public.is_org_writer(d.organization_id)
    )
  );

create policy "schema_versions_delete_writer"
  on public.schema_versions for delete to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id
        and public.is_org_writer(d.organization_id)
    )
  );
