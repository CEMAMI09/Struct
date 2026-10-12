# Root-cause audit

Inspection preceded implementation. This is a code/workflow audit, not evidence that live customer accounts were inspected.

| Area | Verified problem in baseline | Implemented response |
|---|---|---|
| Global onboarding | Overview inferred setup from retained selected-device telemetry; retention/new devices could reopen it | Workspace milestone and separate dismissal, updated transactionally after telemetry insertion |
| Existing users | Empty telemetry does not establish that no packet was ever stored; `last_seen` can reflect an authenticated connection | Backfill from telemetry/durable ingestion identities only; one-time dismissal when evidence is unavailable |
| Device activity | Very short uniform activity window and “Older” terminology; inactive filtering was inconsistent | Shared interval-aware activity classifier, durable history fallback, corrected filtering and help |
| Device creation | Ordinary endpoint created a legacy row/secret separately from Secure V2 enrollment | Service-only transactional wrapper creates and enrolls, rolling usage/device changes back on failure |
| Schema/download UI | Legacy builder was the default normal schema view | Secure V2 setup is primary; existing historical tools retained on explicit compatibility route |
| Authentication | External reloads/intermediate redirect behavior, lost destination, session hydration flashes | Safe destination helper, internal replace navigation, explicit confirmation/loading states |
| Billing | Refresh had no shared pending guard and could retain prior messages; membership refresh was not consistently awaited | Request ownership/deduplication, cleared feedback, normal Free result and awaited data update |
| Startup | Layout performed Stripe synchronization and duplicated usage/data loading | Remove automatic layout synchronization; bounded cache and in-flight deduplication |
| Route navigation | Device/schema lists were fetched again for warm navigation | 30-second per-workspace cache, forced refresh on mutation, stale-workspace response checks |
| Navigation/cards | Mixed icons, excessive per-card buttons, mobile hidden navigation still focusable | Consistent SVGs, grouped secondary actions, inert hidden mobile navigation, focus trap and Escape |
| Limits | Free capacity rejection could leave a generic error | Reusable formatter using actual enforced allowance and usage; direct Billing action; API enforcement retained |
| Documentation | No coherent public task documentation route | Searchable `/docs` and ten implementation-backed guides |
| First packet | Existing ESP32 generator was functional but guidance incomplete; no complete local Node sender download | Expanded complete project instructions; new real Node SDK export and end-to-end local test |
| Dev bundling | Shared packed codec served as raw CommonJS in development although production bundling handled it | Exact-path development transform; actual codec remains the source of truth |
| Guide reopening | Workspace completion could mark a new selected device's checklist complete | Selected-device storage evidence used for device checklist; workspace evidence only controls global visibility |

## Journeys checked

New/returning sign-in, protected destination, verification-required signup, empty telemetry, expired history, first-device guidance, new device after workspace completion, schema/download UI, generated Node sender, ESP32 compilation, inactive device filtering, free capacity rejection, failed/successful billing refresh, docs search/navigation, mobile menu and keyboard focus were tested locally.

SQL tests exercise actual migration functions/permissions and gateway integration exercises real authenticated packets. Browser auth/billing/device data use fixtures; they are not live provider/subscription tests. No production query was used to count active V1 devices. Compatibility is retained conservatively.

## Existing decisions preserved

- Production Secure V2 framing, authentication, replay protection, immutable schema slots and encryption remain unchanged.
- Existing gateway and historical SDK compatibility remain available. No deployed schema was republished.
- Existing pricing, allowances, paid true-up and server-side authorization remain the source of truth.
- Existing durable webhook outbox is documented accurately; no new infrastructure service was introduced.
- Existing retention behavior remains unchanged; only onboarding evidence is made independent of it.
- The landing page source and Protocol Lab research/results were not changed.

## Work deliberately not claimed

No production database query plan or real-user Web Vitals audit was available. Large-fleet list pagination and a universal dashboard cache were not introduced. There is no physical board upload/Wi-Fi measurement. Live legacy usage, live OAuth/SMTP verification and production Stripe state require deployment review, not invented fixture results. Password reset, bulk Secure V2 provisioning, new pricing and infrastructure roadmap features remain outside scope.
