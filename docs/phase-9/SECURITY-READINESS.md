# Security readiness inventory

This is an engineering review, not SOC 2/ISO 27001 certification, penetration-test attestation, legal compliance opinion or contractual commitment. No external assessor or production security configuration was accessed.

## Implemented and locally tested

- Organization-scoped resources and existing RLS; strict server-derived actor identity, explicit canonical capabilities, default deny, request-local authorization deduplication and private transactional checks on critical administrative paths.
- Role separation and last-owner protection; concurrent actual PostgreSQL removal test; removed creators lose RLS access while device records and Secure V2 ingestion survive. Account deletion is blocked where creator cascades would erase organizational resources.
- Verified-recipient expiring invitation hash verification, token rotation/revocation, atomic acceptance, no automatic membership before acceptance, current inviter permission and unchanged Scale gate. Optional encrypted leased mail work is separate from authority to join.
- Scoped expiring management tokens, CSPRNG material, hash-only storage, one-time disclosure, creator-authority intersection, immediate next-request revocation, database rate bounds and tenant derived from token.
- Safe administrative audit projection, transactional intent, actor/request correlation, append-only normal application behavior, bounded denied-action logging and privileged retention. No roots, tokens, encrypted credential bodies or telemetry payloads in new audit snapshots or safe exports.
- Same-site bounded JSON for enterprise mutations, no caller-selected invitation origin, secure redirect allowlist, no arbitrary code expressions, no public detailed infrastructure endpoint, safe support downloads.
- Existing Secure V2 AEAD/replay/schema/commit receipt contract remains intact. Recovery gate rejects restored old epochs until conservative reprovisioning. Existing endpoint SSRF controls, provider secret encryption and parameterized integration SQL remain in their own tested layers.

## Implemented but limited/unverified externally

- Global sign-out uses Supabase's supported refresh-session revocation. Existing access JWTs can persist until expiry; current membership independently restricts organizational actions. No per-session inventory or organization-enforced reauthentication is claimed.
- Invitation mail retries/signature-free private link transport were tested against controlled transport contracts, not a real recipient inbox. Provider account/sender verification, deliverability and external email outages remain release checks.
- Readiness samples and private probes report process/dependency observations. Latest instance wins; missing data is unknown; no full public availability measurement or multi-instance health guarantee.
- Real local cold PostgreSQL restore was verified, including replay-state quarantine, loss after snapshot and fresh epoch acceptance. Hosted backups/PITR, Auth/Storage restore, offsite encryption, backup alerting and production RTO/RPO are not verified.
- Container/Compose artifacts and configurable private endpoints are prepared. Docker and private TLS/cloud infrastructure were unavailable; no production-ready private-cloud certification is inferred.
- Normal application audit integrity is enforced. Database administrators/service infrastructure can bypass it; immutable offsite retention/checkpoints are not provided.

## Required organizational processes

Assign owners for credential/key rotation and independent key recovery, incident escalation, least-privilege production access, access reviews, employee offboarding, safe customer support, backup schedule/drills, vulnerability/dependency updates, change approval, retention/legal review and external notification configuration. These controls require operational adoption and cannot be completed by adding a dashboard toggle.

Review production memberships before enabling new roles. Developer's individual SDK access can reveal a device's root; removing the user cannot revoke a copied secret without deliberately reprovisioning that device. Service-role database credentials remain highly privileged and are not organization-scoped. Store them only in trusted services and narrowly controlled operator environments.

## Missing/future controls

Enforced MFA, recent-auth step-up for root export/ownership transfer, SAML/OIDC enterprise SSO, SCIM, domain-verified automatic enrollment, fine-grained custom roles, user-facing creator reassignment/account-deletion workflow, immutable external audit storage, complete session/security-event history, automated membership-change email, offsite production backup management, multi-zone failover, external synthetic ingestion probes, all-replica health, automated incident paging and contractual support/SLA offerings.

Team and audit entitlements are preserved, not expanded into a new pricing design. Workspace deletion with production resource cleanup is not exposed through the new enterprise component; leave/transfer preserve infrastructure. No support impersonation/backdoor or cross-tenant secret export is introduced.

## Trust and failure behavior

Browser checks are advisory; database/API checks remain authoritative. Requests that began before removal may finish if their authorized transaction acquired the organization lock first; transactions beginning after removal cannot regain access from creator metadata. Already issued third-party requests or copied secrets cannot be undone. The release does not promise universal instantaneous cancellation of in-flight operations.

Required mutation-audit failures roll back those transactions. Optional denial-audit and heartbeat failures never authorize a request or stop valid telemetry merely to maintain analytics. Errors shown to customers are sanitized; historic audit unknowns and unavailable metrics remain explicit. Restoration must isolate every writer/dispatcher first because the ingestion gate alone does not stop management APIs, email or downstream sends.

The JSON support context deliberately contains identifiers only. Sharing those identifiers with support does not grant access. Retention jobs are bounded but require a running worker; database growth and retention lag must be monitored. Retaining records indefinitely by leaving workers stopped is not a compliance guarantee.
