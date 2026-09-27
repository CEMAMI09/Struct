-- Remove database privileges that bypass row-level security. Application
-- traffic is authenticated; the gateway and billing workers use service_role.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- These records are produced by trusted APIs and database functions. Retain
-- authenticated read access where the dashboard uses it, not direct writes.
revoke all on public.device_event_ids, public.device_replay_nonces,
  public.trace_event_links from authenticated;
revoke insert, update, delete on public.bulk_device_imports,
  public.organization_device_usage_periods, public.packet_traces,
  public.telemetry, public.webhook_attempts, public.webhook_deliveries
  from authenticated;

-- Supabase's broad defaults otherwise reopen access on the next migration.
-- postgres owns this project's app migrations. supabase_admin has separate
-- defaults managed by Supabase and cannot be changed by this role.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- The original personal-device policies predate organization membership.
-- Every live device has an organization and its owner is a member. The member
-- policy preserves tenant-scoped reads; the gateway alone inserts telemetry.
drop policy if exists "Users read telemetry of own devices" on public.telemetry;
drop policy if exists "Users insert telemetry of own devices" on public.telemetry;

-- Evaluate the request user once per statement in this row-level policy.
drop policy if exists "destinations_insert_writer" on public.destinations;
create policy "destinations_insert_writer" on public.destinations
  for insert to authenticated with check (
    public.is_org_writer(organization_id)
    and user_id = (select auth.uid())
    and (device_id is null or exists (
      select 1 from public.devices d
      where d.id = device_id and d.organization_id = destinations.organization_id
    ))
  );

-- A browser-side DELETE must not orphan a Stripe customer or subscription.
-- Free workspaces still support the existing owner-only deletion flow.
drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner" on public.organizations
  for delete to authenticated using (
    public.is_org_owner(id)
    and subscription_tier = 'free'
    and stripe_customer_id is null
    and stripe_subscription_id is null
    and stripe_item_id is null
  );
