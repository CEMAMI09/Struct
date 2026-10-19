import type { Guide } from './documentation'
export const FLEET_GUIDES: Guide[] = [
  {
    slug: 'fleet-management',
    updated: 'October 12, 2026',
    title: 'Fleet device management',
    summary:
      'Register, organize and manage devices in bounded background jobs.',
    sections: [
      {
        title: 'Availability and inventory',
        paragraphs: [
          'Fleet management requires an administrator to deploy migration 037 and explicitly enable the server, UI and worker. Existing individual-device workflows remain available before activation. The inventory uses 50 devices per server page; search by name, device UUID, Secure V2 wire ID, external identifier or serial number. Activity describes observed reporting, not a continuous UDP connection.',
          'Filter by groups, all selected tags, status or a published schema copied from an authorized device. Active means a packet was observed within three expected reporting intervals, with a five-minute minimum. Historical first-packet evidence survives telemetry retention.',
        ],
      },
      {
        title: 'Bulk registration',
        paragraphs: [
          'Choose Add devices, then quantity/numbering, a pasted name list or CSV. Optionally copy an authorized device’s immutable published schema slot, choose groups and tags, and review the preview. Confirming schedules a durable background job; closing your browser does not stop it.',
          'Names may repeat; device UUIDs, wire identities and random credentials remain distinct. External IDs and serial numbers are exact, case-sensitive organization-scoped identities. Free and paid capacity checks use the existing billing system. The preview shows an upper-bound month-end true-up, not a new charge or subscription change.',
        ],
      },
      {
        title: 'Groups and tags',
        paragraphs: [
          'Groups are flat and allow multiple memberships. Create or rename groups in Devices; select devices and assign/remove groups in bulk. Deleting a group never deletes its devices. Tags are normalized lowercase labels, separate from historical key/value device tags; at most 20 labels of 48 characters per device.',
          'For Phase 7 routing, use field group_ids with contains and a quoted group UUID, or field labels with contains and a quoted tag. Membership changes affect future committed events only. Existing queued delivery snapshots are preserved. A deleted group stops matching; it does not broaden a routing rule.',
        ],
      },
      {
        title: 'Bulk actions and jobs',
        paragraphs: [
          'Select a page or all matching devices (maximum 10,000 per operation). The server freezes the exact IDs and administrative versions at preview; later-created devices are not included. Concurrent changes produce a visible version conflict instead of overwriting newer data.',
          'Update description/metadata, groups/tags, disable, enable, revoke, archive or request manual reprovisioning. Metadata replaces the selected JSON object; this does not remotely configure firmware. Existing schema slots are never overwritten. Bulk reassignment of existing firmware schemas is intentionally unavailable.',
          'Cancel stops uncommitted items; completed changes remain. Download a formula-safe CSV report. Failed eligible items can be reviewed in a new retry preview, which requires confirmation. Preview records expire after 30 minutes; terminal job inputs/results are retained for up to 30 days and at most the latest 50 terminal jobs per workspace, whichever limit is reached first. Audit records remain for up to one year. Download reports before cleanup.',
        ],
      },
      {
        title: 'Disable, revoke and archive',
        paragraphs: [
          'Disable temporarily rejects new ingestion and bootstrap; Enable restores only eligible disabled devices. Revoke permanently blocks this device record and invalidates all its Secure V2 credentials. Revoked records cannot be re-enabled or rotated.',
          'Archive is soft deletion: it blocks ingestion and preserves identity, telemetry and delivery history. It does not cascade-delete downstream jobs. Archived records still count under existing billing rules; contact the existing account support path for permanent data deletion questions.',
        ],
      },
    ],
  },
  {
    slug: 'fleet-csv',
    updated: 'October 12, 2026',
    title: 'CSV fleet importing',
    summary:
      'Map spreadsheet columns, validate identities and review import results.',
    sections: [
      {
        title: 'Format and mapping',
        paragraphs: [
          'Upload UTF-8 CSV with unique nonempty headers. Quoted commas, escaped quotes, CRLF, a UTF-8 BOM and Unicode are supported. Maximum: 4 MiB, 10,000 rows, 32 columns and 8,192 characters per cell.',
          'Map columns to name (required), external_id, serial_number, description, metadata, lifecycle, group or tags. Metadata is a JSON object of at most 4 KiB; put location/type/customer attributes there. Group names must already exist in this workspace. Tags are comma-separated; quote the CSV cell when it contains commas. Schema source/slot is chosen for the whole import. Credentials cannot be mapped or imported.',
        ],
        code: 'name,external_id,serial_number,group,tags,metadata\nFactory Sensor 001,unit-001,SN001,Factory A,"production,outdoor","{""location"":""north""}"\nFactory Sensor 002,unit-002,SN002,Factory A,testing,{}',
      },
      {
        title: 'Validation and duplicates',
        paragraphs: [
          'The browser previews mapped rows; the server validates again. Invalid values stop preview creation with a row number. Correct them before confirming. The persisted preview includes counts of existing identities and the maximum new-device count.',
          'Reject duplicates reports identity collisions as failed job items; Skip leaves existing records untouched; Update approved metadata changes description and metadata only. It does not replace credentials, names, protocol identity or schemas. External-ID and serial collisions that refer to different existing records are rejected. Row ordering is deterministic, so later duplicates are handled by the selected policy.',
          'Device names are display labels and are not unique identities. Include stable external IDs or serial numbers for repeatable manufacturing/import runs. Request IDs make repeated submission of the same preview idempotent.',
        ],
      },
      {
        title: 'Results and recovery',
        paragraphs: [
          'Inspect created, updated, skipped and failed items in Bulk jobs. Reports never contain secrets; spreadsheet formula prefixes are escaped. No uploaded raw CSV file is stored. Normalized row data remains in the job until cleanup.',
          'Retry eligible failures creates a new preview. It never reruns completed items automatically. A plan or permission change during execution can fail remaining items safely. Resolve the cause, review the affected rows and confirm another attempt.',
        ],
      },
    ],
  },
  {
    slug: 'fleet-provisioning',
    updated: 'October 12, 2026',
    title: 'Secure fleet provisioning and credentials',
    summary:
      'Handle manufacturing manifests, manual reprovisioning and credential epochs safely.',
    sections: [
      {
        title: 'Registration is not physical provisioning',
        paragraphs: [
          'Each new device receives cryptographically random, independent root and bootstrap secrets, encrypted with the existing server credential key. Registration does not prove the device has been flashed or claimed. Inventory distinguishes Registered, Manifest exported and current credentials verified by committed telemetry. Rotating credentials clears this verification until the new credential epoch sends a valid packet; historical device activity remains.',
          'Use the existing per-device Setup / SDK guide to generate a complete starter. Manufacturing jobs also offer an explicitly confirmed private JSON manifest for at most 100 completed devices from the current result page. The requesting job owner/admin can retrieve each credential epoch once through this bulk workflow. Ordinary inventory and CSV reports contain no secrets.',
        ],
      },
      {
        title: 'Protect the private manifest',
        paragraphs: [
          'The private manifest contains rootSecret and bootstrapToken. Download over your authenticated session, store offline securely, restrict factory access and remove temporary plaintext copies after provisioning. Never commit it to Git, put it in a URL or log it.',
          'A consumed bootstrap token cannot be exported through the manufacturing manifest. If the download is lost, use the separately authorized per-device SDK workflow or deliberately reprovision; the UI does not promise recoverable one-time downloads. A manifest export is not evidence that a physical device applied it.',
        ],
      },
      {
        title: 'Manual reprovisioning and offline devices',
        paragraphs: [
          'Reprovisioning keeps the database device UUID, allocates a new wire ID/credential epoch and immediately revokes all old credentials with zero grace. The device must be manually updated with the new SDK configuration, root and bootstrap token before it can transmit again. Existing immutable schema slots remain.',
          'There is no seamless remote credential-rotation command in Secure V2. An offline device remains offline until updated. Old keys do not remain as an indefinite fallback; sequence counters belong to the new wire epoch, and replay protection is preserved. Revoked/archived records cannot be reprovisioned.',
          'Previously committed telemetry and downstream queue entries are not removed by disable, revoke or reprovisioning. A commit receipt still means durable ingestion, not downstream webhook success.',
        ],
      },
    ],
  },
  {
    slug: 'fleet-api',
    updated: 'October 12, 2026',
    title: 'Fleet API and operations',
    summary: 'Authenticated endpoints, job polling, limits and server rollout.',
    sections: [
      {
        title: 'Authentication and reads',
        paragraphs: [
          'APIs use the existing authenticated Struct browser session. Members may read; only organization owners/admins may mutate or disclose provisioning material. No unauthenticated fleet enrollment endpoint is introduced. Responses use private, no-store caching.',
          'GET /api/fleet?orgId=UUID&page=0&filter=JSON returns at most 50 devices plus group/tag counts and the 20 most recent jobs. Supported filter keys: search, status, group, labels, sort, schemaDevice, schemaSlot, createdAfter, createdBefore, seenAfter and seenBefore (ISO timestamps). GET /api/fleet/job?orgId=UUID&id=JOB_UUID&page=0 returns 100 items plus aggregate result counts.',
        ],
      },
      {
        title: 'Preview and confirm',
        paragraphs: [
          'POST /api/fleet/preview accepts same-site JSON, orgId, requestId (UUID), operation and options. For create, supply quantity/prefix/start/digits, rows, or csv/mapping; use duplicates reject/skip/metadata. For existing-device actions, supply rows [{id,version}] or a server-side filter.',
          'POST /api/fleet/action accepts orgId, jobId and action confirm/cancel. retry_preview also requires a new requestId and returns a new preview jobId. Review it before confirmation. POST /api/fleet/groups accepts orgId, name, optional id/version and delete:true for confirmed deletion.',
          'POST /api/fleet/export accepts orgId and jobId, ids or filter, returning metadata CSV. POST /api/fleet/manifest accepts orgId, jobId, deviceIds (1–100) and confirm:true, returning a private credential JSON download. Do not call it as a routine inventory export.',
        ],
        code: '// Same-origin authenticated browser request; no API secrets in URL.\nconst preview = await fetch("/api/fleet/preview", {\n  method: "POST", headers: {"Content-Type":"application/json"},\n  body: JSON.stringify({orgId, requestId: crypto.randomUUID(),\n    operation:"create", prefix:"sensor-", quantity:10,\n    options:{labels:["testing"]}, duplicates:"skip"})\n}).then(r => r.json());\n// Review GET /api/fleet/job before explicitly confirming preview.jobId.',
      },
      {
        title: 'Limits and errors',
        paragraphs: [
          'Safety limits: 10,000 items/job, two pending/running jobs/workspace, four active previews/jobs, 20 previews/hour, five metadata exports/minute/workspace, 200 groups, 20 group assignments per request, 20 tags/device, 8 MiB JSON request. Existing subscription allowances still apply. Export is bounded to 10,000 rows; narrow filters for larger fleets.',
          '401 requires login; 403 indicates tenant/role denial; 402 indicates capacity/billing prerequisites; 409 indicates an administrative version conflict. Job items expose safe error codes, never database statements or credentials. No request ID should be reused for a different intended operation.',
          'Workers run outside the browser. Administrators must install migration 037 after 035/036, explicitly activate fleet_settings, set server/public feature flags and start tcp-server/fleet-worker.js with the existing private credential key. See repository docs/phase-6/DEPLOYMENT.md; no deployment happens automatically.',
        ],
      },
    ],
  },
]
