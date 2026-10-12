# Verification and acceptance evidence

Local Windows environment, Node 24.18.1, Python 3.13.14, Nuxt 4.4.8 and repository-pinned dependencies. Tested 2026-10-11. No production service was used.

## Automated results

| Check | Result | Boundary |
|---|---|---|
| Web Vitest excluding generated firmware builds | 178/178 passed, 35 files; final run 35.63 s | Includes actual Node starter/gateway/SQL integration and calculation regressions |
| Generated firmware export tests | 4/4 passed; 46.93 s | ESP32 Dev Module and ESP32-C3 compile in PlatformIO; no physical upload |
| Phase 1/2 browser workflows | 18/18 passed; 24.8 s | Six workflows × desktop/tablet/mobile Chromium, local production build and fixtures |
| Protocol Lab browser regression | 18/18 passed; 30.3 s | Existing calculator controls and API, three viewports, local build |
| Nuxt typecheck | Passed | Final source including device-scoped revisited guide |
| Nuxt production build | Passed | Final build; existing dependency deprecation warnings remain |
| `node tests/onboarding-db.cjs` | Passed | Actual migration and ingestion functions in disposable PGlite |
| Existing database/auth/billing/delivery scripts | Passed | `database.cjs`, `auth-security.cjs`, `billing-db.cjs`, `delivery.cjs` |
| TCP server suite and delivery test | Passed | Parser, auth, replay, rate controls, SSRF, outbox and gateway transport tests |
| Node SDK protocol/UDP/Secure V2 vectors | Passed | Existing SDK vectors, tampering, durable counters, IPv4/IPv6 and retries |
| Local debugger suite | Passed | Eleven local debugger scenarios |
| Native independent host C/mbedTLS suite | Not completed | Host compiler not on PATH; full `test:secure-v2` command was not an all-pass run |
| Git whitespace check | Passed | No configured lint command exists in this web package |

An intermediate browser run failed one mobile check: the test could match the intended destination inside the login query string, and could fill a form before hydration completed. The URL assertion now matches the full destination and login/signup fieldsets remain disabled until mounted. The final full browser run passed all 18 workflows.

Initial C3 compilation failed because the installed compiler was not in PlatformIO's PATH. Retrying with the nested installed toolchain directory added to the test process passed both boards. No production configuration or firmware protocol was changed to obtain that result. Native host C execution is a separate test from embedded cross-compilation and remains unverified in this run.

## Actual end-to-end sender evidence

`web/shared/nodeStarter.test.ts` generates and embeds the actual downloaded Node project, launches that sender as a child process, transmits through a real loopback UDP socket, and invokes the real gateway processing against disposable PostgreSQL-compatible storage. Test-only credentials/counter provisioning are local; the production HTTPS provisioning service is not called.

The gateway rejects a tampered authenticated packet before onboarding completion. A valid packet authenticates, decrypts and stores the environmental values, returning a real committed receipt. Payload is 3 bytes; application frame is 28 bytes. Decoded temperature is 23.5, active is true and humidity is approximately 61.3 under the declared 0.1 precision policy. Removing retained telemetry preserves the workspace milestone. This verifies a host sender and real implementation, not physical ESP32 performance.

`tests/onboarding-db.cjs` verifies fresh state, historical retained-event backfill after deletion, last-seen-only exclusion, valid commit, rejected skewed input, idempotence, retained-data deletion, separate workspaces, unauthorized writes, writer/viewer permissions, manual progress, interval bounds and failed Secure V2 enrollment rollback. Concurrency behavior is designed with conditional transactional updates, but this single-process PGlite test is not a multi-backend PostgreSQL stress test.

## Browser checks

The production-build browser suite verifies:

- Direct protected destination after sign-in, no landing-page navigation, manual dismissal surviving refresh/logout/login.
- Returning account with expired history remains completed; inactive and never-connected devices remain distinct; a new selected device does not inherit completed packet checklist status.
- Mobile navigation is inert when hidden; opening, keyboard Escape and focus return work; no document-width overflow at tested viewports.
- Failed billing refresh clears on a new request, pending controls disable duplicates, Free shows a normal message, paid fixture updates real limit inputs.
- Secure V2 is the normal schema view; real private Node ZIP contains sender, codec and expected ingestion configuration; capacity rejection links to Billing.
- Ten public docs routes, search, exact starter commands and responsive document layout.
- Unauthenticated protected navigation and verification-required signup.

Auth, Stripe and device API responses in these browser checks are fixtures. The tests never mutate real subscriptions, devices or customer data. Live provider verification, a real OAuth callback, session expiry/refresh and production RLS behavior need staging verification. Unit tests cover safe redirect rejection and callback classification, but do not replace provider integration tests.

## Acceptance status

**Verified locally:** durable global onboarding and device separation; retention persistence; existing-user proof/backfill/dismissal; activity status/filter logic; current Secure V2 workflow; compatibility parser/SDK tests; billing state lifecycle; safe redirect helpers and fixture sign-in/verification; navigation/clutter improvements; existing capacity feedback/enforcement; documented supported features; actual generated Node sender; both ESP32 project builds; mobile/tablet/desktop fixture workflows; Protocol Lab regression; typecheck and production build.

**Partially verified:** performance (local request reductions, not production Web Vitals); legacy removal (normal routes cleaned, active production usage unknown); auth flows (fixtures and helpers, not live providers); documentation examples (Node sender and firmware compiled, not every possible customer schema/hardware); concurrency (transaction semantics, not concurrent PostgreSQL backends); contextual help (representative browser checks, not a full assistive-technology audit).

**Pending deployment/hardware:** applying migration 034, actual email/OAuth and expired-session flows, approved live/staging billing synchronization, production latency/query plans, physical ESP32 build/upload/Wi-Fi/serial monitor, customer legacy inventory/retirement.

The project is ready for deployment review with those prerequisites, not a claim that every acceptance item has been verified in production. The migration and feature configuration are required for new device creation and database-backed progress.
