-- Schema versioning: immutable snapshots so old devices keep parsing
-- after field layout changes (e.g. int32 → float32).
-- Run in Supabase SQL editor after 001–003.

-- Current "editing tip" row tracks the latest published version number
alter table public.schemas
  add column if not exists version smallint not null default 1
    check (version >= 1 and version <= 255);

comment on column public.schemas.version is
  'Latest published schema version (1–255); devices send this as a wire byte';

-- Immutable history — TCP routes by (device_id, version)
create table if not exists public.schema_versions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  version smallint not null check (version >= 1 and version <= 255),
  schema_definition jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (device_id, version)
);

create index if not exists schema_versions_device_id_idx
  on public.schema_versions(device_id);

comment on table public.schema_versions is
  'Immutable packed-struct layouts keyed by wire schema version byte';

-- Backfill existing schemas as version 1
insert into public.schema_versions (device_id, version, schema_definition, created_at)
select
  s.device_id,
  coalesce(nullif(s.version, 0), 1),
  s.schema_definition,
  s.updated_at
from public.schemas s
on conflict (device_id, version) do nothing;

grant select, insert, update, delete on public.schema_versions to authenticated;
grant all on public.schema_versions to service_role;

alter table public.schema_versions enable row level security;

create policy "schema_versions_select_own"
  on public.schema_versions for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id and d.user_id = auth.uid()
    )
  );

create policy "schema_versions_insert_own"
  on public.schema_versions for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id and d.user_id = auth.uid()
    )
  );

create policy "schema_versions_update_own"
  on public.schema_versions for update to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id and d.user_id = auth.uid()
    )
  );

create policy "schema_versions_delete_own"
  on public.schema_versions for delete to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schema_versions.device_id and d.user_id = auth.uid()
    )
  );
