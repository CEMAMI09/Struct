-- Rename studio tier label to scale (safe if 012 already ran with studio).

do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'subscription_tier_enum'
      and e.enumlabel = 'studio'
  ) and not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'subscription_tier_enum'
      and e.enumlabel = 'scale'
  ) then
    alter type public.subscription_tier_enum rename value 'studio' to 'scale';
  end if;
end $$;

drop policy if exists "audit_logs_select_member" on public.audit_logs;
create policy "audit_logs_select_member"
  on public.audit_logs
  for select
  to authenticated
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1
      from public.organizations o
      where o.id = audit_logs.organization_id
        and o.subscription_tier = 'scale'
    )
  );
