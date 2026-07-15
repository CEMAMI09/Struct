-- Immutable, organization-scoped audit trail for infrastructure changes.
-- This migration must run after 005_organizations_rbac.sql.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid not null,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_organization_created_at_idx
  on public.audit_logs (organization_id, created_at desc);

create index if not exists audit_logs_record_idx
  on public.audit_logs (table_name, record_id, created_at desc);

alter table public.audit_logs enable row level security;

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated, service_role;

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
        and o.subscription_tier = 'enterprise'
    )
  );

create or replace function public.capture_infrastructure_audit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  audit_organization_id uuid;
  audit_record_id uuid;
begin
  -- last_seen is telemetry activity, not an infrastructure configuration change.
  if tg_table_name = 'devices'
     and tg_op = 'UPDATE'
     and (to_jsonb(old) - 'last_seen') = (to_jsonb(new) - 'last_seen') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new_data := to_jsonb(new);
    row_data := new_data;
  elsif tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    new_data := to_jsonb(new);
    row_data := new_data;
  elsif tg_op = 'DELETE' then
    old_data := to_jsonb(old);
    row_data := old_data;
  else
    raise exception 'Unsupported audit operation: %', tg_op;
  end if;

  audit_record_id := nullif(row_data ->> 'id', '')::uuid;
  audit_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;

  -- Schemas and any legacy device-scoped rows can inherit the organization
  -- from their device when organization_id is not present on the row.
  if audit_organization_id is null and nullif(row_data ->> 'device_id', '') is not null then
    select d.organization_id
      into audit_organization_id
      from public.devices d
     where d.id = (row_data ->> 'device_id')::uuid;
  end if;

  if audit_organization_id is null then
    raise exception
      'Cannot audit %.% without an organization_id',
      tg_table_schema,
      tg_table_name;
  end if;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    table_name,
    record_id,
    previous_data,
    new_data
  )
  values (
    audit_organization_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    audit_record_id,
    old_data,
    new_data
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_infrastructure_audit() from public;

drop trigger if exists audit_devices_changes on public.devices;
create trigger audit_devices_changes
after insert or update or delete on public.devices
for each row execute function public.capture_infrastructure_audit();

drop trigger if exists audit_schemas_changes on public.schemas;
create trigger audit_schemas_changes
after insert or update or delete on public.schemas
for each row execute function public.capture_infrastructure_audit();

drop trigger if exists audit_destinations_changes on public.destinations;
create trigger audit_destinations_changes
after insert or update or delete on public.destinations
for each row execute function public.capture_infrastructure_audit();

-- Prevent application roles, including service_role, from rewriting history.
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

revoke all on function public.prevent_audit_log_mutation() from public;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();
