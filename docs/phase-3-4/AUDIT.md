# Phase 3/4 audit (before implementation)

Audited at parent commit 27be12d, 2026-10-11. No new pipeline migration is applied to production.

## Preserved foundations
- Migration 022 already installs an AFTER INSERT telemetry trigger: event and destination-specific outbox row commit in the same PostgreSQL transaction. Secure V2 receipt construction follows successful RPC completion. An outbox insert failure rolls back telemetry and replay-window changes.
- Secure V2 migration 033 stores UUIDs per logical reading and enforces credential wire ID + sequence + record index uniqueness. Credential rotation creates a different wire identity. Retransmissions return the original event IDs inside the replay window. No device packet expansion is needed.
- Worker uses durable rows, SKIP LOCKED, lease tokens, bounded asynchronous HTTP and crash recovery. Stale reclaimed tokens cannot overwrite newer claims. Downstream delivery can repeat after remote success and before local completion; exactly-once webhooks cannot be promised.
- HTTPS-only dispatch validates literal addresses and every DNS answer, pins the lookup used for connection, and does not follow redirects. Existing HMAC-SHA256 signs the exact raw JSON body. Tenant RLS and writer-only endpoint-secret access are established in migration 026.
- Sampled authenticated traces exist, with trustworthy event correlation after successful authentication. Unauthenticated packet claims must not be customer evidence. Further inspection found the existing persistence guard only checked the device capture window, so a forged device identifier could associate a failed authentication trace with that device. This is corrected in both the gateway persistence guard and migration 035.

## Verified gaps
1. Migration 026 retention deletes ALL aged outbox rows, including pending/sending work. An outage can silently erase accepted delivery intent. No bounded separate recovery window or expired-payload terminal state exists.
2. All HTTP non-2xx and validation errors currently retry indiscriminately. Retry-After, structured HTTP/error/latency fields, maximum retry age and permanent 4xx classification are absent.
3. Attempts are inserted on completion or abandoned-lease recovery, not when claimed. No durable request-start context or structured crash ambiguity exists. Claims have no destination-level global concurrency/pacing or tenant fairness. Fencing does not check lease time at completion.
4. Replay is limited to dead rows, capped three times, but lacks request idempotency, explicit bulk preview/confirmation, action audit detail and cancel/pause semantics.
5. Dashboard selects the newest 100 rows without pagination/filtering/overview/health, and renders only coarse attempt detail. Gateway stage evidence is debug-window-only. A stored sample timestamp can precede commit for a batch; it must not be shown as the commit time.
6. Delivery records have no durable device/schema/batch correlation independent of telemetry retention. Payload copies are intentional for retry durability but need explicit bounded retention.
7. No repository PM2 configuration was found; worker is started by `npm --prefix tcp-server run start:worker`. Existing deployment processes must not be assumed or modified.
8. Connection/disconnection webhooks are separate best-effort dispatch, outside telemetry commit/outbox guarantees. Do not silently advertise durable delivery for them.

## Design constraints
Extend the existing tables and trigger, retain legacy RPC compatibility, add opt-in versioned worker RPCs with explicit preflight, and keep production wire/SDK code unchanged. Separate ingestion facts from downstream status. New delivery history records database enqueue time, not invented packet-arrival timestamps. Preserve signed body bytes across retries and stable event/delivery IDs. Pausing must retain work; disabling/removing a destination is terminal. Bound automatic retries to eight attempts/24 hours, retain recovery payload for seven days independent of telemetry plan retention, retain metadata/attempts for thirty days. These internal safety windows are not new subscription benefits and need product review before a production reliability SLA.
