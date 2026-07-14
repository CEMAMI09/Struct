-- Fix: devices RLS inserts failing with
-- "new row violates row-level security policy for table devices"
-- Run this in the Supabase SQL editor.

-- Ensure authenticated role can use the tables
grant usage on schema public to authenticated, anon, service_role;

grant select, insert, update, delete on public.devices to authenticated;
grant select, insert, update, delete on public.schemas to authenticated;
grant select, insert on public.telemetry to authenticated;

grant all on public.devices to service_role;
grant all on public.schemas to service_role;
grant all on public.telemetry to service_role;

-- Default owner from the JWT so client can't spoof another user_id
alter table public.devices
  alter column user_id set default auth.uid();

-- Recreate clearer, role-scoped policies
drop policy if exists "Users manage own devices" on public.devices;

create policy "devices_select_own"
  on public.devices for select
  to authenticated
  using (auth.uid() = user_id);

create policy "devices_insert_own"
  on public.devices for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "devices_update_own"
  on public.devices for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "devices_delete_own"
  on public.devices for delete
  to authenticated
  using (auth.uid() = user_id);

-- schemas
drop policy if exists "Users manage schemas of own devices" on public.schemas;

create policy "schemas_select_own"
  on public.schemas for select
  to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

create policy "schemas_insert_own"
  on public.schemas for insert
  to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

create policy "schemas_update_own"
  on public.schemas for update
  to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

create policy "schemas_delete_own"
  on public.schemas for delete
  to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );
