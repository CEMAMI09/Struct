-- Serialize publications per device and atomically create immutable history.
create or replace function public.publish_device_schema(
  p_device_id uuid, p_definition jsonb, p_expected_version integer
)
returns public.schemas
language plpgsql security definer set search_path = public
as $$
declare
  d public.devices%rowtype;
  v_schema public.schemas%rowtype;
  next_version integer;
  f jsonb;
  b jsonb;
  names text[] := '{}';
  labels text[];
  positions integer[];
  total_bytes integer := 0;
begin
  select * into d from public.devices where id = p_device_id for update;
  if not found or not public.is_org_writer(d.organization_id) then raise exception 'Not authorized'; end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'array' or jsonb_array_length(p_definition) = 0 then
    raise exception 'Schema must contain fields';
  end if;
  for f in select value from jsonb_array_elements(p_definition) loop
    if (f->>'name') is null or (f->>'name') !~ '^[A-Za-z_][A-Za-z0-9_]*$'
       or (f->>'name') = any(names) or (f->>'name') in ('__proto__', 'prototype', 'constructor') then
      raise exception 'Invalid or duplicate field name';
    end if;
    names := array_append(names, f->>'name');
    if f->>'type' in ('float32', 'int32') then total_bytes := total_bytes + 4;
    elsif f->>'type' in ('uint8', 'boolean', 'flags') then total_bytes := total_bytes + 1;
    elsif f->>'type' = 'char' then
      if (f->>'length') is null or (f->>'length') !~ '^[0-9]+$' or (f->>'length')::integer not between 1 and 64 then
        raise exception 'char length must be 1..64';
      end if;
      total_bytes := total_bytes + (f->>'length')::integer;
    else raise exception 'Unsupported schema type';
    end if;
    if f->>'type' = 'flags' then
      if f->'bits' is null or jsonb_typeof(f->'bits') <> 'array' or jsonb_array_length(f->'bits') not between 1 and 8 then
        raise exception 'Flags need 1..8 bits';
      end if;
      positions := '{}'; labels := '{}';
      for b in select value from jsonb_array_elements(f->'bits') loop
        if (b->>'bit') is null or (b->>'bit') !~ '^[0-7]$' or (b->>'bit')::integer = any(positions)
           or (b->>'name') is null or (b->>'name') !~ '^[A-Za-z_][A-Za-z0-9_]*$'
           or (b->>'name') = any(labels) or (b->>'name') in ('__proto__', 'prototype', 'constructor') then
          raise exception 'Invalid or duplicate flag';
        end if;
        positions := array_append(positions, (b->>'bit')::integer);
        labels := array_append(labels, b->>'name');
      end loop;
    end if;
  end loop;
  if total_bytes + 66 + (case when d.encryption_enabled then 32 else 0 end) > 1400 then
    raise exception 'Schema exceeds frame limit';
  end if;

  select * into v_schema from public.schemas where device_id = p_device_id for update;
  if p_expected_version is null or coalesce(v_schema.version, 1) <> p_expected_version then
    raise exception 'Schema changed; refresh before publishing';
  end if;
  if v_schema.schema_definition = p_definition then return v_schema; end if;
  next_version := case when v_schema.id is null then 1
    when v_schema.schema_definition = '[]'::jsonb then v_schema.version
    else v_schema.version + 1 end;
  if next_version > 255 then raise exception 'Schema version limit reached'; end if;

  -- Repair legacy split writes, but never overwrite a nonempty published layout.
  if v_schema.id is not null then
    insert into public.schema_versions(device_id, version, schema_definition)
      values(p_device_id, v_schema.version, v_schema.schema_definition)
      on conflict(device_id, version) do nothing;
  end if;
  insert into public.schema_versions(device_id, version, schema_definition)
    values(p_device_id, next_version, p_definition)
    on conflict(device_id, version) do update set schema_definition = excluded.schema_definition
      where schema_versions.schema_definition = '[]'::jsonb;
  if not found then raise exception 'Published schema version already exists'; end if;

  insert into public.schemas(device_id, organization_id, version, schema_definition)
    values(p_device_id, d.organization_id, next_version, p_definition)
    on conflict(device_id) do update set version = excluded.version,
      schema_definition = excluded.schema_definition, updated_at = now()
    returning * into v_schema;
  return v_schema;
end;
$$;
revoke all on function public.publish_device_schema(uuid, jsonb, integer) from public, anon;
grant execute on function public.publish_device_schema(uuid, jsonb, integer) to authenticated;
-- Writers publish through the checked RPC. Device creation remains server-side.
revoke insert, update, delete on public.schema_versions from authenticated;
revoke insert, update, delete on public.schemas from authenticated;

