# Struct deployment and recovery runbook

This is a release checklist for the current Nuxt application, TCP/UDP gateway, Supabase database, and outbox worker. The observed production web host is `https://struct-six-opal.vercel.app/`; pushes to `master` produced successful Vercel production deployments on 2026-09-27. Confirm the project configuration in Vercel before relying on this behavior. The gateway and worker hosts, their deployment triggers, the on-call owner, and the staging project still need to be recorded before a commercial pilot. A web deployment does not establish that the gateway or worker was deployed.

## Component contract

- Nuxt serves the authenticated web app and Stripe endpoints. It needs the Supabase URL/publishable key, a server-only Supabase service key, the credential-encryption key, and Stripe server secrets/prices. Only `NUXT_PUBLIC_*` values may reach the browser.
- The gateway accepts authenticated telemetry over TCP 8080 and UDP 8081 by default. It needs the same credential-encryption key as Nuxt and a service-role database key. Do not expose that key through browser or SDK packages.
- The outbox delivers committed events to customer HTTPS destinations. It can run embedded in the gateway (`OUTBOX_EMBEDDED=true`) or as a separate `npm --prefix tcp-server run start:worker` process. When separate, set `OUTBOX_EMBEDDED=false` on gateway instances and run at least one worker. Database leases permit multiple workers.
- Supabase stores devices, credentials, events, replay nonces, delivery state, and billing usage periods. Keep schema migrations ordered. Review grants and security advisors after permission changes.
- Supabase Auth must allow the deployed same-origin `/confirm` and `/reset-password?flow=recovery` redirect URLs. Test a password reset from a real test account on staging after each domain change.
- Stripe owns payment and invoice objects. Test and live accounts are distinct. Never repoint live prices or a billing portal configuration without reviewing the account and subscription effects.

Environment variable templates are in `web/.env.example` and `tcp-server/.env.example`. Keep actual values in the hosting provider's secret store. Rotate a credential immediately if it appears in logs, a repository, a generated SDK, or an incident attachment.

## Staged rollout

1. Record the Git commit, hosting environment, database project ID, migration versions, Stripe mode, and gateway/worker versions. Back up the database and verify a recent restore on a separate staging project before a permission or retention migration.
2. Apply migrations to staging, run `npm test`, `npm --prefix web run typecheck`, Python/C/Rust SDK gates, and `npm run build:web`. Test an owner, admin, and viewer with real authenticated Supabase requests; verify direct billing/role/credential/telemetry writes fail.
3. Deploy Nuxt and gateway/worker from the same reviewed commit. Permission migrations that remove browser column access require the safe-projection app version to be live first. Confirm `/`, sign-in, fleet list, schema editor, packet trace, billing page, TCP/UDP send, stored receipt, and one webhook delivery.
4. Apply the production permission and billing migrations in order after confirming the new app is serving. Check that scheduled retention jobs are installed, expired payload copies and replay nonces are removed, and permanent event IDs remain. Examine Supabase security/performance advisors and database errors.
5. Check Stripe webhook endpoint API version, secret, event delivery, subscription linkage, and the active Struct billing portal configuration. Use test mode for an end-to-end invoice and duplicate-webhook exercise before enabling paid self-service in live mode.

## Monitoring and recovery

Watch ingestion error rate and authentication rejection codes separately, receipt latency, database RPC latency, UDP busy drops, outbox pending count and oldest age, leased job count, retry/dead-letter count, webhook latency, and billing periods that remain closed but uninvoiced. Set initial alerts from a measured pilot workload; the repository does not yet justify numeric contractual SLOs. Avoid logging raw payloads or secrets.

On gateway failure, restart the process and send the same event identities; confirm that duplicate retries return the original receipt without duplicate telemetry. On worker failure, restart a worker and verify expired leases are reclaimed and delivered once per destination. On a destination outage, keep accepting/storing events within capacity, observe retry age, and coordinate any customer replays through the delivery log. On a database outage, do not report a storage receipt for an uncommitted event.

If a web deploy must be rolled back across a security migration, roll forward a compatible safe-projection build. Do not restore broad browser grants to make an old app work. If a billing migration fails, stop paid upgrades and true-up processing, preserve webhook delivery for retry, and reconcile periods against Stripe invoice items before resuming. Acknowledging a failed billing webhook loses the provider retry.

Migration 027 marks preexisting open usage periods as `true_up_baseline_verified = false`. The webhook logs `USAGE_BASELINE_RECONCILIATION_REQUIRED` and leaves those periods open instead of guessing how many devices were already paid for. Before marking a period verified, compare its dates, tier, paid quantity history, and any existing true-up invoice items with the matching Stripe subscription and invoices. Record the evidence and reviewer; resolve overlapping periods explicitly. Do not set the verification flag from today's subscription quantity alone, since it cannot prove the maximum already paid during an earlier month. New verified periods continue processing independently.

On 2026-09-27, the three preexisting test-data periods were reviewed. The July Scale peak of 1,000 and September Scale peak of 5,005 matched paid **test-mode** invoice quantities, with no prior Struct true-up invoice items; their baselines were marked verified and their open statuses retained for normal month-end processing. The July free period had zero usage and no Stripe subscription, so it was voided at zero. No Stripe object was changed. The linked subscription is test-mode while the local web `.env` uses a live Stripe key; verify production Vercel's mode and separate test data from production before commercial onboarding.

Production readiness still requires a documented backup/restore drill, actual host and deployment ownership, reference hardware qualification, load measurements, and an incident contact. Track dates and evidence for these gates in `docs/RELEASE-GATES.md` rather than marking them complete based on this document.
