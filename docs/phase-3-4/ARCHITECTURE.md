# Delivery architecture and recorded evidence

## Transaction and identity

The existing Secure V2 gateway authenticates/decrypts and resolves an immutable schema slot before calling `ingest_secure_v2_telemetry`. The RPC locks the device credential/replay state, returns existing event IDs for authenticated duplicates, and inserts one telemetry row per logical batch reading. Its existing AFTER INSERT trigger now also records metadata in `telemetry_events`, and retains the existing event/destination outbox insertion. All changes commit or roll back together. The gateway constructs its device receipt only after the RPC succeeds. No webhook HTTP request blocks that receipt.

The only ingestion RPC change is persisting the already-resolved schema slot. Wire framing, ChaCha20-Poly1305, nonce/key derivation, sequence and receipt encoding are untouched. Identity remains a database event UUID, with credential-specific wire ID, sequence and record index as Secure V2 correlation. Rotation uses a different wire identity. An existing unique event/destination constraint prevents duplicate logical delivery records.

`accepted_at`/outbox `created_at` record PostgreSQL transaction time, not an exact physical commit timestamp. Batched sample timestamps may precede it. Gateway arrival/auth/decode timings appear only in a real authenticated debug capture; the UI never fabricates them from a stored sample. Captures are limited to five per event detail, existing per-device windows/caps, and their established retention policy.

## Delivery state

| State | Meaning / allowed recovery |
| --- | --- |
| pending | Queued or scheduled retry; worker can claim or operator can cancel |
| sending | Current lease; completion must present its token before lease expiry |
| delivered | HTTP 2xx observed and recorded; explicit replay may queue again |
| dead | Terminal policy/configuration failure; explicit recovery while retained/eligible |
| skipped | Routing mismatch or manual cancel; explicit recovery while eligible |

Ingestion and downstream delivery remain separate dimensions. Authenticated decode rejection is not a committed telemetry event. Unauthenticated claims are not assigned to a customer's device. A missing packet has no invented server-side failure record. Attempts use `dispatching`, classified outcomes and `unknown` on abandoned leases; an attempt claim does not prove the socket sent bytes.

## Claiming and recovery

`claim_webhook_deliveries_v2` first performs bounded expired-lease/policy maintenance. It locks eligible tenant runtime rows with SKIP LOCKED in least-recently-claimed order and destination runtime rows with SKIP LOCKED. It claims up to 32 jobs per call, records each attempt in that transaction, and assigns a fresh UUID lease token valid for 60 seconds. Active claims are limited to eight per tenant and one per destination, with at least 100 ms between destination starts. Process concurrency is independently bounded to 1–64; the deployment template uses eight.

`finish_webhook_delivery_v2` requires the current token, sending state and an unexpired lease. Old workers cannot overwrite a reclaimed outcome. Lease recovery records uncertainty and permits another attempt only within policy. A destination is reloaded before dispatch; disabled/removed/changed-URL/missing-secret destinations fail safely. Pausing holds pending work; a claimed request may race with pause and finish. A retry delays the destination as well as its job to avoid overwhelming a failing endpoint.

Fairness is bounded round robin, not a contractual per-tenant throughput guarantee. Real eight-backend PostgreSQL tests exercise distinct claims, tenant/endpoint ceilings, concurrent ingestion, and idempotent recovery. This is not exhaustive proof against every possible production lock schedule.

## Retry and transport policy

- HTTP 2xx: delivered. HTTP 408/429/500–599: retry. Other responses, including redirects and most 4xx: terminal.
- Timeout, network and DNS errors: retry, with safe categories rather than raw secret-bearing exceptions.
- HTTPS/public-address/request-size violations: terminal configuration failures.
- Eight-second request timeout; eight attempts or 24 hours per automatic cycle, whichever policy ends first.
- Delay: five seconds doubled per attempt, bounded base delay of one hour, plus 0–5 seconds jitter. Retry-After seconds/date is honored up to an hour and only inside the deadline.
- HTTPS only, no URL credentials, all DNS answers validated, exact resolved target used, no redirects, no connection-agent reuse. Private, reserved, metadata and mapped private addresses are blocked.
- Request JSON capped at 1 MiB; response headers capped at 16 KiB; response bodies discarded. No arbitrary response-body storage.

