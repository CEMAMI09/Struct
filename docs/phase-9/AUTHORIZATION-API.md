# Authorization and management API

## Role contract

The exhaustive mapping is `protocol/enterprise-permissions.json`; SQL parity is regression-tested. Capability checks apply even if an older UI still displays a generic writer action. Server authorization is authoritative.

- **Owner:** all defined capabilities, including explicit ownership transfer and managing administrators. The last owner cannot leave, be removed or be demoted. Ownership transfer atomically promotes an existing member and makes the initiating owner an administrator.
- **Admin:** ordinary team administration, resource management, billing, audit, management tokens and operations. Cannot grant/manage Owner/Admin privileges or transfer ownership.
- **Developer:** device creation, metadata/disable, schema publication, **individual SDK provisioning**, integration configuration without stored credential updates, retry/replay, alert management and normal reads. Individual SDK provisioning reveals that device's root credentials. Developers are trusted for this capability; use Operator/Viewer for people who must never see device credentials. Bulk credential export/reprovisioning, revocation/archive, billing and team/security administration remain restricted.
- **Operator:** normal reads, retry existing failed deliveries and acknowledge alerts. Cannot replay successful events, cancel deliveries, pause/edit destinations, modify rules, export roots or enroll devices.
- **Viewer:** authorized resource reads and a sanitized self-generated support context; no infrastructure mutations.

Team changes and audit history retain existing Scale entitlements. No new seat charges, tiers or allowances are introduced. There are no custom roles or independently configurable permission policies in this release.

## Enforcement and identity

`requireOrgWriter` is a compatibility name for an explicit capability check, not a generic writer rule. Omitting/using an unknown capability fails closed. `auth.getUser()` and membership lookup are deduplicated only within one H3 request; they are not cached between requests or tenants. Membership read failures return unavailable, not permission grants. Supabase JWT lifetime remains authoritative; membership/key revocation is checked separately.

Database RLS continues to protect browser queries. Sensitive tables and all `enterprise_*` RPCs are service-role only. The API derives the actor from the verified session; body-supplied actors are not accepted. Service-role RPCs are a privileged trust boundary: someone holding the service key can impersonate actors and bypass RLS, so the key must remain outside client code. The organization mutation lock is shared with existing membership RPCs, and critical device/enrollment/SDK/fleet/integration/recovery operations revalidate live authority inside the transaction.

Legacy profile creation, individual legacy key changes and deletion now use the same transactional authorization boundary. The old hard-delete endpoint refuses devices with known ingestion/credential history and directs callers to Fleet Archive. Secure V2 devices continue authenticating independently of a removed human creator.

## Invitations

`POST /api/enterprise/action` with session cookie and JSON:

```json
{"orgId":"ORGANIZATION_UUID","action":"invite","data":{"email":"engineer@example.com","role":"developer","sendEmail":false}}
```

The response includes a private invitation link once. The token is in its URL fragment, not the HTTP request/query. `/invite` removes the fragment from the address bar and keeps a transient per-tab copy for at most one hour while signing in. Clear it on acceptance; seven-day database expiry remains authoritative. Links are sensitive bearer material bound to the verified recipient email. Do not put them in support bundles or logs. After email verification in another tab/device, reopen the original private link. Authenticated verified sign-in preserves `/invite` as a safe destination; arbitrary external redirects remain rejected.

Supported team actions: `rename` `{name}`, `invite` as above, `resend` `{id,sendEmail}`, `revoke_invite` `{id}`, `role` `{member,role}`, `remove` `{member}`, `transfer` `{member}`. `member` means membership UUID, not user UUID. `POST /api/enterprise/accept` accepts `{token}` only and uses the verified Supabase user/email. Expired/revoked/wrong-recipient/used links fail without revealing whether another account exists. Repeated pending invitations never redisclose old tokens; resend replaces them. Membership removal also revokes the creator's management keys and pending issued invitations.

## Management credentials

