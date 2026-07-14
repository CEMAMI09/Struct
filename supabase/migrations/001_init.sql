-- Struct MVP schema
-- Run in your Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

-- ─── devices ─────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  api_key text not null unique,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices(user_id);
create index if not exists devices_api_key_idx on public.devices(api_key);

-- ─── schemas ─────────────────────────────────────────────────────────────────
create table if not exists public.schemas (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade unique,
  schema_definition jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists schemas_device_id_idx on public.schemas(device_id);

-- ─── telemetry ───────────────────────────────────────────────────────────────
create table if not exists public.telemetry (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  parsed_json jsonb not null,
  timestamp timestamptz not null default now()
);

create index if not exists telemetry_device_id_idx on public.telemetry(device_id);
create index if not exists telemetry_timestamp_idx on public.telemetry(timestamp desc);

-- ─── Grants ──────────────────────────────────────────────────────────────────
grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on public.devices to authenticated;
grant select, insert, update, delete on public.schemas to authenticated;
grant select, insert on public.telemetry to authenticated;
grant all on public.devices to service_role;
grant all on public.schemas to service_role;
grant all on public.telemetry to service_role;

alter table public.devices alter column user_id set default auth.uid();

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.devices enable row level security;
alter table public.schemas enable row level security;
alter table public.telemetry enable row level security;

-- devices
create policy "devices_select_own"
  on public.devices for select to authenticated
  using (auth.uid() = user_id);

create policy "devices_insert_own"
  on public.devices for insert to authenticated
  with check (auth.uid() = user_id);

create policy "devices_update_own"
  on public.devices for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "devices_delete_own"
  on public.devices for delete to authenticated
  using (auth.uid() = user_id);

-- schemas (via owning device)
create policy "schemas_select_own"
  on public.schemas for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

create policy "schemas_insert_own"
  on public.schemas for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

create policy "schemas_update_own"
  on public.schemas for update to authenticated
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
  on public.schemas for delete to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = schemas.device_id and d.user_id = auth.uid()
    )
  );

-- telemetry (reads from dashboard; inserts from service role / tcp-server)
create policy "telemetry_select_own"
  on public.telemetry for select to authenticated
  using (
    exists (
      select 1 from public.devices d
      where d.id = telemetry.device_id and d.user_id = auth.uid()
    )
  );

create policy "telemetry_insert_own"
  on public.telemetry for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
      where d.id = telemetry.device_id and d.user_id = auth.uid()
    )
  );

-- ─── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.telemetry;
alter publication supabase_realtime add table public.devices;

-- ─── Helper: generate 16-char API keys ───────────────────────────────────────
create or replace function public.generate_device_api_key()
returns text
language sql
volatile
as $$
  select substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 16);
$$;
