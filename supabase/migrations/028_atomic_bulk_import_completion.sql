-- Commit the devices and their import receipt together. A lost HTTP response
-- can then recover credentials from a completed quote without inserting again.
create or replace function public.finalize_bulk_device_import(
  p_import_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_devices jsonb,
  p_expected_current_count integer
)
returns setof public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.bulk_device_imports%rowtype;
  v_device public.devices%rowtype;
  v_created_ids uuid[] := '{}'::uuid[];
  v_device_count integer;
begin
  select * into v_quote
  from public.bulk_device_imports
  where id = p_import_id
    and organization_id = p_org_id
    and user_id = p_user_id
    and status = 'processing'
  for update;
  if not found then
    raise exception 'IMPORT_NOT_PROCESSING' using errcode = 'P0001';
  end if;

  if p_devices is null or jsonb_typeof(p_devices) <> 'array' then
    raise exception 'Invalid import payload' using errcode = '22023';
  end if;
  v_device_count := jsonb_array_length(p_devices);
  if v_device_count = 0 or v_device_count <> jsonb_array_length(v_quote.devices)
     or p_expected_current_count <> v_quote.current_device_count
     or v_quote.projected_device_count <> p_expected_current_count + v_device_count then
    raise exception 'IMPORT_QUOTE_CHANGED' using errcode = 'P0001';
  end if;

  if p_profile_id is null then
    if v_quote.payload_hash like 'profile:%' then
      raise exception 'IMPORT_PROFILE_MISMATCH' using errcode = 'P0001';
    end if;
    for v_device in
      select * from public.bulk_insert_devices(
        p_org_id, p_user_id, p_devices, p_expected_current_count
      )
    loop
      v_created_ids := array_append(v_created_ids, v_device.id);
      return next v_device;
    end loop;
  else
    if v_quote.payload_hash not like ('profile:' || p_profile_id::text || ':%') then
      raise exception 'IMPORT_PROFILE_MISMATCH' using errcode = 'P0001';
    end if;
    for v_device in
      select * from public.bulk_provision_profile_devices(
        p_org_id, p_user_id, p_profile_id, p_devices, p_expected_current_count
      )
    loop
      v_created_ids := array_append(v_created_ids, v_device.id);
      return next v_device;
    end loop;
  end if;

  if cardinality(v_created_ids) <> v_device_count then
    raise exception 'IMPORT_INSERT_COUNT_MISMATCH' using errcode = 'P0001';
  end if;

  update public.bulk_device_imports
  set status = 'completed',
      completed_at = now(),
      created_device_ids = v_created_ids,
      error_message = null
  where id = p_import_id;
  return;
end;
$$;

revoke all on function public.finalize_bulk_device_import(uuid,uuid,uuid,uuid,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.finalize_bulk_device_import(uuid,uuid,uuid,uuid,jsonb,integer)
  to service_role;
