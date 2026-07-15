-- Fix: creating an org via PostgREST .insert().select() fails because
-- SELECT RLS requires is_org_member(id), but the membership row is inserted after.
-- Use a SECURITY DEFINER RPC that creates org + owner membership atomically.

create or replace function public.create_organization(p_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  org public.organizations;
  trimmed text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if trimmed is null then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations (name, subscription_tier)
  values (trimmed, 'free')
  returning * into org;

  insert into public.organization_members (organization_id, user_id, role)
  values (org.id, auth.uid(), 'owner');

  return org;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;

-- Ensure insert policy exists (idempotent) for any non-RPC paths / tooling.
drop policy if exists "organizations_insert_authenticated" on public.organizations;
create policy "organizations_insert_authenticated"
  on public.organizations for insert to authenticated
  with check (auth.uid() is not null);

-- Allow creators to SELECT an org that still has no members (brief window / tooling).
drop policy if exists "organizations_select_unclaimed" on public.organizations;
create policy "organizations_select_unclaimed"
  on public.organizations for select to authenticated
  using (
    not exists (
      select 1
      from public.organization_members m
      where m.organization_id = organizations.id
    )
  );
