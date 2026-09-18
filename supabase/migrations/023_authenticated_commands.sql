alter table public.pending_commands drop constraint pending_commands_status_check;
alter table public.pending_commands add constraint pending_commands_status_check check(status in
  ('pending','claimed','sent','received','executed','rejected','expired','unknown','acknowledged','failed'));
alter table public.pending_commands alter column expires_at set default now()+interval '1 hour';
update public.pending_commands set expires_at=created_at+interval '1 hour' where expires_at is null;
alter table public.pending_commands alter column expires_at set not null;
create function public.expire_pending_commands() returns void language sql security definer set search_path=public as $$
  update pending_commands set status=case when status='pending' and attempt_count=0 then 'expired' else 'unknown' end,
    lease_expires_at=null,last_error='Expired without definitive execution result'
    where expires_at<=now() and status in ('pending','claimed','sent','received');
$$;
revoke all on function public.expire_pending_commands() from public,anon,authenticated;
grant execute on function public.expire_pending_commands() to service_role;
alter table public.pending_commands add constraint command_payload_bound
  check(packed_hex ~ '^[0-9a-fA-F]+$' and length(packed_hex)%2=0 and length(packed_hex)<=2648) not valid;
-- Clients can enqueue, but cannot manufacture execution outcomes or mutate a
-- command's payload/identity after a device may have received it.
revoke insert,update,delete on public.pending_commands from authenticated;
grant insert(device_id,user_id,command_type,payload,packed_hex) on public.pending_commands to authenticated;

create or replace function public.claim_pending_downlinks(p_device_id uuid,p_gateway_id text,p_limit integer default 8)
returns setof public.pending_commands language plpgsql security definer set search_path=public as $$
begin
  update pending_commands set status=case when status='pending' and attempt_count=0 then 'expired' else 'unknown' end,
    lease_expires_at=null,last_error='Command expired before a definitive execution result'
    where expires_at<=now() and status in ('pending','claimed','sent','received');
  return query with candidates as (
    select id from pending_commands where device_id=p_device_id and expires_at>now()
      and attempt_count<8 and next_attempt_at<=now()
      and (status='pending' or (status in ('claimed','sent','received') and lease_expires_at<=now()))
    order by created_at limit least(greatest(p_limit,1),8) for update skip locked
  ) update pending_commands pc set status='claimed',claimed_by=p_gateway_id,
    lease_expires_at=now()+interval '30 seconds',attempt_count=attempt_count+1
    from candidates c where pc.id=c.id returning pc.*;
  update pending_commands set status='unknown',last_error='Retry limit reached'
    where device_id=p_device_id and attempt_count>=8
      and (lease_expires_at<=now() or (status='pending' and lease_expires_at is null))
      and status in ('pending','claimed','sent','received');
end $$;

create or replace function public.acknowledge_pending_command(p_device_id uuid,p_command_id uuid,p_result_code smallint default 0)
returns boolean language plpgsql security definer set search_path=public as $$
declare target text; changed uuid;
begin
  -- Legacy code 0 is intentionally not interpreted as executed.
  target=case p_result_code when 16 then 'received' when 17 then 'executed'
    when 18 then 'rejected' when 19 then 'expired' when 20 then 'unknown' else null end;
  if target is null then return false; end if;
  update pending_commands set status=target,acknowledged_at=now(),device_result=p_result_code::text,
    lease_expires_at=case when target='received' then now()+interval '30 seconds' else null end
    where device_id=p_device_id and command_id=p_command_id and expires_at>now()
      and status in ('claimed','sent','received') returning id into changed;
  return changed is not null;
end $$;
