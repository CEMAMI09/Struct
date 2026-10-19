-- Separate transaction required before migration 040 uses new enum values.
alter type public.org_role add value if not exists 'developer';
alter type public.org_role add value if not exists 'operator';
