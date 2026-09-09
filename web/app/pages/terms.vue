<template>
  <div>
    <p class="doc-label">Legal</p>
    <h1 class="doc-title">Terms of Use</h1>
    <p class="doc-updated">Last updated September 9, 2026</p>
    <p class="doc-lede">
      These terms cover use of the Struct website, dashboard, and device gateway. If you create an
      account or send traffic to Struct, you agree to them.
    </p>

    <section>
      <h2>The service</h2>
      <p>
        Struct authenticates packed binary telemetry, resolves the schema, stores parsed values, and
        can forward JSON to HTTPS destinations you configure. UDP and TCP ingestion, optional
        payload encryption, downlinks, and plan limits are described on the product site. Features
        marked as plan-specific are not included on every account.
      </p>
    </section>

    <section>
      <h2>Accounts</h2>
      <p>
        You must provide a working email (or a GitHub/Google identity) and keep credentials and
        device API keys secret. You are responsible for activity under your account, devices, and
        organizations, including traffic sent with those keys.
      </p>
    </section>

    <section>
      <h2>Acceptable use</h2>
      <p>Do not use Struct to:</p>
      <ul>
        <li>probe, disrupt, or overload the gateway or other customers</li>
        <li>bypass authentication, replay protection, or billing limits</li>
        <li>send unlawful, harmful, or infringing content through uplinks or webhooks</li>
        <li>resell the service except under a written agreement with us</li>
      </ul>
    </section>

    <section>
      <h2>Plans and billing</h2>
      <p>
        Free accounts are limited as shown on Pricing. Paid plans are billed through Stripe. Device
        counts, retention, encryption, downlinks, and team features follow the plan in effect.
        Usage beyond included capacity can incur additional device charges described on Pricing.
      </p>
    </section>

    <section>
      <h2>Availability</h2>
      <p>
        We aim to keep ingestion and the dashboard running, but these public terms do not include a
        service-level agreement. Enterprise terms, if any, are separate.
      </p>
    </section>

    <section>
      <h2>Disclaimer</h2>
      <p>
        The service is provided as-is. We do not warrant that Struct will be uninterrupted, error
        free, or fit for a particular deployment. You are responsible for device firmware, radio
        conditions, and systems that receive your webhooks.
      </p>
    </section>

    <section>
      <h2>Changes</h2>
      <p>
        We may update these terms. The date at the top of this page is the current version. Continued
        use after an update means you accept the revised terms.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>
        Questions:
        <a href="mailto:sales@struct.dev?subject=Terms of Use">sales@struct.dev</a>.
      </p>
    </section>

    <p class="doc-switch">
      Also see the
      <NuxtLink to="/privacy">Privacy Policy</NuxtLink>.
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'doc' })

useSeoMeta({
  title: 'Terms of Use — Struct',
  description: 'Terms for using the Struct website, dashboard, and device gateway.',
})
</script>
