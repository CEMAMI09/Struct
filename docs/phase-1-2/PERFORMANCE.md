# Performance measurements

These are local fixture observations, not production benchmarks. Baseline source was `9e250927dceb392ae225aef844d8cd7fa5e60a2c`; final observations use the updated local production build. Separate browser contexts visited the same route sequence against loopback fixture data. Raw JSON is retained under `performance/`.

## Repeated warm navigation

Three Devices/Overview cycles, within the 30-second data cache window:

| Route | Before data requests per visit | After data requests per visit | Before median observed interval | After median observed interval |
|---|---:|---:|---:|---:|
| Devices | 2: devices + schemas | 0 | 409.5 ms | 409.5 ms |
| Overview | 3: devices + schemas + telemetry | 2: onboarding + telemetry | 407.8 ms | 406.9 ms |

The observed intervals include an intentional **350 ms wait**, Playwright action overhead and local scheduling. They are not data-ready latency. The request reductions are consistent across all three cycles; the tiny/no timing difference is not evidence of faster real-world rendering. A remote database may make avoided round trips more valuable, but that has not been measured here. No JavaScript chunk request occurred during these warm transitions because the relevant routes were prefetched.

## Hard navigation sample

One sample per route, same sequence, existing local authenticated fixture session. Request counts include assets/prefetch/analytics requests, not just API calls. Counts and timings depend on browser cache and the fixed observation window.

| Route | Total requests before → after | Data requests before → after | DOMContentLoaded before → after | TTFB before → after |
|---|---:|---:|---:|---:|
| Homepage | 66 → 63 | 0 → 0 | 121.2 → 115.5 ms | 1.4 → 0.7 ms |
| Login (authenticated redirect) | 63 → 65 | 5 → 6 | 51.3 → 69.7 ms | 13.4 → 15.6 ms |
| Overview | 62 → 64 | 5 → 6 | 40.6 → 40.3 ms | 13.9 → 13.4 ms |
| Devices | 63 → 52 | 4 → 4 | 39.9 → 58.5 ms | 11.4 → 12.7 ms |
| Schema | 63 → 63 | 5 → 5 | 39.2 → 44.0 ms | 14.4 → 14.8 ms |
| Diagnostics | 61 → 53 | 4 → 4 | 70.4 → 58.0 ms | 12.2 → 12.9 ms |
| Settings | 63 → 55 | 6 → 5 | 39.8 → 54.9 ms | 14.7 → 14.1 ms |
| Docs | 37 → 50 | 0 → 0 | 48.1 → 42.8 ms | 19.3 → 8.3 ms |

Docs was a 404 before and a complete documentation index afterward, so its timings are not a like-for-like performance comparison. Login samples are returning authenticated navigation, not password authentication round-trip timings. Durable onboarding adds one initial RPC; that extra request is intentional. Some initial page timings are higher, so no universal page-speed improvement is claimed.

`settledMs` in the hard-navigation JSON includes a deliberate **600 ms wait**; it must not be presented as LCP or time-to-interactive. LCP fields are null because this lightweight navigation probe did not collect reliable paint observations. INP and CLS were not collected. Before/after production Web Vitals, real database query durations and high-volume customer workloads remain future validation.

## Bundle boundaries

The final Nitro build reports 15.8 MB server output, 6.23 MB gzip. This is **server output**, not the download size for a dashboard visit. The emitted JavaScript chunks collectively total 1,446,187 bytes across 63 files; they are route-split and are not all loaded on one page. These totals include Protocol Lab and other existing features. The benchmark archive remains outside ordinary browser assets; only the existing server-side compact Lab data is packaged for Lab requests.

The implementation restricts visibility prefetch to Devices and Schema, delays other navigation prefetch until interaction, uses a lazy telemetry chart only when data exists, removes layout-wide Stripe sync and deduplicates usage/device queries. The baseline bundle byte inventory was not captured consistently, so there is no claimed bundle-reduction percentage.

## Reproduce

Start the loopback fixture and local production build as described in [README](README.md), then run `node tests/phase12/performance.cjs` and `node tests/phase12/warm.cjs` from the repository root. Both scripts accept `PHASE12_BASE_URL` and reject non-loopback targets. An optional first argument selects the output JSON path. The scripts overwrite their final output filenames by default; preserve prior observations before rerunning.

`baseline.json` and `warm-before.json` are the original baseline observations. `after.json` and `warm-after.json` retain an earlier implementation sample; `after-final.json` and `warm-final.json` are the final measured sample. Avoid mixing their different observation times into invented averages.
