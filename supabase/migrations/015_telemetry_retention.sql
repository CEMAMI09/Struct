-- Tier-based telemetry retention:
--   free       1 day
--   flexible   7 days
--   pro/scale 30 days

create or replace function public.telemetry_retention_days(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case o.subscription_tier::text
    when 'scale' then 30
    when 'pro' then 30
    when 'flexible' then 7
    else 1
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

grant execute on function public.telemetry_retention_days(uuid)
  to authenticated, service_role;

create or replace function public.purge_expired_telemetry()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.telemetry t
  using public.devices d, public.organizations o
  where t.device_id = d.id
    and d.organization_id = o.id
    and t.timestamp < now() - make_interval(
      days => case o.subscription_tier::text
        when 'scale' then 30
        when 'pro' then 30
        when 'flexible' then 7
        else 1
      end
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_telemetry() from public, anon, authenticated;
grant execute on function public.purge_expired_telemetry() to service_role;

-- Supabase supports pg_cron; run retention cleanup at 15 minutes past each hour.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'purge-expired-telemetry'
   limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'purge-expired-telemetry',
    '15 * * * *',
    'select public.purge_expired_telemetry();'
  );
end;
$$;
