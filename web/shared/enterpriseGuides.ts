import type { Guide } from './documentation'
export const ENTERPRISE_GUIDES: Guide[] = [
  {
    slug: 'enterprise',
    updated: 'October 16, 2026',
    title: 'Teams, security and enterprise operations',
    summary:
      'Manage workspace access, inspect audit evidence and operate Struct safely.',
    sections: [
      {
        title: 'Organizations and personal workspaces',
        paragraphs: [
          'Struct reuses its existing organization model. Your personal workspace remains simple; users can belong to several workspaces and switch using the dashboard selector. Devices, schemas, integrations and history remain with their organization when a member leaves. Removing membership does not delete the user account or reassign physical device keys.',
          'Open Organization to rename a permitted workspace, create another workspace, review members or leave voluntarily. Team invitations and role changes retain the existing Scale entitlement. No seat pricing or subscription benefits are changed. Last-owner protection requires transferring ownership before the final owner leaves. Account deletion involving creator-linked resources requires an explicit reassignment procedure.',
        ],
      },
      {
        title: 'Roles and permission boundaries',
        paragraphs: [
          'Owner controls ownership, administrators, resources and billing. Administrator manages ordinary team members and resources, billing, audits and API credentials; only owners grant administrator privileges or transfer ownership. Developer manages devices, schemas, permitted integration configuration, operational recovery and alert rules. Developer individual SDK provisioning can reveal that device’s credentials, but bulk credential manifests, stored integration secrets, billing and team administration remain restricted.',
          'Operator reads fleet and telemetry evidence, retries eligible failed deliveries and acknowledges alerts. Operators cannot replay delivered events, cancel work, change device configuration or reveal roots. Viewer reads permitted dashboards and metadata without mutations. The expandable role matrix in Security lists every capability; backend guards and database policies remain authoritative. Unknown capabilities deny access.',
          'Membership is checked for each HTTP request, with deduplication confined to that request. There is no cross-request permission cache. Critical actor-based database commands recheck permissions transactionally. Removing a member invalidates their management credentials and pending invitations, but previously copied device secrets cannot be unlearned: assess exposure and deliberately rotate/reprovision affected devices when necessary.',
        ],
      },
      {
        title: 'Invitations and membership',
        paragraphs: [
          'Create an invitation with an email and permitted role. A private link is shown once; optionally request email delivery through the configured enterprise worker. No account-existence lookup is disclosed. Links expire in seven days. They carry a token in the browser fragment, not a query string. The acceptance page removes it from the address bar and keeps a per-tab copy for up to one hour while signing in.',
          'The recipient signs in or registers, verifies the invited email and accepts. Reopen the original invitation after email verification if the provider opened another browser/tab. Acceptance is atomic, matches the current verified email and cannot be replayed. Existing memberships are never overwritten by an invitation. Resending replaces the old link; revocation or loss of inviter authority prevents acceptance.',
          'Invitations and audit history survive failed email transport. The email worker uses bounded leases, eight attempts over 24 hours, backoff/jitter and stable provider idempotency keys. Provider acceptance is not proof of inbox delivery. Without configured mail credentials, copy the link manually or have an operator resolve the configuration. Team operations have a technical safety limit of 60 per hour/workspace, independent of seat pricing.',
        ],
      },
      {
        title: 'Scoped management API credentials',
        paragraphs: [
          'Owners and administrators create a named management credential in Security, choose supported scopes and an expiration of 1–366 days. Copy it once into your secret manager. Only SHA-256 verification material is authoritative in the database; ordinary lists never return the token. These tokens are independent of Secure V2 device credentials.',
          'Supported scopes are devices.read, devices.create, analytics.read and integrations.read. The management endpoint supports inventory, usage, integration metadata, creation preview/confirmation and job polling. It does not expose device roots, manage members, change billing or create other API credentials. Requests use the key’s organization, regardless of a submitted tenant ID.',
          'Rotate a key to invalidate its old token immediately. Revoking it or removing its creating member prevents future authorization. Role changes reduce effective scopes. Keys are user-bound principals, not independent enterprise service accounts. Technical limits include 20 active keys/workspace and 120 requests/minute/key, plus existing fleet/entitlement limits. A creation response lost in transit may require inspecting the key list and rotating; never log authorization headers.',
        ],
        code: 'curl -X POST https://usestruct.com/api/enterprise/v1/request \\\n  -H "Authorization: Bearer $STRUCT_MANAGEMENT_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  --data \'{"action":"inventory","data":{"page":0}}\'\n\n# Bulk creation is two steps: preview_create with quantity (1..1000), prefix\n# and a UUID requestId; then confirm_create with jobId and confirm:true.\n# Poll with action:job and the same jobId. Queued does not mean completed.',
      },
      {
        title: 'Audit history and exports',
        paragraphs: [
          'Audit history extends the existing audit log with action names, verified actors, outcomes, request IDs and resource/job references. New snapshots use an allowlist; telemetry payloads, authentication tokens, device roots and integration credentials are excluded. Important human commands record their actor within the mutation transaction. Worker intent records bridge fleet, integration and delivery actions. Unattributed historic service actions remain unknown/system rather than inventing a user.',
          'Scale owners/administrators can search by actor, exact action, resource type/ID, outcome, reference and UTC time. Cursor pages contain 50 events; authorized JSON exports contain up to 500 events and are audited. Normal application roles cannot edit, delete or insert history. Bounded cleanup targets 90-day retention and can lag if maintenance is unavailable. Database superusers remain a trust boundary: this is not an external tamper-proof archive or compliance certification.',
        ],
      },
      {
        title: 'Sessions, identity and support',
        paragraphs: [
          'Authentication remains Supabase Auth. Security offers explicit global sign-out of refresh sessions; already issued access tokens may remain valid until expiry. Workspace removal and key revocation are enforced independently. Session inventory, MFA enrollment/enforcement, SAML/OIDC SSO and SCIM are not added or advertised as completed enterprise features.',
          'Download sanitized support context intentionally when needed. It contains workspace ID, role, time and an optional customer-provided UUID reference, not telemetry or credentials. Review it, then contact support@usestruct.com with impact, timeframe and relevant diagnostics. Do not send private SDK ZIPs or encryption keys. No hidden support impersonation, unrestricted staff access, guaranteed response times or contractual SLA is introduced.',
        ],
      },
      {
        title: 'Service readiness and objectives',
        paragraphs: [
          'Operations shows this workspace’s delivery backlog, aggregation freshness and invitation mail outcomes, alongside coarse service readiness. Gateway, delivery, fleet, observability, enterprise and web processes send private heartbeats every 20 seconds when enabled. Missing/stale evidence becomes Unknown, never Healthy. Internal counters and correlation logs exclude secrets and telemetry values.',
          'Readiness is sampled process/dependency evidence, not public UDP reachability or a guarantee of successful device commits. Percentages cover observed minute buckets only; missing minutes are not fabricated successes. Internal objectives are configurable planned targets, not achieved uptime or contractual SLAs. Operator runbooks describe database, gateway, queue, credential, resource and monitoring failures.',
        ],
      },
      {
        title: 'Backups, recovery and private deployments',
        paragraphs: [
          'The repository includes a real disposable PostgreSQL cold-backup restore test. It verifies encrypted credentials with an independently retained key, replay state, telemetry and durable delivery intents. This does not establish hosted Supabase backup/PITR coverage, offsite escrow or a guaranteed recovery time. Verify the actual hosting project’s backup configuration separately.',
          'A restore can roll replay state backward. Keep gateways and workers isolated, quarantine ingestion/bootstrap and reconcile loss before reopening. The implemented release guard requires every restored active Secure V2 credential epoch to be replaced or revoked; manual physical/firmware reprovisioning may be required. Never reset counters or silently accept old epochs to make recovery easier. Restored pending delivery work can repeat requests already accepted remotely; customers must deduplicate stable event IDs.',
          'Deployment artifacts provide a component reference with independent database/secret configuration and configurable SDK ingestion/HTTPS bootstrap endpoints. A local Node/SDK/UDP/SQL restart and quarantine reference is verified. Docker/Compose, dedicated managed hosting, full self-hosted Supabase Auth and private-cloud production deployments are not qualified. Public-network destination protections remain in force; no private-network integration bypass is added.',
        ],
      },
    ],
  },
]
