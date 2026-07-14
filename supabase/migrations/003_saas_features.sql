-- Destinations, fleet tags, edge encryption, downlinks
-- Run in Supabase SQL editor after 001 + 002

-- ─── devices: tags + ChaCha20 encryption ─────────────────────────────────────
alter table public.devices
  add column if not exists tags jsonb not null default '{}'::jsonb;

alter table public.devices
  add column if not exists encryption_enabled boolean not null default false;

alter table public.devices
  add column if not exists encryption_key text;

comment on column public.devices.tags is
  'Fleet tags as key→value map, e.g. {"Location":"Chicago_Factory","Version":"v1.0.4"}';

comment on column public.devices.encryption_key is
  '32-byte ChaCha20 key as 64 hex chars (shown once in Schema Builder)';

-- ─── destinations (webhooks) ─────────────────────────────────────────────────
create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  device_id uuid references public.devices(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists destinations_user_id_idx on public.destinations(user_id);
create index if not exists destinations_device_id_idx on public.destinations(device_id);

comment on column public.destinations.device_id is
  'NULL = fire for every device owned by this user; else only that device';

-- ─── pending_commands (downlinks) ────────────────────────────────────────────
create table if not exists public.pending_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null default 'custom',
  payload jsonb not null default '{}'::jsonb,
  packed_hex text not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists pending_commands_device_pending_idx
  on public.pending_commands(device_id, created_at)
  where status = 'pending';

-- ─── Grants ──────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.destinations to authenticated;
grant select, insert, update, delete on public.pending_commands to authenticated;
grant all on public.destinations to service_role;
grant all on public.pending_commands to service_role;

alter table public.destinations alter column user_id set default auth.uid();
alter table public.pending_commands alter column user_id set default auth.uid();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.destinations enable row level security;
alter table public.pending_commands enable row level security;

create policy "destinations_select_own"
  on public.destinations for select to authenticated
  using (auth.uid() = user_id);

create policy "destinations_insert_own"
  on public.destinations for insert to authenticated
  with check (auth.uid() = user_id);

create policy "destinations_update_own"
  on public.destinations for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "destinations_delete_own"
  on public.destinations for delete to authenticated
  using (auth.uid() = user_id);

create policy "pending_commands_select_own"
  on public.pending_commands for select to authenticated
  using (auth.uid() = user_id);

create policy "pending_commands_insert_own"
  on public.pending_commands for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.devices d
      where d.id = pending_commands.device_id and d.user_id = auth.uid()
    )
  );

create policy "pending_commands_update_own"
  on public.pending_commands for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "pending_commands_delete_own"
  on public.pending_commands for delete to authenticated
  using (auth.uid() = user_id);

-- Realtime so tcp-server / dashboard can react to new downlinks
alter publication supabase_realtime add table public.pending_commands;
