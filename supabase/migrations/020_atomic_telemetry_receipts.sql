-- Apply before deploying the updated gateway. No fallback to non-atomic writes.
alter table public.device_replay_nonces add column if not exists frame_digest bytea
  check (frame_digest is null or octet_length(frame_digest) = 32);

-- The unique nonce insert, telemetry write and presence update share one transaction.
-- Conflicting inserts wait for commit/rollback. Only an identical committed frame
-- can get a duplicate receipt; a failed insert never consumes the nonce.
create or replace function public.ingest_device_telemetry(
  p_device_id uuid, p_nonce bytea, p_frame_timestamp timestamptz,
  p_frame_digest bytea, p_parsed_json jsonb, p_skew_seconds integer default 60
)
returns boolean -- true=newly stored, false=already stored
language plpgsql security definer set search_path = public
as $$
declare
  inserted_count integer;
  previous_digest bytea;
begin
  if p_device_id is null or p_nonce is null or octet_length(p_nonce) <> 12
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

  insert into public.telemetry(device_id, parsed_json) values (p_device_id, p_parsed_json);
  update public.devices set last_seen = now() where id = p_device_id;
  return true;
end;
$$;

revoke all on function public.ingest_device_telemetry(uuid, bytea, timestamptz, bytea, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_device_telemetry(uuid, bytea, timestamptz, bytea, jsonb, integer) to service_role;

-- SECURITY DEFINER functions get PUBLIC EXECUTE by default. A grant to service_role
-- alone does not make a gateway-only function private.
revoke all on function public.reserve_device_nonce(uuid, bytea, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.claim_pending_downlinks(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.acknowledge_pending_command(uuid, uuid, smallint) from public, anon, authenticated;
revoke all on function public.record_org_device_peak(uuid, integer) from public, anon, authenticated;
revoke all on function public.zero_touch_register_device(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.bulk_insert_devices(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.bulk_provision_profile_devices(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;

-- Recover commands whose gateway died after claim, before marking sent.
create or replace function public.claim_pending_downlinks(
  p_device_id uuid, p_gateway_id text, p_limit integer default 8
)
returns setof public.pending_commands
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select pc.id from public.pending_commands pc
    where pc.device_id = p_device_id
      and (pc.status = 'pending' or
        (pc.status in ('claimed', 'sent') and pc.lease_expires_at <= now()))
      and pc.next_attempt_at <= now()
      and (pc.expires_at is null or pc.expires_at > now())
    order by pc.created_at limit least(greatest(p_limit, 1), 64)
    for update skip locked
  )
  update public.pending_commands pc set status = 'claimed', claimed_by = p_gateway_id,
    lease_expires_at = now() + interval '30 seconds', attempt_count = pc.attempt_count + 1
  from candidates c where pc.id = c.id returning pc.*;
end;
$$;