Created through Security or session-authenticated `action` values `key_create`, `key_rotate`, `key_revoke`. Create data: `{name,scopes,days}`; rotate/revoke: `{id}`. Twenty unexpired active keys per organization, one to 366 days, scopes limited to the four below. The secret has 256 random bits and is returned only for create/rotate; the database stores its verifier. A lost response does not make the secret recoverable: inspect the key list, rotate/revoke it and create a replacement. Existing keys do not reappear in ordinary responses.

Machine requests use `POST /api/enterprise/v1/request`, `Authorization: Bearer stk_UUID.HEX_SECRET`, and JSON. Keep the token in a secret manager/environment variable:

```sh
curl --fail-with-body https://usestruct.com/api/enterprise/v1/request \
  -H "Authorization: Bearer $STRUCT_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"action":"inventory","data":{"page":0,"filter":{}}}'
```

- `devices.read`: `inventory` `{page,filter}` returns the existing fleet page (50 devices); `job` `{jobId}` reads the caller principal's secure creation job.
- `devices.create`: `preview_create` `{requestId,quantity,prefix}` creates a preview using the existing fleet job engine, quantity 1..1000; `confirm_create` `{jobId,confirm:true}` schedules that authorized preview. Retrying the same preview request UUID and confirming again does not create duplicate work. Poll with `job`; job acceptance does not prove physical provisioning.
- `analytics.read`: `usage` `{from,to,filter}` uses existing bounded analytics and measurement labels.
- `integrations.read`: `integrations` returns safe integration identity/type/version/enabled metadata, never credentials or endpoint secrets.

Tenant is derived from the token. Supplied organization identifiers cannot change it. The creator must still be a member and retain the delegated capability; a role downgrade reduces effective access. Keys cannot manage team/billing, retrieve device credentials, modify integrations or arbitrarily replay telemetry. Requests are limited to 120 per key per minute in the database, with an additional process-local guard. Authentication failure is 401, human authorization failure 403, conflict 409, bounded rate/limit failures 429 and disabled enterprise interfaces 503. Do not treat every non-2xx result as retryable.

## Read APIs, audit and bounds

- `GET /api/enterprise?orgId=UUID&page=0`: own organization, role/capabilities, 50-member page, count, at most 100 recent invitations/keys permitted by role. No token verifier/secret returned.
- `GET /api/enterprise/audit?orgId=UUID`: filters `actor`, `action` (exact), `resource`, `id`, `outcome`, `reference`, `from`, `to`; cursor `before` plus `beforeId`; 50 results. UTC timestamps. `export=true` permits up to 500, requires `audit.export`, and records export intent. UI JSON exports are safe from spreadsheet formula execution.
- `GET /api/enterprise/operations?orgId=UUID`: protected coarse component readiness and own queue/aggregation/mail state. No other tenant's counts or credentials.

Enterprise mutation bodies require same-site JSON and matching Origin when present, ≤16 KiB. Machine command JSON inside the database is ≤8 KiB. User actions have process-local bounds plus database limits on team/key commands (60/hour/organization). Invitations accept at most 20 attempts/minute/user at the API. These are operational safeguards, not new pricing allowances.

## Audit integrity

Required administrative audit inserts occur with the mutation transaction; failures roll back those mutations. Safe snapshots use an explicit allowlist, plus changed field names when values cannot be disclosed. Bulk job intent/progress correlation comes from the existing job audit. Legacy unknown actors remain unknown. Request UUIDs correlate API errors without logging secrets. Denied human actions are best-effort and bounded; cross-tenant/unverified claims are not attributed as legitimate customer actions.

Normal applications cannot change/delete audit rows. Private maintenance deletes at most 1000 records older than 90 days per cleanup and records per-organization removal counts. Database superusers/service infrastructure can tamper with records or disable triggers. No same-database hash chain is advertised as immutable evidence, and no external checkpoint/WORM archive is implemented.
