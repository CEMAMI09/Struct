# Phase 9 — Enterprise operations

Implementation and qualification record, October 16, 2026. This is a local development change, **not a production rollout or enterprise certification**. The checkout already contained uncommitted Phases 3/4, 6, 7 and 5/8; Phase 9 extends those implementations. Their migrations and workers are prerequisites.

## What changed

- Existing organizations remain the tenant boundary. Personal workspaces, workspace creation, switching and leaving remain available. Removing membership preserves resources; deleting an account that owns or created organizational infrastructure now requires explicit reassignment instead of cascading resource destruction.
- Owner, Admin, Developer, Operator and Viewer capabilities are defined in `protocol/enterprise-permissions.json`, shared by application code and checked against SQL in tests. Unknown capabilities deny. Critical service-role actions recheck membership under the same organization advisory lock used for team changes.
- Expiring recipient-bound invitations replace immediate email-based enrollment when enterprise operations are enabled. Tokens contain 256 random bits; only a SHA-256 verifier is stored in the invitation. Acceptance requires Supabase's verified email, current inviter authority, expiry checks and the existing Scale team entitlement. Resend invalidates the old link. Optional invitation email uses durable leased work and explicit opt-in.
- Existing `audit_logs` gains actor type, outcome, action, request and job/reference correlation. Administrative triggers use strict safe snapshots, skip telemetry activity-only updates, and bridge existing fleet/integration/recovery intent. Search is tenant-scoped and cursor-paginated; JSON exports contain at most 500 records and are audited. Normal application roles cannot edit/delete records. Default bounded retention is 90 days.
- One-time management tokens support inventory, usage, integration metadata and preview/confirm/poll of secure fleet creation. They are distinct from device roots. Expiry, revocation, creator's current authority, scopes and database rate limits are checked for every accepted request.
- Private gateway/web/worker heartbeats expose freshness-aware sampled readiness through protected Operations UI. Tenant queues remain tenant-scoped. Missing samples are unknown. These samples are not end-to-end uptime, proof of all replicas being healthy or a contractual SLA.
- Recovery quarantine blocks ingestion and counter bootstrap after a restore until old active credential epochs have been replaced/revoked. Actual disposable PostgreSQL cold restore and new-epoch ingestion were tested. Rollback never deletes queues or rewinds counters.
- SDK generation accepts explicitly configured private ingestion/bootstrap endpoints, retaining HTTPS and authenticated counter bootstrap. A least-privilege container/Compose reference is supplied, with no embedded credentials. Docker/cloud deployment itself is unverified.

## Architecture and permissions

Human browser → Supabase session validation → request-local membership lookup → explicit capability → private transactional RPC/RLS → mutation and audit → response.

Management client → bearer verifier → current organization/creator/scope/expiry/rate check → existing fleet/analytics implementation → durable result. A token cannot choose another tenant through a body parameter.

Device → existing Secure V2 authentication, replay/schema checks → unchanged durable ingestion/outbox transaction → authenticated receipt. Human membership changes do not alter device cryptographic credentials or existing delivery work.

See [AUTHORIZATION-API.md](AUTHORIZATION-API.md) for capabilities and API contracts, [OPERATIONS.md](OPERATIONS.md) for monitoring/incidents, [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) for recovery, [DEPLOYMENT.md](DEPLOYMENT.md) for staged activation, and [SECURITY-READINESS.md](SECURITY-READINESS.md) for trust boundaries and outstanding controls. The preimplementation findings are in [AUDIT.md](AUDIT.md). Customer documentation is `/docs/enterprise`, authored in `web/shared/enterpriseGuides.ts`.

## Important implementation files

- Database: `supabase/migrations/039_enterprise_roles.sql`, `040_enterprise_operations.sql`.
- Shared capability catalog: `protocol/enterprise-permissions.json`, `web/shared/permissions.ts`.
- Request authorization, token validation and SDK endpoints: `web/server/utils/auth.ts`, `enterprise.ts`, `ingestEndpoint.ts`; `web/server/api/enterprise/**`; existing device/profile/integration/fleet/observability/billing routes are explicitly classified.
- Background processing and probes: `tcp-server/enterprise-worker.js`, `tcp-server/enterprise/{worker,health,metrics,probe}.js`; gateway and existing workers emit optional heartbeats. `web/server/plugins/enterprise-health.ts` records safe request correlation and process counters.
- Customer views: `EnterpriseWorkspace.vue`, `EnterpriseAudit.vue`, organization/security/operations/audit dashboard routes, `/invite`; existing billing, fleet, delivery and alert controls follow capabilities.
- Deployment reference: `deployment/enterprise/`, `tcp-server/ecosystem.enterprise.config.cjs`.
- Qualification: `tests/enterprise/`, `web/server/utils/enterprise.test.ts`, `web/shared/permissions.test.ts`, `web/test/enterprise/`, `web/playwright.enterprise.config.ts`.

## Verification and local use

From the repository root:

```powershell
npm run test:enterprise
npm run test:enterprise:postgres
npm run benchmark:enterprise
npm --prefix web run typecheck
npm --prefix web test -- --maxWorkers=1
npm --prefix web run build
```

The PostgreSQL restore script requires the local `embedded-postgres` and `pg` tools described in the recovery guide. These commands create disposable local fixtures, not hosted project records. Existing regression commands are `test:pipelines`, `test:integrations`, `test:fleet`, `test:observability` and `test:secure-v2`.

For the isolated browser fixture, set `STRUCT_ENTERPRISE_FIXTURE=true`, `STRUCT_FLEET_ENABLED=true`, `STRUCT_ENTERPRISE_ENABLED=true`, then run `node tests/fleet/http-fixture.cjs`. Configure the web process with local Supabase URL `http://127.0.0.1:3125`, public key `local-anon-key`, private service key `local-service-key`, the enterprise/fleet public and private flags, and `STRUCT_APP_URL=http://127.0.0.1:3120`; use `TCP_CREDENTIAL_KEY` equal to `34` repeated 32 times **only for this fixture**. Build/serve on loopback port 3120, then run `npm --prefix web run test:enterprise:browser`. Authentication in this fixture is simulated; application handlers and PostgreSQL policies/functions are real. Never use these fixture credentials elsewhere.

Actual results, measured boundaries and limitations are in [VERIFICATION.md](VERIFICATION.md) and `evidence/`. Do not interpret local tests as production Supabase/Auth/mail/provider qualification.

## Remaining limits

SSO/SCIM, enforced MFA, step-up authentication, an active-session inventory, offsite immutable audit archives, managed backup/PITR configuration, all-replica/external availability probes, production incident paging, dedicated/private-cloud orchestration and contractual SLAs are not implemented or verified. Machine integrations are deliberately read-only except secure fleet registration; credential export, arbitrary replay, billing and destination mutation are not delegated. There is no general user-facing creator-reassignment/account-deletion wizard. No production migrations, deployments, customer emails or cloud resources were executed.
