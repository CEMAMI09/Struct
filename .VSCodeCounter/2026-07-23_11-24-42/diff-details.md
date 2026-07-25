# Diff Details

Date : 2026-07-23 11:24:42

Directory /Users/user/Desktop/Struct

Total : 74 files,  4275 codes, 111 comments, 532 blanks, all 4918 lines

[Summary](results.md) / [Details](details.md) / [Diff Summary](diff.md) / Diff Details

## Files
| filename | language | code | comment | blank | total |
| :--- | :--- | ---: | ---: | ---: | ---: |
| [README.md](/README.md) | Markdown | 69 | 0 | 24 | 93 |
| [STRUCT.svg](/STRUCT.svg) | XML | 1 | 0 | 0 | 1 |
| [dummy-device.js](/dummy-device.js) | JavaScript | 7 | -7 | -1 | -1 |
| [ops/xdp/README.md](/ops/xdp/README.md) | Markdown | 29 | 0 | 13 | 42 |
| [ops/xdp/config.env](/ops/xdp/config.env) | Dotenv | 5 | 7 | 6 | 18 |
| [ops/xdp/load.sh](/ops/xdp/load.sh) | Shell Script | 42 | 4 | 11 | 57 |
| [ops/xdp/struct\_ingress\_kern.c](/ops/xdp/struct_ingress_kern.c) | C | 86 | 21 | 26 | 133 |
| [ops/xdp/unload.sh](/ops/xdp/unload.sh) | Shell Script | 12 | 3 | 5 | 20 |
| [supabase/migrations/018\_protocol\_v2\_security\_billing.sql](/supabase/migrations/018_protocol_v2_security_billing.sql) | MS SQL | 417 | 7 | 50 | 474 |
| [tcp-server/auth.js](/tcp-server/auth.js) | JavaScript | 49 | 3 | 8 | 60 |
| [tcp-server/downlinks.js](/tcp-server/downlinks.js) | JavaScript | 31 | -11 | 2 | 22 |
| [tcp-server/ingest.js](/tcp-server/ingest.js) | JavaScript | 242 | 21 | 42 | 305 |
| [tcp-server/native-parser/build.rs](/tcp-server/native-parser/build.rs) | Rust | 4 | 0 | 2 | 6 |
| [tcp-server/native-parser/index.d.ts](/tcp-server/native-parser/index.d.ts) | TypeScript | 3 | 3 | 3 | 9 |
| [tcp-server/native-parser/index.js](/tcp-server/native-parser/index.js) | JavaScript | 303 | 5 | 10 | 318 |
| [tcp-server/native-parser/package-lock.json](/tcp-server/native-parser/package-lock.json) | JSON | 35 | 0 | 1 | 36 |
| [tcp-server/native-parser/package.json](/tcp-server/native-parser/package.json) | JSON | 30 | 0 | 1 | 31 |
| [tcp-server/native-parser/src/lib.rs](/tcp-server/native-parser/src/lib.rs) | Rust | 200 | 0 | 24 | 224 |
| [tcp-server/package.json](/tcp-server/package.json) | JSON | 4 | 0 | 0 | 4 |
| [tcp-server/parser-native.js](/tcp-server/parser-native.js) | JavaScript | 77 | 7 | 8 | 92 |
| [tcp-server/parser.js](/tcp-server/parser.js) | JavaScript | 47 | 3 | 2 | 52 |
| [tcp-server/protocol.js](/tcp-server/protocol.js) | JavaScript | 98 | 9 | 13 | 120 |
| [tcp-server/server.js](/tcp-server/server.js) | JavaScript | -128 | -10 | -25 | -163 |
| [tcp-server/test-parser-parity.js](/tcp-server/test-parser-parity.js) | JavaScript | 81 | 7 | 8 | 96 |
| [tcp-server/test-parser.js](/tcp-server/test-parser.js) | JavaScript | 49 | 1 | 6 | 56 |
| [tcp-server/test-protocol.js](/tcp-server/test-protocol.js) | JavaScript | 42 | 0 | 8 | 50 |
| [tcp-server/test-udp.js](/tcp-server/test-udp.js) | JavaScript | 64 | 12 | 10 | 86 |
| [tcp-server/udp.js](/tcp-server/udp.js) | JavaScript | 97 | 17 | 20 | 134 |
| [web/app/assets/css/main.css](/web/app/assets/css/main.css) | PostCSS | -7 | 0 | -1 | -8 |
| [web/app/components/AppSidebar.vue](/web/app/components/AppSidebar.vue) | vue | 28 | 0 | 1 | 29 |
| [web/app/components/DeviceCredentialsModal.vue](/web/app/components/DeviceCredentialsModal.vue) | vue | 128 | 0 | 15 | 143 |
| [web/app/components/LiveDebugger.vue](/web/app/components/LiveDebugger.vue) | vue | 15 | 0 | 0 | 15 |
| [web/app/components/SchemaBuilder.vue](/web/app/components/SchemaBuilder.vue) | vue | 141 | 0 | 7 | 148 |
| [web/app/components/StructLogo.vue](/web/app/components/StructLogo.vue) | vue | 3 | 0 | 2 | 5 |
| [web/app/components/TelemetryChart.vue](/web/app/components/TelemetryChart.vue) | vue | 29 | 0 | 2 | 31 |
| [web/app/composables/useBilling.ts](/web/app/composables/useBilling.ts) | TypeScript | 2 | 0 | 0 | 2 |
| [web/app/composables/useBinaryParser.ts](/web/app/composables/useBinaryParser.ts) | TypeScript | 82 | 0 | 4 | 86 |
| [web/app/composables/useCppHeader.ts](/web/app/composables/useCppHeader.ts) | TypeScript | 24 | 1 | 4 | 29 |
| [web/app/composables/useDevices.ts](/web/app/composables/useDevices.ts) | TypeScript | 5 | 0 | 0 | 5 |
| [web/app/composables/useOrganization.ts](/web/app/composables/useOrganization.ts) | TypeScript | 22 | 0 | 1 | 23 |
| [web/app/layouts/auth.vue](/web/app/layouts/auth.vue) | vue | -1 | 0 | 0 | -1 |
| [web/app/layouts/default.vue](/web/app/layouts/default.vue) | vue | 30 | 0 | 1 | 31 |
| [web/app/middleware/auth.global.ts](/web/app/middleware/auth.global.ts) | TypeScript | -17 | -2 | -5 | -24 |
| [web/app/middleware/auth.ts](/web/app/middleware/auth.ts) | TypeScript | 12 | 0 | 3 | 15 |
| [web/app/pages/confirm.vue](/web/app/pages/confirm.vue) | vue | 7 | 0 | 1 | 8 |
| [web/app/pages/dashboard/audit-logs.vue](/web/app/pages/dashboard/audit-logs.vue) | vue | 1 | 0 | 1 | 2 |
| [web/app/pages/dashboard/debugger.vue](/web/app/pages/dashboard/debugger.vue) | vue | 1 | 0 | 1 | 2 |
| [web/app/pages/dashboard/destinations.vue](/web/app/pages/dashboard/destinations.vue) | vue | 1 | 0 | 1 | 2 |
| [web/app/pages/dashboard/devices.vue](/web/app/pages/dashboard/devices.vue) | vue | 18 | 0 | 3 | 21 |
| [web/app/pages/dashboard/index.vue](/web/app/pages/dashboard/index.vue) | vue | 31 | 0 | 3 | 34 |
| [web/app/pages/dashboard/organization.vue](/web/app/pages/dashboard/organization.vue) | vue | 1 | 0 | 1 | 2 |
| [web/app/pages/dashboard/schema.vue](/web/app/pages/dashboard/schema.vue) | vue | 1 | 0 | 1 | 2 |
| [web/app/pages/dashboard/settings.vue](/web/app/pages/dashboard/settings.vue) | vue | 93 | 0 | 8 | 101 |
| [web/app/pages/index.vue](/web/app/pages/index.vue) | vue | 1,160 | 5 | 142 | 1,307 |
| [web/app/pages/login.vue](/web/app/pages/login.vue) | vue | 60 | 0 | 4 | 64 |
| [web/app/types/index.ts](/web/app/types/index.ts) | TypeScript | 30 | 1 | 7 | 38 |
| [web/nuxt.config.ts](/web/nuxt.config.ts) | TypeScript | 1 | 0 | 0 | 1 |
| [web/public/site.webmanifest](/web/public/site.webmanifest) | JSON | 1 | 0 | 0 | 1 |
| [web/public/struct-logo-mini.svg](/web/public/struct-logo-mini.svg) | XML | 1 | 0 | 0 | 1 |
| [web/server/api/billing/usage.get.ts](/web/server/api/billing/usage.get.ts) | TypeScript | 29 | 0 | 4 | 33 |
| [web/server/api/devices/\[id\].delete.ts](/web/server/api/devices/%5Bid%5D.delete.ts) | TypeScript | -33 | 0 | -7 | -40 |
| [web/server/api/devices/\[id\]/key.post.ts](/web/server/api/devices/%5Bid%5D/key.post.ts) | TypeScript | 15 | 0 | 0 | 15 |
| [web/server/api/devices/bulk/index.post.ts](/web/server/api/devices/bulk/index.post.ts) | TypeScript | -21 | 0 | -1 | -22 |
| [web/server/api/devices/bulk/preview.post.ts](/web/server/api/devices/bulk/preview.post.ts) | TypeScript | -3 | 0 | 0 | -3 |
| [web/server/api/devices/index.post.ts](/web/server/api/devices/index.post.ts) | TypeScript | 2 | 0 | 1 | 3 |
| [web/server/api/stripe/portal.post.ts](/web/server/api/stripe/portal.post.ts) | TypeScript | 9 | 2 | 2 | 13 |
| [web/server/api/stripe/webhook.post.ts](/web/server/api/stripe/webhook.post.ts) | TypeScript | 24 | 0 | 3 | 27 |
| [web/server/utils/deviceCapacity.test.ts](/web/server/utils/deviceCapacity.test.ts) | TypeScript | -11 | -2 | -2 | -15 |
| [web/server/utils/deviceCapacity.ts](/web/server/utils/deviceCapacity.ts) | TypeScript | -94 | 2 | -11 | -103 |
| [web/server/utils/deviceCredentials.ts](/web/server/utils/deviceCredentials.ts) | TypeScript | 57 | 0 | 10 | 67 |
| [web/server/utils/portal.ts](/web/server/utils/portal.ts) | TypeScript | -6 | -1 | 0 | -7 |
| [web/server/utils/trueUpBilling.ts](/web/server/utils/trueUpBilling.ts) | TypeScript | 121 | 0 | 19 | 140 |
| [web/server/utils/usagePeriods.ts](/web/server/utils/usagePeriods.ts) | TypeScript | 154 | 0 | 18 | 172 |
| [web/shared/flagsParser.test.ts](/web/shared/flagsParser.test.ts) | TypeScript | 133 | 3 | 12 | 148 |

[Summary](results.md) / [Details](details.md) / [Diff Summary](diff.md) / Diff Details