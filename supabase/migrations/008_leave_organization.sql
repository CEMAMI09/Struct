-- Allow any member to remove themselves from a workspace (leave).
-- Owners/admins can still remove others; last-owner protection remains.

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
  leaving_self boolean;
begin
  select organization_id, user_id, role into target_org, target_user, target_role
  from public.organization_members
  where id = p_member_id;

  if target_org is null then
    raise exception 'Member not found';
  end if;

  leaving_self := (target_user = auth.uid());

  if not leaving_self then
    if not public.is_org_writer(target_org) then
      raise exception 'Not allowed';
    end if;

    if target_role = 'owner' and not public.is_org_owner(target_org) then
      raise exception 'Only owners can remove an owner';
    end if;
  end if;

  if target_role = 'owner' then
    if (
      select count(*) from public.organization_members
      where organization_id = target_org and role = 'owner'
    ) <= 1 then
      raise exception 'Cannot leave or remove the last owner — transfer ownership or delete the workspace';
    end if;
  end if;

  delete from public.organization_members where id = p_member_id;
end;
$$;
