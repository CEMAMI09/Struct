<script setup lang="ts">
import type { LabResult, LabSettings } from '#shared/protocol-lab/types'
const props = defineProps<{ result: LabResult | undefined; settings: LabSettings }>()
const example = computed(
  () => `// Repository Node SDK. Supply enrolled identity, secret and durable counter.
// Publish this schema in slot 1 before sending.
const { SecureV2Client } = require('./sdk/js/secure-v2-client.cjs')
async function sendSample({ wireDeviceId, rootSecret, counter, host, port }) {
  const client = new SecureV2Client({ wireDeviceId, rootSecret, counter, host, port })
  const payload = Buffer.from('${props.result?.payloadHex ?? ''}', 'hex')
  return client.${props.settings.batch > 1 ? 'sendBatch' : 'send'}(1, ${props.settings.batch > 1 ? `Array.from({ length: ${props.settings.batch} }, () => payload)` : 'payload'}, { confirmed: ${props.settings.delivery === 'confirmed'} })
}`,
)
const rows = [
  [
    'Schema & SDK',
    'Generated C headers; C/ESP32 and Node Secure V2 transports. Legacy Python/Rust also exist.',
    'Protobuf has multi-language code generation; JSON/CBOR require an agreed layout and library.',
  ],
  [
    'Ingestion & backend',
    'Struct provides enrollment, schema slots, managed ingestion, delivery tracing and signed webhooks.',
    'MQTT brokers, CoAP resources and Leshan servers require application/storage integration. Managed services may provide it separately.',
  ],
  [
    'Device identity',
    'Device root enrollment, persistent counters and schema slot publication before sending.',
    'OSCORE contexts, DTLS PSKs or certificate/client authentication require provisioning. TLS in these benchmarks authenticates the server only.',
  ],
  [
    'ESP32 & hardware',
    'Arduino/ESP-IDF starters exist. This dataset validates C on the host; physical qualification is pending.',
    'Embedded MQTT, nanopb, CoAP and Zephyr LwM2M are documented options; host tests do not qualify boards.',
  ],
  [
    'Operations',
    'Counter/replay durability, root rotation, monitoring and webhook delivery need operational validation.',
    'Broker sessions, application deduplication, availability and credential lifecycles also need design.',
  ],
]
</script>
<template>
  <section class="lab-panel lab-integration">
    <p class="lab-eyebrow">FROM BYTES TO AN INTEGRATION</p>
    <h2>What you need to ship it.</h2>
    <p class="lab-help">
      Product and protocol capabilities are different. Host integration was verified; hardware setup time and
      “ease” were not scored.
    </p>
    <div class="lab-table-scroll" tabindex="0">
      <table class="lab-table">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Struct implementation</th>
            <th scope="col">Other implementations</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row[0]">
            <th scope="row">{{ row[0] }}</th>
            <td>{{ row[1] }}</td>
            <td>{{ row[2] }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <details v-if="result?.sample && settings.security && settings.structGeneration !== 'v1'">
      <summary>Inspect the real generated C header for this schema</summary>
      <pre class="lab-code">{{ result.sample }}</pre>
      <p class="lab-help">
        This is real payload-generation output. Enroll a device, publish its schema slot and configure a
        persistent counter before using the transport. The lab sends no telemetry.
      </p>
    </details>
    <details v-if="result?.payloadHex && settings.security && result.status !== 'unsupported'">
      <summary>Send this sample with the real Node SDK</summary>
      <pre class="lab-code">{{ example }}</pre>
      <p class="lab-help">
        Illustration only; the lab does not execute this code. Keep credentials outside source control and use
        a durable counter. This is the current schema's actual encoded sample.
      </p>
    </details>
    <div class="lab-resource-links">
      <a
        href="https://github.com/CEMAMI09/Struct/blob/master/sdk/README.md"
        target="_blank"
        rel="noopener noreferrer"
        >SDK documentation ↗</a
      ><a
        href="https://github.com/CEMAMI09/Struct/tree/master/sdk/c/examples"
        target="_blank"
        rel="noopener noreferrer"
        >ESP32 starter projects ↗</a
      ><a
        href="https://github.com/CEMAMI09/Struct/blob/master/benchmarks/multi-protocol/reports/DEVELOPER-EXPERIENCE.md"
        target="_blank"
        rel="noopener noreferrer"
        >Integration research ↗</a
      >
    </div>
  </section>
</template>