The HMAC-SHA256 signature remains `sha256=<hex>` over the exact raw body. The body is unchanged across retries. `x-struct-event-id`, `x-struct-delivery-id`, and monotonic `x-struct-attempt` assist debugging; headers are not separately signed. Deduplicate the verified body's `id`. Secrets/authorization headers/response bodies/endpoint URLs/lease tokens are not returned by the new customer read RPCs.

The existing signature has no signed request timestamp or key ID. A future v2 signature can add timestamp/key ID alongside the current signature, with a dual-verification migration and explicit freshness policy. That improvement is **not implemented** here and must not silently break existing receivers.

## Manual operations

`delivery_recovery` checks current writer membership, locks the organization for request idempotency/rate accounting, validates every selected row, and then locks rows in ID order. Bulk mutations are atomic and require confirmation. One request UUID schedules at most once; reuse with different inputs fails. Twenty accepted actions/minute/workspace and three manual cycles/delivery bound recovery. The UI retains a request UUID across errors so an ambiguous response can be retried safely.

`delivery_recovery_selection` previews the oldest 100 eligible failed/skipped deliveries across destination/device/event/error/time/attempt/protocol filters and returns the total eligible count. The status filter is intentionally replaced by failed/skipped eligibility. It does not enqueue. The final mutation rechecks eligibility, current destination and payload. Expired, disabled, changed-URL or unauthorized work cannot silently move to another receiver. Replay does not create another telemetry reading. Cancel only applies to pending work. Pause/resume and recovery actions have durable actor/request/time audit records.

## Storage and backpressure

Recovery body copies in existing outbox rows survive normal telemetry retention for seven days. At expiry, pending/sending work becomes `dead/payload_expired`, body becomes null, an active attempt becomes unknown, and recovery is unavailable. Delivery records/attempts, event metadata and action audit are retained for thirty days; workspace deletion still removes its data. No unbounded storage or indefinite delivery guarantee is introduced. Existing historical rows keep their original age and are not automatically resent.

Timestamp checks prevent expired recovery immediately; physical payload/metadata removal occurs in the existing scheduled retention sweep. Operators must verify and monitor that scheduler. A stalled cleanup job can delay removal and consume storage; the migration does not invent a new scheduler.

A transactionally maintained per-tenant queued count and service-controlled cap (default 100,000; permitted range 1–1,000,000) bound pending/sending work once activation is enabled. Crossing it aborts the ingestion transaction, including replay-state changes, and therefore cannot produce a successful receipt. This is an operational ceiling, not a changed plan allowance. It protects backlog, not all historical storage; existing retention and rate limits remain necessary. Policy/retention defaults require product review before public SLAs.

## Reads and monitoring

Member-only RPCs return scoped overview, destination health, keyset-paginated history and event detail. Writer-only RPCs perform mutations. Runtime/settings/worker RPCs are service-only. History fetches 51 safe rows to show 50 plus a next-page indicator. Attempts are bounded to 1,000 and actions to 100 per event detail.

The worker emits startup and 30-second process metrics (claims, classified completions, stale completions, database errors, last successful poll, elapsed request totals, active count, RSS/heap and cumulative CPU). Classification counters are not necessarily final terminal queue counts. The optional loopback health endpoint reports unhealthy if polling has not succeeded within max(30 seconds, three poll intervals). A recent successful poll is not a guarantee every destination is healthy.

The operator `delivery:health` command reads database queue depth, oldest pending, expired leases, dead letters, last-minute attempt/success/retry/unknown counts and latency. PM2 supplies restart history. No remote monitoring SaaS, alerting infrastructure or Phase 5 fleet monitoring is added.
