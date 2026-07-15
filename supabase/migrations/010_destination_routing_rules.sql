-- Optional logical routing for webhook destinations.
-- NULL preserves the existing behavior: every payload matching the device scope is sent.
alter table public.destinations
  add column if not exists routing_rule jsonb;

comment on column public.destinations.routing_rule is
  'Optional payload rule: {"key":"temperature","operator":">","value":100}. NULL sends every payload.';
