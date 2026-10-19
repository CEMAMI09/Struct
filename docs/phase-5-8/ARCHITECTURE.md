# Monitoring and analytics architecture

## Evidence and ingestion

Secure V2 framing, device keys, immutable schema slots, replay rules and authenticated commit receipts are unchanged. With the explicit flag enabled, the gateway calls `ingest_secure_v2_observed`, which calls the original five-argument ingestion RPC inside the same transaction. Stable packet identity uses the existing credential epoch and sequence. Committed batches contribute their actual logical-reading count once. Duplicates contribute observed traffic separately, never another committed reading.

Successful ingestion updates `devices.last_monitored_commit_at` and schema slot. Migration backfill uses only retained `telemetry_events` evidence, never an inference from an empty telemetry table or legacy `last_seen`. This durable timestamp survives telemetry retention. Unknown historic activity remains unavailable rather than falsely becoming never-connected.

Actual frame length, sensor bytes, 9-byte V2 header (plus the batch count where applicable), 16-byte AEAD tag and observed IP family are captured by the existing processor. These are not universal fixed sample sizes. Real codecs account for Float64, exact wide integers, UTF-8 and binary fields. A nested optional instrumentation failure does not undo valid telemetry or issue a false failure receipt; it records a coverage gap when possible. Failure of the commit itself still prevents a committed receipt. The recorded gateway processing duration ends before the SQL call; it is not commit latency. There is no external analytics/notification request in the critical path.

The post-authentication observation collector buffers at most 5,000 observations plus a bounded retry batch. It captures the original observation timestamp before buffering and submits up to 100 rows with stable UUIDs/timestamps, at one-second intervals and bounded retries. Duplicate/rejected traffic and successful receipt-socket submissions are best effort: crashes, overload or a prolonged database outage can lose these observations. Operator counters expose drops and errors. No trustworthy tenant is assigned from an unauthenticated claimed device ID. Those errors remain gateway-level aggregate diagnostics. A successful UDP send callback proves socket submission, not device receipt.

## Aggregation and boundaries

`metric_events` is the durable work source. `aggregate_metric_events` locks pending rows with SKIP LOCKED, obtains nonblocking organization advisory locks, groups one batch into minute/hour/day dimensions and upserts grouped sums. It marks the exact source rows processed in the same transaction. A crash rolls back both effects; restart does not double count. Group/tag membership and schema/IP dimensions are snapshots. Multiple group memberships overlap; group totals cannot be added to infer a fleet total.

PostgreSQL bigint counters leave APIs as decimal strings and are added using BigInt. Ratios and chart heights are display approximations with exact accessible values. Alert numeric thresholds/values, including decoded integer wrappers, also leave SQL as strings. UTC is used for collection and buckets; the selected IANA time zone affects labels. Hourly health records retain their real capture timestamp, not a claim that all devices were continuously observed throughout the hour.

Application uplink is directly observed. Minimum UDP/IP additions are specification-calculated: 28 bytes IPv4 or 48 bytes IPv6 per known datagram, with receipt additions separate. These exclude fragmentation, IP extensions, radio/link overhead, DNS, handshakes, modem signaling and carrier billing increments. Gateway processing supports IPv6 metadata and tests cover it, but the existing production UDP listener remains udp4. TCP/legacy wire accounting and HTTP/TLS downstream wire-byte totals are unavailable. Delivery attempts supply outcomes and latency evidence, not invented full-network byte measurements.

The API returns only existing buckets, at most a 366-day query range, bounded rankings and paginated inventory/incidents. It does not scan raw telemetry for routine charts or connect absent buckets with fabricated measurements. Known collection failures/expired backlog have gap markers. The capture start, plan retention, pending backlog and unknown historic bytes govern projection eligibility. Best-effort attempt loss can still be unknowable; totals never claim carrier completeness.

Backfill is an explicit authorized, cursor-bounded reading-only operation. It cannot reconstruct lost packet metadata or past membership. `metric_identity` keeps historical backfill idempotent after processed raw metadata is removed. No automatic historical forwarding or production backfill occurs.

## Health and rules

Workspace defaults and device overrides distinguish scheduled, event-driven and no-expectation reporting. Scheduled inactivity uses last successful monitored commit plus interval and grace; missing reports are detected without new ingestion. Disabled/revoked devices are distinct and excluded from normal scheduled-health alarms. Never-connected registration age has a separate condition. Maintenance and mute intervals suppress disruption. The pre-existing Devices badge still uses its earlier activity heuristic; the new Monitoring page is the authoritative policy-based view for this release.

Rules are declarative, bounded and disabled by default. Supported conditions are inactivity count, never-connected count, readings/window, observed application bytes/window, average packet size, attributable rejection percentage, downstream failure percentage, dead-letter backlog, oldest queue age and a scalar sensor threshold. Scope by device/group/tag. Sensor rules require one explicit device and fresh numeric JSON or an exact integer wrapper. Boolean/string/nested predicates and relative statistical anomaly detection are not implemented.

