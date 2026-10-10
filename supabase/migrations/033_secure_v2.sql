-- Additive Secure V2. Legacy credentials, schemas and ingest RPCs are unchanged.
-- Apply before enabling STRUCT_SECURE_V2_ENABLED on web/gateway deployments.
create sequence public.secure_v2_wire_id_seq as bigint minvalue 1 maxvalue 4294967295 no cycle;
revoke all on sequence public.secure_v2_wire_id_seq from public, anon, authenticated;
grant usage, select on sequence public.secure_v2_wire_id_seq to service_role;

alter table public.devices
  add column secure_v2_enabled boolean not null default false,
  add column wire_device_id bigint check (wire_device_id between 1 and 4294967295);
create unique index devices_secure_v2_wire_id on public.devices(wire_device_id) where wire_device_id is not null;
grant select (secure_v2_enabled, wire_device_id) on public.devices to authenticated;

create table public.secure_v2_credentials (
  wire_device_id bigint primary key default nextval('public.secure_v2_wire_id_seq')
    check (wire_device_id between 1 and 4294967295),
  device_id uuid not null references public.devices(id) on delete cascade,
  root_secret_encrypted text not null check (root_secret_encrypted like 'v1:%'),
  secret_preview text not null,
  bootstrap_token_encrypted text not null check (bootstrap_token_encrypted like 'v1:%'),
  bootstrap_token_hash bytea not null check (octet_length(bootstrap_token_hash) = 32),
  bootstrap_consumed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index secure_v2_credentials_device on public.secure_v2_credentials(device_id);
alter table public.secure_v2_credentials enable row level security;
revoke all on public.secure_v2_credentials from public, anon, authenticated;
grant all on public.secure_v2_credentials to service_role;

create table public.secure_v2_schema_slots (
  device_id uuid not null references public.devices(id) on delete cascade,
  slot integer not null check (slot between 0 and 15),
  encoding text not null check (encoding in ('legacy-le-v1', 'bitpacked-v1')),
  schema_definition jsonb not null check (jsonb_typeof(schema_definition) = 'array'
    and jsonb_array_length(schema_definition) between 1 and 128),
  record_bytes integer not null check (record_bytes between 1 and 1175),
  legacy_schema_version integer check (legacy_schema_version between 1 and 255),
  sample_interval_ms integer check (sample_interval_ms between 1 and 604800000),
  created_at timestamptz not null default now(),
  primary key (device_id, slot)
);
alter table public.secure_v2_schema_slots enable row level security;
revoke all on public.secure_v2_schema_slots from public, anon, authenticated;
grant select on public.secure_v2_schema_slots to authenticated;
grant select, insert on public.secure_v2_schema_slots to service_role;
create policy secure_v2_schema_read on public.secure_v2_schema_slots for select to authenticated
  using (exists (select 1 from public.devices d where d.id = device_id and public.is_org_member(d.organization_id)));

create table public.secure_v2_replay_state (
  wire_device_id bigint primary key references public.secure_v2_credentials(wire_device_id) on delete cascade,
  highest_sequence bigint check (highest_sequence between 0 and 4294967295),
  recent_bitmap bit(64) not null default B'0'::bit(64),
  updated_at timestamptz not null default now()
);
create table public.secure_v2_packets (
  wire_device_id bigint not null references public.secure_v2_credentials(wire_device_id) on delete cascade,
  sequence bigint not null check (sequence between 0 and 4294967295),
  frame_digest bytea not null check (octet_length(frame_digest) = 32),
  event_ids uuid[] not null,
  primary key (wire_device_id, sequence)
);
alter table public.secure_v2_replay_state enable row level security;
alter table public.secure_v2_packets enable row level security;
revoke all on public.secure_v2_replay_state, public.secure_v2_packets from public, anon, authenticated;
grant all on public.secure_v2_replay_state, public.secure_v2_packets to service_role;

alter table public.telemetry
  add column secure_v2_wire_device_id bigint,
  add column secure_v2_sequence bigint,
  add column secure_v2_record_index integer;
alter table public.telemetry add constraint telemetry_secure_v2_identity check (
  (secure_v2_wire_device_id is null and secure_v2_sequence is null and secure_v2_record_index is null)
  or (secure_v2_wire_device_id is not null and secure_v2_sequence is not null and secure_v2_record_index is not null
      and secure_v2_wire_device_id between 1 and 4294967295
      and secure_v2_sequence between 0 and 4294967295
      and secure_v2_record_index between 0 and 254)
);
create unique index telemetry_secure_v2_once on public.telemetry
  (secure_v2_wire_device_id, secure_v2_sequence, secure_v2_record_index)
  where secure_v2_wire_device_id is not null;

create function public.enroll_device_secure_v2(
  p_device_id uuid, p_org_id uuid, p_root_secret_encrypted text, p_secret_preview text,
  p_bootstrap_token_encrypted text, p_bootstrap_token_hash bytea,
  p_rotate boolean default false, p_grace_seconds integer default 0
) returns public.secure_v2_credentials
language plpgsql security definer set search_path = public as $$
declare d public.devices; credential public.secure_v2_credentials;
begin
  if p_grace_seconds is null or p_grace_seconds not between 0 and 86400
    or p_root_secret_encrypted is null or p_root_secret_encrypted not like 'v1:%'
    or p_bootstrap_token_encrypted is null or p_bootstrap_token_encrypted not like 'v1:%'
    or p_bootstrap_token_hash is null or octet_length(p_bootstrap_token_hash) <> 32
    or p_secret_preview is null or length(p_secret_preview) <> 4 then
    raise exception 'INVALID_SECURE_V2_CREDENTIAL';
  end if;
  select * into d from public.devices where id = p_device_id and organization_id = p_org_id for update;
  if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
  if d.secure_v2_enabled and not p_rotate then raise exception 'SECURE_V2_ALREADY_ENROLLED'; end if;
  if not d.secure_v2_enabled and p_rotate then raise exception 'SECURE_V2_NOT_ENROLLED'; end if;
  -- Device-first lock order matches ingestion, avoiding rotation/store deadlocks.
  update public.secure_v2_credentials set
    expires_at = least(coalesce(expires_at, 'infinity'::timestamptz), now() + make_interval(secs => p_grace_seconds)),
    revoked_at = case when p_grace_seconds = 0 then coalesce(revoked_at, now()) else revoked_at end
    where device_id = d.id;
  insert into public.secure_v2_credentials
    (device_id, root_secret_encrypted, secret_preview, bootstrap_token_encrypted, bootstrap_token_hash)
    values (d.id, p_root_secret_encrypted, p_secret_preview, p_bootstrap_token_encrypted, p_bootstrap_token_hash)
    returning * into credential;
  insert into public.secure_v2_replay_state(wire_device_id) values(credential.wire_device_id);
  update public.devices set secure_v2_enabled = true, wire_device_id = credential.wire_device_id where id = d.id;
  return credential;
end $$;

create function public.bootstrap_secure_v2_counter(p_wire_device_id bigint, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = public as $$
declare credential public.secure_v2_credentials;
begin
  -- One use only. Lost HTTP/NVS outcome requires rotation, never counter guessing.
  perform 1 from public.devices d join public.secure_v2_credentials c on c.device_id = d.id
    where c.wire_device_id = p_wire_device_id and d.secure_v2_enabled for update of d;
  if not found then raise exception 'INVALID_PROVISIONING_REQUEST'; end if;
  -- Counter initialization is only valid before this keyspace has been used.
  if exists (select 1 from public.secure_v2_replay_state where wire_device_id = p_wire_device_id
    and highest_sequence is not null) then raise exception 'INVALID_PROVISIONING_REQUEST'; end if;
  update public.secure_v2_credentials set bootstrap_consumed_at = now()
    where wire_device_id = p_wire_device_id and bootstrap_token_hash = p_token_hash
      and bootstrap_consumed_at is null and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning * into credential;
  if not found then raise exception 'INVALID_PROVISIONING_REQUEST'; end if;
  return jsonb_build_object('nextSequence', 0);
end $$;

create function public.publish_secure_v2_schema_slot(
  p_device_id uuid, p_org_id uuid, p_slot integer, p_encoding text, p_definition jsonb,
  p_record_bytes integer, p_legacy_schema_version integer default null, p_sample_interval_ms integer default null
) returns public.secure_v2_schema_slots
language plpgsql security definer set search_path = public as $$
declare d public.devices; published public.secure_v2_schema_slots;
begin
  select * into d from public.devices where id = p_device_id and organization_id = p_org_id for update;
  if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
  if not d.secure_v2_enabled then raise exception 'SECURE_V2_NOT_ENROLLED'; end if;
  if p_slot is null or p_slot not between 0 and 15 or p_encoding is null
    or p_encoding not in ('legacy-le-v1', 'bitpacked-v1') or p_definition is null
    or jsonb_typeof(p_definition) <> 'array' or jsonb_array_length(p_definition) not between 1 and 128
    or p_record_bytes is null or p_record_bytes not between 1 and 1175 then
    raise exception 'INVALID_SECURE_V2_SCHEMA';
  end if;
  if p_legacy_schema_version is not null and (p_encoding <> 'legacy-le-v1' or not exists (
    select 1 from public.schema_versions where device_id = d.id and version = p_legacy_schema_version
      and schema_definition = p_definition
  )) then raise exception 'LEGACY_SCHEMA_MISMATCH'; end if;
  select * into published from public.secure_v2_schema_slots where device_id = d.id and slot = p_slot;
  if found then
    if published.encoding = p_encoding and published.schema_definition = p_definition
      and published.record_bytes = p_record_bytes
      and published.legacy_schema_version is not distinct from p_legacy_schema_version
      and published.sample_interval_ms is not distinct from p_sample_interval_ms then return published; end if;
    raise exception 'SCHEMA_SLOT_ALREADY_ASSIGNED';
  end if;
  insert into public.secure_v2_schema_slots
    (device_id, slot, encoding, schema_definition, record_bytes, legacy_schema_version, sample_interval_ms)
    values(d.id, p_slot, p_encoding, p_definition, p_record_bytes, p_legacy_schema_version, p_sample_interval_ms)
    returning * into published;
  return published;
end $$;

create function public.ingest_secure_v2_telemetry(
  p_wire_device_id bigint, p_sequence bigint, p_frame_digest bytea, p_schema_slot integer, p_records jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  credential public.secure_v2_credentials; state public.secure_v2_replay_state;
  slot_definition public.secure_v2_schema_slots; packet public.secure_v2_packets;
  target_device uuid; shift_by bigint; bit_mask bit(64); bitmap bit(64); decision text;
  record jsonb; event_uuid uuid; events uuid[] := '{}'; record_index integer := 0; record_count integer;
begin
  if p_wire_device_id is null or p_sequence is null or p_sequence not between 0 and 4294967295
    or p_frame_digest is null or octet_length(p_frame_digest) <> 32
    or p_schema_slot is null or p_schema_slot not between 0 and 15
    or p_records is null or jsonb_typeof(p_records) <> 'array'
    or jsonb_array_length(p_records) not between 1 and 255 or octet_length(p_records::text) > 262144 then
    raise exception 'INVALID_SECURE_V2_TELEMETRY';
  end if;
  select device_id into target_device from public.secure_v2_credentials where wire_device_id = p_wire_device_id;
  if target_device is null then raise exception 'INVALID_SECURE_V2_CREDENTIAL'; end if;
  perform 1 from public.devices where id = target_device and secure_v2_enabled for update;
  if not found then raise exception 'INVALID_SECURE_V2_CREDENTIAL'; end if;
  select * into credential from public.secure_v2_credentials where wire_device_id = p_wire_device_id for update;
  if not found or credential.revoked_at is not null or (credential.expires_at is not null and credential.expires_at <= now()) then
    raise exception 'INVALID_SECURE_V2_CREDENTIAL';
  end if;
  select * into slot_definition from public.secure_v2_schema_slots where device_id = target_device and slot = p_schema_slot;
  if not found then raise exception 'UNKNOWN_SECURE_V2_SCHEMA_SLOT'; end if;
  for record in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(record) <> 'object' then raise exception 'INVALID_SECURE_V2_TELEMETRY'; end if;
  end loop;
  select * into state from public.secure_v2_replay_state where wire_device_id = p_wire_device_id for update;
  if not found then raise exception 'SECURE_V2_REPLAY_STATE_MISSING'; end if;
  bitmap := state.recent_bitmap;
  if state.highest_sequence is null then
    state.highest_sequence := p_sequence; bitmap := 1::bigint::bit(64); decision := 'new';
  elsif p_sequence > state.highest_sequence then
    shift_by := p_sequence - state.highest_sequence;
    bitmap := case when shift_by >= 64 then B'0'::bit(64) else bitmap << shift_by::integer end;
    bitmap := bitmap | 1::bigint::bit(64); state.highest_sequence := p_sequence; decision := 'new';
  else
    shift_by := state.highest_sequence - p_sequence;
    if shift_by >= 64 then raise exception 'SECURE_V2_STALE_REPLAY'; end if;
    bit_mask := 1::bigint::bit(64) << shift_by::integer;
    if (bitmap & bit_mask) <> B'0'::bit(64) then
      select * into packet from public.secure_v2_packets where wire_device_id = p_wire_device_id and sequence = p_sequence;
      if not found or packet.frame_digest is distinct from p_frame_digest then raise exception 'SECURE_V2_SEQUENCE_CONFLICT'; end if;
      return jsonb_build_object('inserted', false, 'duplicate', true, 'event_ids', packet.event_ids, 'replay', 'duplicate');
    end if;
    bitmap := bitmap | bit_mask; decision := 'out_of_order';
  end if;
  update public.secure_v2_replay_state set highest_sequence = state.highest_sequence,
    recent_bitmap = bitmap, updated_at = now() where wire_device_id = p_wire_device_id;
  record_count := jsonb_array_length(p_records);
  for record in select value from jsonb_array_elements(p_records) loop
    insert into public.telemetry(device_id, parsed_json, timestamp,
      secure_v2_wire_device_id, secure_v2_sequence, secure_v2_record_index)
      values (target_device, record,
        now() - make_interval(secs => coalesce(slot_definition.sample_interval_ms, 0)::double precision
          * (record_count - 1 - record_index) / 1000.0),
        p_wire_device_id, p_sequence, record_index)
      returning id into event_uuid;
    events := array_append(events, event_uuid); record_index := record_index + 1;
  end loop;
  insert into public.secure_v2_packets(wire_device_id, sequence, frame_digest, event_ids)
    values(p_wire_device_id, p_sequence, p_frame_digest, events);
  -- High water is permanent; compact only digests already outside the replay
  -- window. Old packets remain unconditionally stale after telemetry retention.
  delete from public.secure_v2_packets where wire_device_id = p_wire_device_id
    and sequence < state.highest_sequence - 63;
  update public.devices set last_seen = now() where id = target_device;
  return jsonb_build_object('inserted', true, 'duplicate', false, 'event_ids', events, 'replay', decision);
end $$;

revoke all on function public.enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer),
  public.bootstrap_secure_v2_counter(bigint,bytea),
  public.publish_secure_v2_schema_slot(uuid,uuid,integer,text,jsonb,integer,integer,integer),
  public.ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.enroll_device_secure_v2(uuid,uuid,text,text,text,bytea,boolean,integer),
  public.bootstrap_secure_v2_counter(bigint,bytea),
  public.publish_secure_v2_schema_slot(uuid,uuid,integer,text,jsonb,integer,integer,integer),
  public.ingest_secure_v2_telemetry(bigint,bigint,bytea,integer,jsonb) to service_role;
