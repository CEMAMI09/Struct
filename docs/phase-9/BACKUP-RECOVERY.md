# Backup inventory and tested recovery procedure

## Current qualification

`tests/enterprise/recovery-postgres.cjs` performs an actual PostgreSQL 18.4 cold filesystem copy and restore in separate UUID-named, loopback-only disposable directories. It preserves device/wire identity, encrypted roots, immutable slots, replay state, telemetry event identity and durable delivery intents. It demonstrates one accepted post-snapshot event being absent after restore. This is evidence of a recovery-point gap, **not zero-loss recovery, hosted Supabase backup coverage or a production RPO/RTO**.

The test separately retains an encryption key, proves a wrong key cannot decrypt the restored root, quarantines restored ingestion, rejects old-epoch traffic and then accepts a freshly provisioned epoch with a valid authenticated receipt. It also exercises simultaneous owner removals through separate actual PostgreSQL connections. Source files/migration hashes and elapsed times are in `evidence/recovery-postgres.json`. The disposable cluster and backup copy are removed with verified workspace containment.

## Critical state inventory

Authoritative data to protect together:

- Organization identity, memberships/roles, entitlements, subscription synchronization state and creator relationships.
- Devices, lifecycle status, wire identifiers, encrypted credential epochs/bootstrap verifiers, schema slots and immutable schema definitions.
- **Replay bitmaps/highest sequence and device-side reservation files/NVS.** Never restore these independently to an older accepted state under the same root/wire epoch.
- Telemetry event identity, duplicate constraints, transactional outbox payload snapshots, delivery identities, leases/attempts, routing/version snapshots, dead-letter/manual recovery audit.
- Integration configuration, encrypted secrets and independently protected integration encryption keys.
- Fleet jobs/results/provisioning retrieval state, durable onboarding/last-seen, monitoring rules/incidents/preferences, administrative audit and management-token verifiers/revocations.
- Supabase Auth identities/settings needed to preserve organizational references; managed auth/provider/signing configuration according to its supported backup procedures.

Recoverable/less critical data: usage rollups can be rebuilt only from retained genuine evidence, health samples and transient runtime counters can be discarded with an explicit visibility gap. Raw telemetry, queued payloads and decrypted secret files are sensitive. Storage objects/build artifacts are separate from PostgreSQL. Supabase database backups do not include Storage object contents ([official backup documentation](https://supabase.com/docs/guides/platform/backups)). Hosted backup schedule, retention/PITR, regional recovery and offsite encryption were **not inspected or changed**.

## Backup controls required before production readiness

Assign an owner for encrypted database backups, independent key backup, object storage backup, restoration credentials, retention, geographic copies, access logging, backup failure alerts and regular restoration drills. Keep `TCP_CREDENTIAL_KEY`, `STRUCT_INTEGRATION_KEY`, service-role/Auth signing material and mail credentials outside the database and outside Git; encrypt backups with separately controlled key access. Test key availability without printing values. Document application/database versions and migration/source hashes in each backup manifest.

Use the provider's supported hot backup/PITR mechanism or a properly stopped matching-version cold cluster copy. **Do not copy a running PostgreSQL data directory as an ordinary filesystem backup.** The cold approach tested here requires shutdown and the complete cluster ([PostgreSQL filesystem backup requirements](https://www.postgresql.org/docs/18/backup-file.html)). Provider recovery and `pg_dump`/WAL strategies need separate environment-specific qualification; this task did not configure production scheduling or infer entitlements.

## Controlled restore

1. Stop/isolate ingress, bootstrap endpoints, web writers and every dispatch/administrative/notification worker. Block public traffic before restoration; restored data may say the recovery gate is open.
2. Restore into an isolated environment, with independent keys and no production destination reachability. Do not activate copied credentials or send historical customer webhooks during validation.
3. Before exposing anything, use trusted private database access to execute `select enterprise_quarantine('restore');`. Confirm `ingestion_recovery_gate.blocked=true`. This blocks Secure V2/legacy commit RPCs and counter bootstrap; no successful commit receipt should be issued.
4. Validate organization isolation, record counts, immutable slots, event/delivery uniqueness, retained attempts/queues, secret decryption with independently restored keys and both application/service-role grants. Reconcile revocations/team/key changes since the recovery point through separately retained evidence. Rotate restored management/integration/private infrastructure credentials as needed; the device-ingestion gate does **not** block management APIs or workers.
5. Compare replay state with independently current watermarks only if reliable authenticated evidence exists. This implementation supplies no automatic replay-state reconciliation procedure. Its conservative supported path requires **new device credential/wire epochs** for every previously active restored epoch. Firmware/devices must be securely reprovisioned through the existing manual workflow; this is not remote OTA.
6. `select enterprise_release_recovery();` refuses to release while any active, unexpired credential predates quarantine. Never defeat this check by editing timestamps/resetting counters. The check protects application operations, not a malicious database administrator.
7. Test a new-epoch packet and authenticated receipt in isolation, verify original old keys fail and new outbox work is correct. Inspect management memberships/revocations, compare backfill gaps and record any unrecoverable accepted post-snapshot events.
8. Start workers only with reviewed destination settings and tenant controls. Preserved queued work may produce at-least-once deliveries; remote success before snapshot/crash may be repeated. Do not silently replay historical telemetry or delete queued work.
9. Restore traffic gradually, record actual recovery time/data-loss window and maintain incident communication. Re-establish backup scheduling and monitor recovery backlog.

A root/wire/sequence tuple must never be reused after counter uncertainty. The test's regenerated epoch makes sequence zero safe because the wire/key epoch changes. Restoring old local reservation files under unchanged credentials is unsafe.

## Running the disposable drill

The existing ignored tooling directory `work/pipelines/postgres-tools` needs local development packages `embedded-postgres` and `pg` matching the tested environment. Install them only there if unavailable, then run from the repository root:

```sh
npm run test:enterprise:postgres
```

No external database URL is consumed. Connections bind to loopback, use a random port/password and newly created fixture identities. PostgreSQL extensions/Auth are fixture shims; this is not a full Supabase Auth/Storage restoration. Physical devices, hosted Auth restoration, cloud backup encryption, failover, DNS switching and production RPO/RTO remain unverified.
