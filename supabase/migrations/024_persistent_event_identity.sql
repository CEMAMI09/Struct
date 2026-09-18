-- v4 event IDs survive fresh transmission timestamps/nonces across device restarts.
-- Keep IDs for device lifetime; deleting them permits old events to be reinserted.
create table public.device_event_ids (
  device_id uuid not null references public.devices(id) on delete cascade,
  event_id bytea not null check(octet_length(event_id)=16),
  digest bytea not null check(octet_length(digest)=32),
  primary key(device_id,event_id)
);
alter table public.device_event_ids enable row level security;
grant all on public.device_event_ids to service_role;
create or replace function public.ingest_queued_telemetry(
  p_device_id uuid, p_nonce bytea, p_frame_timestamp timestamptz,
  p_frame_digest bytea, p_parsed_json jsonb, p_event_id bytea, p_event_digest bytea, p_skew_seconds integer default 60
)
returns boolean -- true=newly stored, false=already stored
language plpgsql security definer set search_path = public
as $$
declare
  inserted_count integer;
  previous_digest bytea;
begin
  if p_event_id is null or octet_length(p_event_id) <> 16 or p_event_digest is null or octet_length(p_event_digest) <> 32 or p_device_id is null or p_nonce is null or octet_length(p_nonce) <> 12
     or p_frame_digest is null or octet_length(p_frame_digest) <> 32
     or p_frame_timestamp is null or p_skew_seconds is null
     or p_skew_seconds < 1 or p_skew_seconds > 3600
     or p_parsed_json is null or jsonb_typeof(p_parsed_json) <> 'object' then
    raise exception 'INVALID_TELEMETRY';
  end if;
  if abs(extract(epoch from (now() - p_frame_timestamp))) > p_skew_seconds then
    raise exception 'REPLAY_TIMESTAMP_SKEW';
  end if;

  insert into public.device_replay_nonces
    (device_id, nonce, frame_timestamp, expires_at, frame_digest)
  values (p_device_id, p_nonce, p_frame_timestamp,
    p_frame_timestamp + make_interval(secs => p_skew_seconds), p_frame_digest)
  on conflict (device_id, nonce) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select frame_digest into previous_digest from public.device_replay_nonces
      where device_id = p_device_id and nonce = p_nonce;
    if previous_digest is distinct from p_frame_digest then
      raise exception 'REPLAY_NONCE_CONFLICT';
    end if;
    return false;
  end if;

  insert into public.device_event_ids(device_id,event_id,digest) values(p_device_id,p_event_id,p_event_digest)
    on conflict(device_id,event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then
    select digest into previous_digest from public.device_event_ids where device_id=p_device_id and event_id=p_event_id;
    if previous_digest is distinct from p_event_digest then raise exception 'EVENT_ID_CONFLICT'; end if;
    return false;
  end if;
  insert into public.telemetry(device_id, parsed_json) values (p_device_id, p_parsed_json);
  update public.devices set last_seen = now() where id = p_device_id;
  return true;
end;
$$;

revoke all on function public.ingest_queued_telemetry(uuid, bytea, timestamptz, bytea, jsonb, bytea, bytea, integer) from public, anon, authenticated;
grant execute on function public.ingest_queued_telemetry(uuid, bytea, timestamptz, bytea, jsonb, bytea, bytea, integer) to service_role;

