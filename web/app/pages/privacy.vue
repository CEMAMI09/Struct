<template>
  <div>
    <p class="doc-label">Legal</p>
    <h1 class="doc-title">Privacy Policy</h1>
    <p class="doc-updated">Last updated September 9, 2026</p>
    <p class="doc-lede">
      This page describes the information Struct collects when you use the website, dashboard, and
      device gateway, and how that information is used.
    </p>

    <section>
      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account.</strong> Email address, authentication credentials, and (if you use
          GitHub or Google sign-in) the identifier those providers send us.
        </li>
        <li>
          <strong>Organization.</strong> Workspace name, members, and roles (owner, admin, viewer).
        </li>
        <li>
          <strong>Devices and schemas.</strong> Device names, MAC addresses, tags, API keys, schema
          field definitions, optional encryption keys, and queued downlink commands.
        </li>
        <li>
          <strong>Telemetry.</strong> Authenticated uplink frames and the parsed JSON we store and
          show in the dashboard.
        </li>
        <li>
          <strong>Destinations.</strong> HTTPS webhook URLs you configure so we can forward parsed
          telemetry to your systems.
        </li>
        <li>
          <strong>Billing.</strong> Plan, device quantity, and Stripe customer identifiers needed to
          charge and show invoices. Card details are handled by Stripe, not stored in Struct.
        </li>
      </ul>
    </section>

    <section>
      <h2>How we use it</h2>
      <p>
        We use this information to run the service: authenticate you, accept and parse device
        frames, store telemetry for your plan’s retention window, send webhooks you configure, bill
        paid plans, and keep organization roles working.
      </p>
    </section>

    <section>
      <h2>Who processes it</h2>
      <ul>
        <li><strong>Supabase</strong> — account auth, database, and realtime dashboard updates.</li>
        <li><strong>Stripe</strong> — paid-plan checkout, invoices, and the customer portal.</li>
        <li><strong>GitHub and Google</strong> — optional sign-in, if you choose those buttons.</li>
      </ul>
      <p>
        If you add a destination, we send parsed telemetry to the URL you provide. That system is
        under your control, not ours.
      </p>
    </section>

    <section>
      <h2>Retention</h2>
      <p>
        Telemetry retention follows the plan shown on Pricing: 24 hours on Free, 7 days on Flexible,
        and 30 days on Pro. Scale and custom contracts can keep data longer. Account, organization,
        device, and schema records stay until you delete them or close the workspace.
      </p>
    </section>

    <section>
      <h2>Cookies and local storage</h2>
      <p>
        We store a session so you stay signed in. The dashboard also keeps a few UI preferences in
        the browser, such as whether the sidebar is collapsed. We do not use advertising cookies.
      </p>
    </section>

    <section>
      <h2>Your choices</h2>
      <p>
        You can update account and organization settings in the dashboard, delete devices and
        workspaces you own, and sign out. For access or deletion of remaining account data, email
        <a href="mailto:sales@struct.dev?subject=Privacy request">sales@struct.dev</a>.
      </p>
    </section>

    <p class="doc-switch">
      Also see the
      <NuxtLink to="/terms">Terms of Use</NuxtLink>.
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'doc' })

useSeoMeta({
  title: 'Privacy Policy — Struct',
  description: 'How Struct collects and uses account, device, telemetry, and billing information.',
})
</script>
