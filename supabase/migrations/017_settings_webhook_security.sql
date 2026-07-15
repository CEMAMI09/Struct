-- Settings: signed webhooks with selectable event types.

alter table public.destinations
  add column if not exists event_types text[] not null default array['telemetry.received']::text[],
  add column if not exists signing_secret text;

update public.destinations
set signing_secret = encode(gen_random_bytes(24), 'hex')
where signing_secret is null;

alter table public.destinations
  alter column signing_secret set default encode(gen_random_bytes(24), 'hex'),
  alter column signing_secret set not null;

alter table public.destinations
  drop constraint if exists destinations_event_types_check;

alter table public.destinations
  add constraint destinations_event_types_check
  check (
    cardinality(event_types) > 0
    and event_types <@ array[
      'telemetry.received',
      'device.connected',
      'device.disconnected'
    ]::text[]
  );

comment on column public.destinations.signing_secret is
  'Hex HMAC-SHA256 secret used to sign the exact request body in x-struct-signature.';

comment on column public.destinations.event_types is
  'Webhook event names subscribed by this destination.';
