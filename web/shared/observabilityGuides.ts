import type { Guide } from './documentation'
export const OBSERVABILITY_GUIDES: Guide[] = [
  {
    slug: 'monitoring-analytics',
    updated: 'October 13, 2026',
    title: 'Monitoring, alerts and usage analytics',
    summary:
      'Understand observed reporting, durable alerts and traffic boundaries.',
    sections: [
      {
        title: 'Device activity and reporting expectations',
        paragraphs: [
          'Monitoring uses the last successful monitored database commit, independently of raw telemetry retention. Recently reporting is an observation, not proof of a continuously connected UDP device. Disabled and revoked devices retain their distinct lifecycle states.',
          'Choose Scheduled, Event-driven or No expectation. Scheduled devices use interval plus grace. Event-driven/no-expectation devices do not trigger inactivity alerts. Never-connected rules use registration age separately. Device overrides take precedence over workspace defaults; maintenance suppresses the affected inactivity condition.',
          'Open Monitoring, select Health / policy, set the schedule, then create and enable an inactivity rule in Alerts. The background evaluator works without new packets or an open dashboard. No rules or emails activate automatically.',
        ],
      },
      {
        title: 'Rules and incident lifecycle',
        paragraphs: [
          'Supported conditions: inactive scheduled device count, never-connected count after a provisioning window, accepted readings, observed application bytes, average packet size, authenticated rejection percentage, downstream attempt-failure percentage, dead-letter count, oldest queued age, and a recent decoded numeric sensor-field threshold. Scope by device, flat group or exact tag.',
          'Use trigger and clear thresholds for hysteresis, a minimum duration for consecutive evaluator observations, severity and a reopen cooldown. At most 100 rules and 100 newly opened incidents/hour/workspace; evaluation handles 20 eligible rules per worker cycle with a 30-second minimum reevaluation interval. Busy systems may have additional delay; inspect last-evaluated timestamps.',
          'An open incident is durable. Acknowledge means someone has seen it; it does not resolve the condition. Recovery resolves automatically. Manual resolution may reopen after cooldown if the condition persists. Muting, disabling and workspace maintenance suppress notifications/active incidents; re-enabling evaluates the actual condition again. Resolve active incidents before changing a rule definition.',
          'Sensor rules require one explicitly selected device and accept scalar JSON numbers or exact integer wrappers only; group-wide sensor expressions are unavailable. Exact 64-bit integer wrappers are compared as PostgreSQL numeric values and returned as decimal strings. Binary, strings and nested expressions are not silently converted. No arbitrary code is executed. Sensor holds describe repeated evaluations of fresh available samples, not proof of continuous physical measurement. Relative machine-learning anomalies are not implemented.',
        ],
      },
      {
        title: 'Notifications and troubleshooting',
        paragraphs: [
          'Dashboard incidents exist independently of notification success. Webhooks use the existing signed reliable delivery queue and alert.opened / alert.resolved JSON events. A webhook response confirms endpoint acceptance, not downstream business processing. Retries can produce duplicates; deduplicate with the incident ID and event type.',
          'Email is opt-in to the member’s verified account address and requires an operator-configured Resend sender/key. Severity preferences and current membership are checked. Provider acceptance is not mailbox delivery. Change your preference in Alerts to opt out. Notification transport is capped at 100 newly scheduled jobs/hour/workspace and 20 email recipients/transition; incidents remain visible when the cap delays notifications. Scheduling intents survive queue errors and retry up to eight times over 24 hours. They keep the original logical destination; changing its URL requires operator/customer review and does not silently redirect an old alert.',
          'Emails use up to eight bounded retries over 24 hours, exponential backoff/jitter and Retry-After. Attempts are retained; failed emails do not erase incidents. Alert webhook traffic is excluded from telemetry delivery-failure rules to prevent notification loops. Check notification history, credentials/permissions, queue backlog and worker health when notifications fail.',
        ],
      },
      {
        title: 'Payload, application, network and carrier bytes',
        paragraphs: [
          'New monitored Secure V2 commits record actual encrypted frame length, sensor payload length, 9-byte header plus the optional 1-byte batch-count prefix, and the 16-byte AEAD tag. One batch contains several logical readings; authenticated duplicates add observed traffic without adding committed readings.',
          'Receipt metrics count successful submission to the gateway UDP socket, not receipt by the device. Authenticated rejection/duplicate/receipt observations use a bounded best-effort buffer and may be lost during process/database outages. Unauthenticated traffic has no trustworthy workspace identity and is kept only as operator aggregate diagnostics.',
          'Minimum UDP/IP totals add 28 bytes for IPv4 or 48 for IPv6 per known datagram. These are specification calculations, not packet captures or billed cellular bytes. Fragmentation, IP extensions, radio/link traffic, modem overhead, DNS and carrier rounding are excluded. TCP and legacy packet accounting remain unavailable. Downstream HTTP/TLS wire-byte accounting is not inferred from request bodies.',
          'UTC minute/hour/day rollups process asynchronously and display freshness/backlog. Existing buckets are shown without invented zero-filled gaps. Unknown historical bytes stay unavailable. Group membership is snapshotted for future usage; groups overlap and totals are not additive. Backfill is a deliberate operator/user-authorized reading-only process, never an automatic reconstruction of packet sizes.',
        ],
      },
      {
        title: 'Costs, benchmarks and efficiency',
        paragraphs: [
          'Enter your own price per decimal MB (1,000,000 bytes), cellular fraction, billing-period days, allowance, minimum and fleet-level rounding. Prices are intentionally unset. A carrier measurement override already includes cellular traffic, so it is not multiplied by the cellular fraction again. Annual values scale to 365 days. Projections from network estimates require complete known coverage for the selected window, no recorded gaps and completed aggregation; an explicit carrier override can be used when those conditions are unavailable.',
          'Savings require an explicit measured baseline for the same period/boundary. Missing baselines produce no savings claim. Flat-rate plans do not automatically become cheaper with fewer bytes. Additional estimated cost and no cost difference are labeled explicitly. These estimates exclude Struct subscription/adoption costs and per-device carrier session rules.',
          'Select a device to inspect its latest retained reading and immutable schema. The existing Protocol Lab engine encodes that sample for supported competitors, with provenance and security/delivery distinctions. It is one sample, not a fleet distribution or observed competitor traffic. Unsupported schema mappings remain unavailable.',
          'Batch alternatives are calculated from the actual schema and SDK frame bound. They require firmware changes and involve buffering, latency, RAM and larger loss impact. The page does not automatically change firmware or immutable schema slots. For quantization, declare ranges/precision in Protocol Lab and inspect rounding effects before publishing an unused slot. A lossless packed-schema candidate uses the real encoder and checks round-trip values; zero savings are shown honestly. No universal humidity range or lossy policy is inferred from samples.',
        ],
      },
      {
        title: 'Retention, delayed analytics and operations',
        paragraphs: [
          'Rollups respect existing 1/7/30-day telemetry retention; minute summaries are capped at seven days. Processed packet details retain at most one day; unprocessed observations at most seven days. Deduplication identities retain 31 days. Resolved incidents retain 30 days and completed notification history seven days. Open incidents and unfinished delivery work are not treated as discarded raw telemetry.',
          'Usage may be incomplete before activation or while processing is delayed. Known expired or failed canonical metrics produce coverage-gap markers. If analytics is delayed, inspect pending metric events and worker logs. Existing Devices activity badges retain their older activity heuristic; Monitoring applies the explicit reporting expectations described here. If totals differ from a carrier bill, compare the accounting boundary, missing/best-effort attempts, network setup and billing increments rather than assuming either number is an exact measurement of the other.',
          'Operators must review migration 038 after 035–037, enable database/server/UI flags, start observability-worker.js and configure notification services separately. No production migration or notification is sent by local tests. Physical-device, hosted Supabase and production-scale qualification remain required.',
        ],
      },
    ],
  },
]