The evaluator processes up to 20 eligible rules/cycle with a 30-second minimum reevaluation interval. Holds reflect repeated evaluator observations, not continuous physical sensing. Trigger/clear thresholds implement hysteresis; reopen cooldown prevents rapid incident churn. No evidence is unavailable, not a fabricated zero. At most 100 active rules and 100 new incidents/hour/workspace are allowed. Evaluation timestamps/errors expose delay or caps.

Incidents have open, acknowledged, suppressed and resolved states. A partial unique constraint permits one active incident/rule; row locks prevent competing evaluators from opening duplicates. Acknowledgment does not resolve. Recovery resolves automatically; manual resolution can reopen after cooldown. Rule definitions have optimistic versions and idempotent request hashes; active incidents must be resolved before definition edits. History preserves actual transitions and rule snapshots.

## Notifications

Incidents are dashboard notifications and exist independently of external delivery. Transition rows also hold durable notification scheduling intents. Temporary enqueue failure is isolated from incident creation; bounded retries preserve the original incident/destination snapshot. Up to eight scheduling attempts/24 hours are supported. URL snapshots are hashes, not public URLs/credentials; private notification configuration is omitted from API responses and authenticated SELECT grants. An edited URL cannot silently redirect an older notification.

Webhook alerts reuse existing signed `webhook_deliveries`, leases, attempts, retries and dead-letter handling. They carry `alert.opened` / `alert.resolved`, not fake telemetry ingestion evidence. Existing consumer signing is preserved. Alert deliveries are excluded from telemetry delivery-failure evaluation to avoid notification loops. Use incident ID plus event type for downstream deduplication.

Email is opt-in to the current verified member account address, with severity preferences and current membership rechecked at claim time. It uses a small fenced 30-second lease queue because the existing webhook claimant requires a destination; retry classification is shared. The fixed Resend HTTPS endpoint has an eight-second timeout, redirects disabled and stable idempotency key. HTTP acceptance is not proof of mailbox delivery. No response bodies, keys or device credentials are stored. Email retries are bounded to eight attempts/24 hours with backoff/jitter and Retry-After. A crash after acceptance can still produce a retry; universal exactly-once delivery is not promised.

Transport scheduling is capped at 100 new jobs/hour/workspace and 20 email recipients/transition. Failures and pending intents are visible; they never erase the incident. Live Resend/provider delivery has not been qualified in this environment.

## Costs and efficiency

The optional cost model requires an explicit decimal-MB price, selected observation boundary, billing days, cellular fraction and applicable allowance/minimum/rounding. Saved preferences are tenant-scoped. An explicit carrier override already represents cellular bytes. Missing baseline yields no savings claim. Flat-rate usage reductions do not imply bill reductions. Negative savings appear as additional estimated cost. Exact integer arithmetic preserves large counters and nonzero sub-cent estimates.

A device's latest retained sample can be encoded using its immutable real codec. Verified batch limits produce hypothetical alternatives with buffering/latency/RAM/MTU/loss tradeoffs. A lossless packed candidate is actually encoded and round-trip checked; zero savings are preserved. No lossy bounds or precision are inferred. Applying any candidate requires safe new schema publication and firmware/SDK work outside this feature.

Protocol Lab comparisons reuse the existing calculation engine and provenance for a single sampled reading. They disclose precision, security, delivery and measurement boundary differences. They are not a fleet distribution, measured competitor fleet traffic or an automatically established ROI baseline.

## Security, operations and retention

APIs require a verified session and organization membership; owner/admin permissions apply to shared changes, while members may manage their own email preference. RLS and service-only RPCs provide an additional boundary. No endpoint returns device credentials. Filters, body sizes, date windows, row counts and per-process request rates are bounded; distributed edge abuse controls remain a deployment responsibility. Cloud destinations remain managed by the established integration security layer.

Processed metric details retain at most one day; unprocessed observations at most seven days, with gap markers before expiry. Deduplication identities/gaps retain 31 days. Rollups follow existing plan retention (1/7/30 days); minute detail is capped at seven days. Hourly health history and resolved incidents retain 30 days; completed notification history seven days. Open incidents and existing undelivered webhook jobs are not discarded as raw telemetry. These bounds are implementation defaults, not a new pricing promise.

The worker has bounded aggregation/evaluation loops, idle/error backoff, safe shutdown, periodic cleanup and 30-second operational counters. Watch last-success age, pending queue depth/age, gap/drop/error counts, rule evaluation delay and notification backlog. Local qualification measures overhead; hosted load, private process memory sizing and retention policy review are deployment prerequisites.
