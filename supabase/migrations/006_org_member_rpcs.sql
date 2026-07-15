-- RPCs to list org members (with email) and invite by email.
-- Requires is_org_member / is_org_writer from 005.

create or replace function public.list_org_members(p_org_id uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  role public.org_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Not a member of this organization';
  end if;

  return query
  select
    m.id,
    m.user_id,
    u.email::text,
    m.role,
    m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org_id
  order by
    case m.role
      when 'owner' then 0
      when 'admin' then 1
      else 2
    end,
    m.created_at;
end;
$$;

create or replace function public.add_org_member_by_email(
  p_org_id uuid,
  p_email text,
  p_role public.org_role default 'viewer'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  member_id uuid;
begin
  if not public.is_org_writer(p_org_id) then
    raise exception 'Only owners and admins can add members';
  end if;

  if p_role = 'owner' and not public.is_org_owner(p_org_id) then
    raise exception 'Only owners can grant the owner role';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if target_id is null then
    raise exception 'No Struct account found for that email — they must sign up first';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_org_id, target_id, p_role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role
  returning organization_members.id into member_id;

  return member_id;
end;
$$;

create or replace function public.update_org_member_role(
  p_member_id uuid,
  p_role public.org_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  target_role public.org_role;
begin
  select organization_id, role into target_org, target_role
  from public.organization_members
  where id = p_member_id;

  if target_org is null then
    raise exception 'Member not found';
  end if;

  if not public.is_org_owner(target_org) then
    raise exception 'Only owners can change roles';
  end if;

  if target_role = 'owner' and p_role <> 'owner' then
    -- Prevent removing the last owner
    if (
      select count(*) from public.organization_members
      where organization_id = target_org and role = 'owner'
    ) <= 1 then
      raise exception 'Cannot demote the last owner';
    end if;
  end if;

  update public.organization_members
  set role = p_role
  where id = p_member_id;
end;
$$;

create or replace function public.remove_org_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  target_user uuid;
  target_role public.org_role;
begin
  select organization_id, user_id, role into target_org, target_user, target_role
  from public.organization_members
  where id = p_member_id;

  if target_org is null then
    raise exception 'Member not found';
  end if;

  if not public.is_org_writer(target_org) then
    raise exception 'Not allowed';
  end if;

  if target_role = 'owner' and not public.is_org_owner(target_org) then
    raise exception 'Only owners can remove an owner';
  end if;

  if target_role = 'owner' then
    if (
      select count(*) from public.organization_members
      where organization_id = target_org and role = 'owner'
    ) <= 1 then
      raise exception 'Cannot remove the last owner';
    end if;
  end if;

  delete from public.organization_members where id = p_member_id;
end;
$$;

grant execute on function public.list_org_members(uuid) to authenticated;
grant execute on function public.add_org_member_by_email(uuid, text, public.org_role) to authenticated;
grant execute on function public.update_org_member_role(uuid, public.org_role) to authenticated;
grant execute on function public.remove_org_member(uuid) to authenticated;
