<script setup lang="ts">
import type { LabConfig, LabMetadata, ResearchSchema, RoiInput } from '#shared/protocol-lab/types'
const config = defineModel<LabConfig>({ required: true })
const roi = defineModel<RoiInput>('roi', { required: true })
defineProps<{ metadata: LabMetadata | null }>()
const emit = defineEmits<{ preset: [ResearchSchema]; reset: [] }>()
</script>
<template>
  <aside class="lab-sidebar" aria-label="Protocol Lab settings">
    <div class="lab-sidebar-top">
      <span>Experiment settings</span
      ><button type="button" class="lab-link" @click="emit('reset')">Reset</button>
    </div>
    <ProtocolLabSchemaEditor
      v-model="config.fields"
      :metadata="metadata"
      :optimized="config.settings.precision === 'optimized'"
      @preset="emit('preset', $event)"
      @reset="emit('reset')"
    />
    <section class="lab-settings-section">
      <h2>Transmission</h2>
      <label class="lab-toggle"
        ><span>Security<span class="lab-help">Authenticated encryption</span></span
        ><input v-model="config.settings.security" type="checkbox" aria-label="Security"
      /></label>
      <label class="lab-label"
        >Delivery<select v-model="config.settings.delivery" class="lab-input" aria-label="Delivery">
          <option value="unconfirmed">Unconfirmed</option>
          <option value="confirmed">Confirmed</option>
        </select></label
      >
      <label class="lab-label"
        >Precision<select v-model="config.settings.precision" class="lab-input" aria-label="Precision">
          <option value="original">Original precision</option>
          <option value="optimized">Optimized precision</option>
        </select></label
      >
      <p class="lab-help">
        Optimization requires explicit ranges and steps. Every serializer receives the same quantization.
      </p>
      <label class="lab-label" for="lab-batch"
        >Readings per batch <strong>{{ config.settings.batch }}</strong></label
      ><input
        id="lab-batch"
        v-model.number="config.settings.batch"
        type="range"
        min="1"
        max="100"
        class="lab-slider"
      /><input
        v-model.number="config.settings.batch"
        class="lab-input"
        type="number"
        min="1"
        max="100"
        aria-label="Readings per batch"
      />
      <label class="lab-label"
        >Traffic<select v-model="config.settings.traffic" class="lab-input" aria-label="Traffic">
          <option value="exchange">Full exchange</option>
          <option value="uplink">Uplink only</option>
        </select></label
      >
      <label class="lab-label"
        >Measurement boundary<select
          v-model="config.settings.boundary"
          class="lab-input"
          aria-label="Measurement boundary"
        >
          <option value="network">UDP/IP network estimate</option>
          <option value="application">Application protocol bytes</option>
          <option value="stream">TCP/TLS stream bytes</option>
        </select></label
      >
      <p class="lab-help">
        TCP/IP totals were not captured. MQTT/HTTPS show missing network data; switch boundary to inspect
        available bytes.
      </p>
    </section>
    <details class="lab-settings-section lab-advanced">
      <summary>Advanced settings</summary>
      <fieldset>
        <legend>Network &amp; connections</legend>
        <label class="lab-label"
          >IP version<select v-model="config.settings.network" class="lab-input" aria-label="IP version">
            <option>IPv4</option>
            <option>IPv6</option>
          </select></label
        >
        <label class="lab-label"
          >Path MTU (bytes)<input
            v-model.number="config.settings.mtu"
            type="number"
            min="576"
            max="9000"
            class="lab-input"
            aria-label="Path MTU"
        /></label>
        <p class="lab-help">
          Above MTU: network totals unavailable. No invented fragmentation. Struct IPv6 is unsupported.
        </p>
        <label class="lab-label"
          >Connection behavior<select
            v-model="config.settings.connection"
            class="lab-input"
            aria-label="Connection behavior"
          >
            <option value="persistent">Persistent / steady state</option>
            <option value="fresh">New connection per transmission</option>
            <option value="periodic">Reconnect periodically</option>
          </select></label
        >
        <label v-if="config.settings.connection === 'periodic'" class="lab-label"
          >Messages per connection<input
            v-model.number="config.settings.messagesPerConnection"
            type="number"
            min="1"
            max="1000000"
            class="lab-input"
        /></label>
        <label class="lab-check"
          ><input v-model="config.settings.includeSetup" type="checkbox" />Include measured session
          costs</label
        >
        <p class="lab-help">
          Session references require matching settings (original schema, topic “t”, and tested reuse counts).
          Persistent mode excludes setup.
        </p>
        <label class="lab-label"
          >TLS version<select v-model="config.settings.tls" class="lab-input">
            <option>TLSv1.3</option>
            <option>TLSv1.2</option>
          </select></label
        >
        <p class="lab-unavailable">
          TLS resumption, mTLS, arbitrary keepalive duration and DTLS 1.3: not tested. DTLS 1.2 is available
          through LwM2M references.
        </p>
      </fieldset>
      <fieldset>
        <legend>MQTT &amp; serializers</legend>
        <label class="lab-label"
          >MQTT version<select v-model.number="config.settings.mqttVersion" class="lab-input">
            <option :value="5">5.0</option>
            <option :value="4">3.1.1</option>
          </select></label
        >
        <label class="lab-label"
          >MQTT QoS<select v-model="config.settings.qos" class="lab-input" aria-label="MQTT QoS">
            <option value="auto">Follow delivery setting</option>
            <option :value="0">0 — no publish acknowledgment</option>
            <option :value="1">1 — PUBACK</option>
            <option :value="2">2 — QoS2 exchange</option>
          </select></label
        >
        <label class="lab-label"
          >Publish topic<input
            v-model="config.settings.topic"
            class="lab-input"
            aria-label="MQTT topic"
            maxlength="1024"
        /></label>
        <label class="lab-check"
          ><input
            v-model="config.settings.mqttProperties"
            type="checkbox"
            :disabled="config.settings.mqttVersion !== 5"
          />Benchmarked MQTT 5 properties</label
        >
        <p class="lab-help">Properties: schema=environment-v1, content type=application/octet-stream.</p>
        <label class="lab-label"
          >Protobuf first field number<input
            v-model.number="config.settings.protobufFieldStart"
            class="lab-input"
            type="number"
            min="1"
            max="1000"
        /></label>
        <label class="lab-check"
          ><input v-model="config.settings.protobufPacked" type="checkbox" />Protobuf packed repeated
          scalars</label
        >
        <label class="lab-label"
          >JSON layout<select v-model="config.settings.jsonEncoding" class="lab-input">
            <option value="json-compact">Compact named object</option>
            <option value="json-standard">Spaced named object</option>
            <option value="json-array">Positional array</option>
          </select></label
        >
        <label class="lab-label"
          >JSON transport<select v-model="config.settings.jsonTransport" class="lab-input">
            <option value="mqtt">MQTT</option>
            <option value="https">HTTPS / HTTP 1.1</option>
          </select></label
        >
        <label class="lab-label"
          >CBOR layout<select v-model="config.settings.cborEncoding" class="lab-input">
            <option value="cbor-array">Positional array</option>
            <option value="cbor-canonical">Canonical named map</option>
            <option value="cbor-integer-keys">Integer-keyed map</option>
          </select></label
        >
        <label class="lab-label"
          >HTTP compression<select
            v-model="config.settings.compression"
            class="lab-input"
            :disabled="config.settings.jsonTransport !== 'https'"
          >
            <option value="off">Off</option>
            <option value="gzip">Gzip</option>
          </select></label
        >
        <p class="lab-help">
          Gzip is an HTTPS body feature. Struct has no native compression. Brotli/zlib payload experiments are
          in the reference dataset.
        </p>
      </fieldset>
      <fieldset>
        <legend>CoAP &amp; LwM2M</legend>
        <label class="lab-label"
          >CoAP serialization<select v-model="config.settings.coapEncoding" class="lab-input">
            <option value="cbor-array">CBOR positional</option>
            <option value="cbor-canonical">CBOR named map</option>
            <option value="json-compact">Compact JSON</option>
            <option value="protobuf">Protobuf</option>
          </select></label
        >
        <label class="lab-label"
          >Token length<input
            v-model.number="config.settings.coapToken"
            type="number"
            min="0"
            max="8"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Resource path<input v-model="config.settings.coapPath" class="lab-input"
        /></label>
        <label class="lab-label"
          >OSCORE profile<select v-model="config.settings.oscore" class="lab-input">
            <option>ChaCha20/Poly1305</option>
            <option>AES-CCM-16-128-128</option>
            <option>AES-CCM-16-64-128</option>
          </select></label
        >
        <label class="lab-label"
          >OSCORE sender sequence<input
            v-model.number="config.settings.oscoreSequence"
            type="number"
            min="0"
            max="4294967295"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >LwM2M content format<select v-model="config.settings.lwm2mFormat" class="lab-input">
            <option>SENML_CBOR</option>
            <option>SENML_JSON</option>
            <option>TLV</option>
          </select></label
        >
        <p class="lab-unavailable">
          Observe, blockwise, TLV Read, registration/update and alternative retry timing are reference
          experiments, not custom-schema traffic models.
        </p>
      </fieldset>
      <fieldset>
        <legend>Measured impairment references</legend>
        <label class="lab-label"
          >Packet loss<select v-model.number="config.settings.loss" class="lab-input">
            <option v-for="loss in [0, 0.001, 0.01, 0.02, 0.05, 0.1]" :key="loss" :value="loss">
              {{ loss * 100 }}%
            </option>
          </select></label
        >
        <label class="lab-label"
          >One-way latency reference<select v-model.number="config.settings.latency" class="lab-input">
            <option v-for="n in [0, 10, 25, 50]" :key="n" :value="n">{{ n }} ms</option>
          </select></label
        >
        <p class="lab-help">
          Nonzero settings withhold custom traffic/ROI totals. Inspect actual loss, latency and jitter runs in
          Research Explorer below.
        </p>
      </fieldset>
    </details>
    <details class="lab-settings-section" :open="roi.enabled">
      <summary>Fleet &amp; connectivity ROI</summary>
      <label class="lab-check"
        ><input v-model="roi.enabled" type="checkbox" aria-label="Enable ROI" />Enable cost scenario</label
      >
      <template v-if="roi.enabled">
        <label class="lab-label"
          >Active devices<input
            v-model.number="roi.devices"
            type="number"
            min="0"
            max="1000000000"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Events / device / day<input
            v-model.number="roi.eventsPerDay"
            type="number"
            min="0"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Operating days / year<input
            v-model.number="roi.daysPerYear"
            type="number"
            min="0"
            max="366"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Cellular share of all events (%)<input
            v-model.number="roi.cellularPercent"
            type="number"
            min="0"
            max="100"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Current architecture<select v-model="roi.baseline" class="lab-input">
            <option
              v-for="(label, id) in {
                struct: 'Struct',
                protobuf: 'Protobuf',
                coap: 'CoAP',
                lwm2m: 'LwM2M',
                json: 'JSON',
                cbor: 'CBOR',
              }"
              :key="id"
              :value="id"
            >
              {{ label }}
            </option>
          </select></label
        >
        <label class="lab-label"
          >Measured current network bytes / event (optional)<input
            :value="roi.measuredBytesPerEvent ?? ''"
            type="number"
            min="0"
            class="lab-input"
            @input="
              roi.measuredBytesPerEvent =
                ($event.target as HTMLInputElement).value === ''
                  ? null
                  : Number(($event.target as HTMLInputElement).value)
            "
        /></label>
        <label class="lab-label"
          >Measured current cellular MB / month (optional)<input
            :value="roi.measuredMBPerMonth ?? ''"
            type="number"
            min="0"
            class="lab-input"
            @input="
              roi.measuredMBPerMonth =
                ($event.target as HTMLInputElement).value === ''
                  ? null
                  : Number(($event.target as HTMLInputElement).value)
            "
        /></label>
        <label class="lab-label"
          >Billing model<select v-model="roi.billing" class="lab-input">
            <option value="metered">Metered usage</option>
            <option value="flat">Flat rate</option>
          </select></label
        >
        <label class="lab-label"
          >Currency<select v-model="roi.currency" class="lab-input">
            <option>USD</option>
            <option>EUR</option>
            <option>GBP</option>
            <option>CAD</option>
            <option>AUD</option>
          </select></label
        >
        <label class="lab-label"
          >Cost / decimal MB<input
            v-model.number="roi.costPerMB"
            type="number"
            min="0"
            step="any"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Monthly minimum / device<input
            v-model.number="roi.minimumPerDevice"
            type="number"
            min="0"
            step="any"
            class="lab-input"
        /></label>
        <label class="lab-label"
          >Billing increment / logical event (bytes)<input
            v-model.number="roi.incrementBytes"
            type="number"
            min="0"
            class="lab-input"
        /></label>
        <p class="lab-help">
          Zero means no rounding. Per-event rounding is an explicit scenario assumption, not a carrier session
          model. The initial cost/MB is an editable example, not a provider quote. Costs exclude Struct
          subscriptions.
        </p>
      </template>
    </details>
  </aside>
</template>
