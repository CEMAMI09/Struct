# Web deployment dependency verification

## Missing integration dependencies (October 19, 2026)

The Nuxt server imports the shared integration adapters and webhook URL validator
from `tcp-server/`. Their production dependencies were declared only in the
gateway package. A clean deployment that installed `web/` alone could not resolve
the AWS clients, Smithy HTTP handler, PostgreSQL client or `ipaddr.js`. Rollup
treated them as external imports; prerender then failed loading `ipaddr.js`.
Installing all three packages locally masked that deployment boundary.

`web/package.json` and its lockfile now declare the five required runtime
packages, pinned to the gateway's currently tested versions. No gateway install,
external-package stub, warning suppression or changes to SSRF protection are
required. Deploy both web package files together.

The shared `protocol/`, `sdk/js/`, `tcp-server/` sources and benchmark inputs must
remain available to the web build. Build from the full repository; installing only
web dependencies is supported, copying only the web source directory is not.

## Repeatable checks

The `Isolated web deployment` GitHub Actions workflow installs **only** the web
package, builds with Nitro's Vercel preset and checks the deployable function. It
fails on unresolved-package warnings as well as build/runtime errors. It uses
Node 22 to match the currently generated function runtime, fixture public build
values and no deployment credentials. It never deploys or changes databases.

From the repository root, in a fresh checkout with no other dependencies installed:

```sh
npm --prefix web ci --no-audit --no-fund
NITRO_PRESET=vercel NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NUXT_PUBLIC_SUPABASE_KEY=local-build-anon-key npm --prefix web run build
node scripts/check-web-deployment.mjs
```

PowerShell users can set the three build environment variables with `$env:NAME =
'value'` before running `npm --prefix web run build`.

The smoke check copies the built output into a new temporary directory, verifies
the five packages resolve inside the function and starts the real Vercel handler
on loopback. It checks disabled-integration and invalid-input API responses plus
server-rendered documentation. It removes only its own temporary copy afterward.
This verifies packaging, startup and basic routing; it does not establish live
Supabase, Stripe or cloud-provider interoperability.

## Verification performed

A clean copy outside the working repository passed `npm ci` with no root/gateway
installation, Vercel-preset production build and all eight prerender outputs.
The five unresolved-dependency warnings are absent. The isolated function passed
on Node 22.23.3 and Node 24.18.1, including HTTP 503 for intentionally disabled
integrations, HTTP 400 for invalid fleet/management requests and HTTP 200 for
documentation. Type checking, 130 integration checks and 255 web tests also passed;
two optional embedded compilation tests were skipped in this web run.

The upstream Nuxt `H3Error`/`H3Event` unused re-export warning is nonfatal and
remains visible. No dependencies under `node_modules` were patched and no build
warnings were hidden. A successful local build does not guarantee production
environment variables, database migrations or hosting configuration; those remain
separate deployment prerequisites. No deployment was performed.

## SDK compatibility workflow failure

Run `39216898390` passed all 255 Vitest tests, then failed later in the root
`npm test` chain at `tests/delivery.cjs:34`. That assertion expected the legacy
`Not authorized` text, while migration 040 correctly rejects unauthorized replay
with SQLSTATE `42501` and `PERMISSION_DENIED`. The assertion now verifies that
exact permission contract and that the denied request leaves replay history
unchanged. No database authorization was relaxed.

The separate checkout-cleanup warning came from the existing landing-page-template
gitlink having no `.gitmodules` URL. Its original public upstream and unchanged
commit are now mapped; the template was not removed or updated. Both workflows
use pinned Node-24-based actions, independently of their application Node version,
and checkout does not persist credentials. These workflow changes require a new
GitHub run after the fixes are pushed; the previous failed run is historical.

The complete root `npm test` chain passed locally after this fix: 255 web tests
(two optional skips), gateway/database/authorization/billing/delivery tests,
debugger scenarios and Secure V2 conformance, including independent C/mbedTLS
vectors and generated C/Node parity. The Windows run used the installed Zig/WASI
compiler and pinned upstream mbedTLS; the Ubuntu workflow already installs its
native C compiler dependencies. Workflow YAML validation and the previously
failing submodule cleanup command also passed. Later Python/Rust/package-artifact
workflow steps were not rerun on GitHub in this session.
