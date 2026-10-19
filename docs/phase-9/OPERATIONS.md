# Operations and incident runbooks

## Evidence and service objectives

Gateway, delivery, fleet, observability, enterprise invitation worker and Nuxt web processes can publish private heartbeats every 20 seconds when `STRUCT_ENTERPRISE_ENABLED=true`. At 90 seconds without a sample, their readiness is **unknown**, not healthy. Components can be marked not expected in private `enterprise_service_config`; do this only when intentionally absent. The web reporter starts after the first request. Gateway readiness checks listener initialization; worker readiness uses successful processing/dependency cycles. No public detailed health endpoint is introduced.

The Operations dashboard requires `operations.read`. It displays coarse shared service state and only the selected workspace's delivery/mail backlog and analytics watermark. Shared state contains no hostnames, process command lines, credentials, device identifiers or other tenants' counts. Details stored by private monitoring use an allowlist. Per-minute readiness history is bounded to 30 days. The most recent instance sample determines component state; it does not prove every replica is ready. Observed-minute readiness excludes missing minutes; it must not be described as total uptime. The configurable planned objective is a target only, not an achieved SLA.

Gateway counters are process-local observed attempts, authenticated packets, new commits, duplicates, processing/decode failures and accumulated processing milliseconds. They reset on process restart. A received authenticated datagram does not prove persistence; duplicate packets are separate from new commits. Health database roundtrip time, API request/failure/duration counters, existing delivery health and fleet/analytics watermarks complement these counters. There is no complete Prometheus exporter, external synthetic commit probe, all-replica quorum, public status history or automatic operator paging in this release.

Operator CLI, with private service configuration already injected:

```sh
cd tcp-server
node enterprise/probe.js gateway
node enterprise/probe.js delivery
node enterprise/probe.js web
```

Exit zero means a fresh sampled ready record, not an external network/telemetry SLA. A failed database request, missing sample or stale sample fails closed. Keep this CLI and its service key inside trusted infrastructure. Existing worker-specific health/load tools remain available.

## General incident procedure

1. Record start time in UTC, incident identifier, affected environment/component and evidence boundary. Do not attach secrets, raw environment files or private payloads.
2. Check a private database probe and worker/gateway logs using request UUIDs. Distinguish no observed packets, authentication rejection, database commit failure, queued delivery, external destination failure and delayed analytics.
3. Limit changes to the affected component. Pause a broken destination or bulk job using existing authorized controls; preserve durable queues and attempts. Never "repair" a queue by deleting jobs or resetting replay counters.
4. Apply a reviewed mitigation, verify with isolated test devices/destinations, then inspect recovery/backlog and error rates. A queued retry is not successful delivery.
5. Record timeline, affected tenants only when verified, recovery evidence, remaining gaps and preventive follow-up. Communicate through established authorized support channels. No automatic customer email or contract promise is implied.

## Ingestion unavailable or database degraded

Check UDP/TCP listeners and private dependency health separately from public reachability. An absent packet has no trustworthy rejection evidence. If the database cannot commit, do not issue a successful commit receipt; existing Secure V2 behavior is preserved. Maintain SDK sequence reservations during device retries. Restart only the failing process after inspecting memory/connections; do not restart all workers repeatedly during database failure. Existing bounded workers back off instead of accumulating arbitrary in-memory telemetry. Monitor database errors/latency and queue age after recovery.

## Delivery backlog or integration failure

Use Delivery/Integrations for the affected workspace and destination, inspect attempts and terminal reasons. Healthy ingestion can continue while downstream delivery retries. Review authentication/configuration failures before replaying. Existing fenced leases recover abandoned jobs; an HTTP request accepted remotely before a worker crash may be sent again. Stable event IDs support customer deduplication. Bulk replay needs explicit preview/confirmation; Operator can retry eligible failures but cannot replay successful deliveries or change destinations. Never expose stored endpoint credentials in support output.

## Bulk worker or alert/analytics delay

Inspect existing fleet job progress, lease recovery and per-item errors; confirm current initiating permissions and entitlements before retrying. Avoid bulk credential exports as diagnostics. Analytics/alert workers should resume idempotently; compare authoritative device last-seen with aggregation watermark before declaring missing activity. Notification failure does not erase an incident. A stale worker heartbeat does not prove a physical device is offline.

## Invitation email failure

In Organization, create a link without email or explicitly check email delivery. The enterprise worker uses the existing fixed Resend email transport with a verified sender, request timeout and retry classification. Each job is tied to an invitation version. Leases are 30 seconds, maximum eight claims/24-hour retry age; transient failures use bounded exponential backoff/jitter/Retry-After. Attempt metadata is safe and bounded; completed/terminal jobs erase their encrypted token copy. Recovery after a lost provider response may resend mail using the same provider idempotency key. Provider acceptance does not prove inbox receipt.

Inspect own pending/dead invitation counts in Operations. Correct sender/private configuration, then explicitly resend/replace the invitation from Organization. This invalidates the old token. Disabled email configuration produces a visible terminal result, not a false success. Resend/revocation/acceptance can race with an already in-flight provider request; the server acceptance check still invalidates stale links. Do not log the email body or invitation token. Actual external email delivery is unverified locally.

## Access, keys and suspicious changes

Check current membership and capability before interpreting an access denial. Remove compromised membership, revoke/rotate management keys and private integration credentials through authorized workflows. Device roots require a separate device reprovisioning procedure; human logout does not rotate physical devices. Sign out all sessions revokes Supabase refresh sessions; already issued access tokens may remain valid until expiry ([Supabase sign-out contract](https://supabase.com/docs/guides/auth/signout)). Membership is rechecked independently. SSO, enforced MFA, session inventory and recent-auth step-up are outstanding controls.

Audit search supports actor, action, resource, outcome, reference and UTC interval. Export only the required period and store it securely. Audit append-only enforcement protects normal application operations; investigate infrastructure/database administrator access separately. Rate-limited denied-action logging is not a complete authentication/security-event archive.

## Maintenance and support

Drain/stop the typed worker being upgraded, allow in-flight leases to finish/expire, preserve queue records and deploy backward-compatible functions first. Announce actual maintenance through existing authorized communication processes; no automated public status publisher or maintenance SLA is supplied. Check readiness, test an isolated commit and inspect queue recovery before expanding traffic.

Operations can download a sanitized support context containing workspace UUID, role, timestamp and generated reference. API responses include `X-Struct-Request-ID`. Contact the existing `support@usestruct.com` address and share only necessary identifiers/time ranges; the download excludes credentials, telemetry payloads and endpoint configuration. There is no hidden support login, impersonation endpoint, new ticket system or response-time commitment.
