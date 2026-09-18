# Release gates and component boundaries

Status: preview. Passing local tests does not satisfy production release gates.

## Ownership boundaries

- Encoding: web/shared/schemaCodegen.ts and parser implementations own schema
  layout. They must not open sockets, select accounts, or commit telemetry.
- Protocol: sdk/js/protocol.cjs and sdk/c/src/struct_sdk.c own wire encoding and
  verification. Fixed vectors are the cross-language boundary, not shared state.
- Transport: tcp-server/server.js, udp.js and SDK adapters own framing, sockets,
  admission and deadlines. A successful socket write is not storage success.
- Ingestion: tcp-server/ingest.js owns authentication/schema/replay orchestration.
- Storage: ingest_device_telemetry SQL RPC owns atomic commit and deduplication.
- Device management: profiles, provisioning and command lifecycle are separate
  operations. Provisioning is not atomic with telemetry today.
- Delivery integrations: webhooks run after commit, currently without durable
  handoff. Outbox work must strengthen this boundary before promising delivery.

These are current module boundaries, not claims of complete architectural
decoupling. Avoid wholesale rewrites; extract interfaces where a tested new
transport/storage implementation requires them.

## Preview release: automated gates

1. All npm test suites pass, including immutable schema publication, permission
   denial, rollback/retry, duplicate/conflict handling, real TCP fragments and UDP.
2. Frozen protocol vectors pass. One changed frame/receipt byte cannot be accepted
   as authentic. Every supported encoder has a reference-byte test before claiming
   cross-language conformance; generated-source checks alone are insufficient.
3. Python socket loss/deadline tests pass. C tests pass against real mbedTLS and
   are checked against independent crypto. Record compiler/runtime versions.
4. Production web build succeeds; local debugger and error paths load. Record
   which authenticated UI journeys were tested rather than counting HTTP 200 as
   end-to-end coverage.
5. No unresolved critical/high dependency advisories; document exceptions with
   owner, mitigation and expiry. No credentials in published packages.
6. SDK ZIPs rebuild from committed inputs; verify package contents and checksums.
7. Test clean installation and upgrades on a Supabase staging project, including
   extensions/scheduled jobs unavailable in the local database fixture.

## Production gate: evidence required, currently incomplete

- Zero observed duplicate telemetry inserts across at least 10,000 identical-frame
  retries with injected receipt loss; zero nonce consumption on failed commits.
- Exercise loss, reordering, duplicated packets, database interruption, gateway
  restart, credential rotation and device reboot; archive reproducible results.
- Select and publish reference hardware and compiler versions; run a 72-hour
  soak on each advertised platform with no crashes or unbounded queue/memory growth.
- Measure send deadline overshoot, peak RAM/stack/flash, radio awake time and
  energy per stored reading. Set board-specific acceptance bounds BEFORE measuring;
  no universal hard deadline or battery claim without supporting evidence.
- Declare target devices, messages/second, retention and deployment resources.
  Load-test that target plus 2x bursts; publish p50/p95/p99 latency, error rate,
  memory and cost. Throughput/SLO targets remain unset until workload sizing.
- Signed downlinks and durable webhook retries are prerequisites for advertising
  dependable command execution or webhook delivery.
- Restore a backup successfully; test tenant isolation and revocation on staging.
- Publish support duration, compatibility matrix, incident process and rollback
  procedure before advertising lifetime support or an availability SLA.

## Compatibility gate

Keep v2/v3 fixtures frozen. Run older SDK fixtures against new gateways, maintain
immutable schema snapshots, reject unknown versions, and test planned migration
order. New wire semantics require a distinct version or negotiated extension.
No changes to nonce, key interpretation or receipt meaning hidden in a patch.

## Roadmap sequence

This completes the initial contract/documentation part of roadmap task 1. The
production evidence and persistent-offline implementation remain open work.
Next: task 2 dependable delivery, task 3 end-to-end debugger, task 4 supported SDK
releases, task 5 efficiency evidence, task 6 security/identity, task 7 fleet
management, task 8 operations, task 9 UI journeys, task 10 interoperability, and
task 11 adoption/support. Track implementations and evidence separately from plans.
