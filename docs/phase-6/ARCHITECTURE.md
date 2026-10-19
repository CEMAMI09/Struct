# Phase 6 implementation

Updated 2026-10-12. Scope: the existing organization/workspace. Secure V2 packets, SDK wire formats, schema definitions and device UUIDs are unchanged.

## Inventory and organization

`GET /api/fleet` authenticates the existing session and workspace membership, then queries an explicit nonsecret projection. Pages contain 50 devices, never an entire fleet. Filters cover names/UUID/wire ID/external ID/serial, lifecycle/activity, multiple tags (all must match), a group, equivalent published schema, creation and last-seen date bounds. Sorts are name, creation and last-seen. Metadata is bounded JSON for location/type/customer attributes; arbitrary metadata search is not implemented. Offset paging is capped at page 2,000 (100,050 accessible records); deeper inventories must be narrowed by filters. Cursor paging remains future work.

Groups are flat, case-insensitively unique per workspace, with multiple memberships. Composite `(id, organization_id)` foreign keys reject cross-workspace membership. Group deletion removes memberships, never devices, and invalidates outstanding administrative previews for affected devices. Tags use normalized lowercase `labels[]`, separate from historical device `tags` JSON. There is no separate empty-tag catalog; a tag exists when assigned, and counts come from actual membership.

Existing overview/schema/setup selectors load 100 recent devices plus an explicitly requested device, and fetch schemas only for those IDs. Their UI identifies this as a limited view and links to the full fleet. Legacy mode retains its existing behavior before activation.

## Durable jobs

1. The API validates quantity/list/CSV inputs, workspace references and the existing capacity/billing rules. It rejects credential columns. Raw uploaded files are not stored.
2. `fleet_preview` persists normalized rows and immutable schema-copy settings. For existing-device actions, it captures exact device IDs, display names and `admin_version`, rather than saving a filter for later execution. Preview requires explicit confirmation within 30 minutes.
3. Confirmation queues a job. The worker claims one bounded item using `FOR UPDATE SKIP LOCKED`, a random fencing token and a 60-second lease. It can run without any browser session. Multiple workers use the same database claims.
4. `fleet_finish` rechecks the initiating actor's current write permission, device version, lifecycle and plan enforcement. Device mutation, item result and final job completion occur in one transaction. Database constraints enforce external/serial uniqueness. A response lost after commit cannot create the device again.
5. A terminated transaction rolls back mutation and result together; an expired lease permits a new claim. Stale tokens cannot mutate records. Three abandoned claims end in a visible recovery-limit failure. Deterministic failures are not automatically repeated; an eligible-failures retry creates another reviewed preview.
6. Cancellation fences remaining/in-flight items. Already committed changes remain. Concurrent changes fail individually rather than being overwritten.

Job options/results contain no generated secrets. Request UUIDs deduplicate repeated preview requests within retained job history; clients must not reuse a UUID for another intended operation. Deduplication is not promised after history cleanup. External IDs/serial numbers provide durable import identity beyond that window; display names may repeat.

The dashboard retains only a SHA-256 intent digest, random request UUID and timestamp in session storage while a preview response is uncertain. Retrying the identical request uses that UUID, including after refresh within the preview window. Uploaded rows and credentials are not persisted in browser storage by this mechanism. A successfully returned preview clears the pending intent.

## Limits, retention and billing

- 10,000 items/job; two queued/running jobs/workspace; four active previews/jobs; 20 previews/hour/workspace.
- 8 MiB JSON request, 4 MiB CSV, 32 columns, 10,000 rows, 8,192 characters/cell, 4 KiB metadata/device.
- 200 groups/workspace, at most 20 assignments/request, 20 tags/device of 48 normalized characters.
- Metadata exports: at most 10,000 rows and five operations/minute/workspace. Private manifests: at most 100 devices/request.
- Terminal inputs/results: at most 30 days **and the latest 50 terminal jobs/workspace**, whichever expires first. Audit: up to 365 days. Unfinished jobs are not silently deleted by retention. Worker cleanup runs every 3,600 polling iterations (roughly hourly when idle, more often under load).

These are operational bounds, not new subscription tiers. The existing database device-count guard and usage high-water accounting remain authoritative. Preview uses a capacity upper bound; duplicate skips may reduce actual creation. Soft-archived records still count under existing billing semantics. No Stripe subscription or plan configuration is changed.

## Ingestion lifecycle and provisioning

Disable is reversible; revoke and archive are terminal for that device record. Archive is soft deletion and preserves telemetry, event identity, delivery work and audit history. Backend gateway lookup checks lifecycle for every packet. Database wrappers and a telemetry insert guard enforce the same policy under races and legacy ingestion paths. A disabled/revoked packet cannot obtain a successful commit receipt. Already committed downstream work is not removed.

Each newly created device uses the existing Secure V2 enrollment RPC and independent cryptographically random 32-byte root/bootstrap/API secrets. They are encrypted with the existing private AES-GCM credential key before entering RPC arguments. No alternate fleet key or predictable credentials are introduced. Bulk schema copy calls the existing immutable publication function; no deployed slot is replaced.

The private manufacturing manifest requires owner/admin membership, explicit confirmation and ownership of the create/reprovision job. Device UUID, exact resulting wire epoch and item outcome must match. The database atomically consumes this bulk-export opportunity before returning encrypted credentials for server-side decryption. Already consumed bootstrap credentials are ineligible. Response headers prohibit caching. A lost download is not magically recoverable; separately authorized per-device SDK retrieval or deliberate reprovisioning remains available.

Only newly created results from a registration/import job are eligible; metadata updates to existing devices never grant new credential access. Reprovisioning results are eligible only for the exact replacement epoch. Ordinary device/result CSV exports contain no roots, bootstrap tokens or API secrets.

Manual reprovisioning allocates a new wire ID and root with zero old-key grace, preserving the database UUID and immutable slots. It is **not remote rotation**: offline firmware requires a manual update. `credential_epoch_first_seen_at` is cleared on every wire-ID change, and set only when that current epoch commits new telemetry. Thus prior successful telemetry does not falsely verify replacement credentials. Existing current-epoch packet evidence is backfilled with migration recognition time; it is not claimed to be an original device timestamp. Global first-packet onboarding remains independent.

## Routing

Phase 7's existing matcher supports `group_ids contains "UUID"` and `labels contains "tag"`. Existing routing entitlements remain enforced. The original atomic enqueue trigger records the matching route/version plus a membership snapshot with per-destination work. Administrative changes affect future commits only; retries retain their original snapshots. Deleting a referenced group makes that condition stop matching, never broaden to all devices. No second queue or routing engine is introduced.

## Authorization and failure boundaries

All APIs authenticate server-side; members read, owners/admins write. Service-only RPCs validate explicit actor/workspace scope. Browser roles cannot write lifecycle, execute worker RPCs or read root credentials. RLS covers groups, members, jobs, results and audit. Bulk previews are bounded and current permissions are checked again during execution. Errors expose safe classifications rather than SQL or secret material.

The worker uses two database RPCs/item and a 10 ms minimum pacing delay. Organization mutations serialize for identity and entitlement consistency. This favors safety over maximum enrollment throughput. Actual hosted RTT and large-fleet database load still need staging qualification; it is not a million-device capacity claim.
