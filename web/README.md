# Struct web

Nuxt 4 dashboard, marketing site, auth, and Stripe billing routes for Struct.

For product overview, setup, environment variables, migrations, Stripe, and the TCP protocol, see the repository root [`README.md`](../README.md).

## Local development

```bash
cp .env.example .env
# fill Supabase + Stripe values from the root README

npm install
npm run dev
```

App: [http://127.0.0.1:3000](http://127.0.0.1:3000)

From the monorepo root you can also run:

```bash
npm run dev:web
npm run build:web
```

## Useful routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/signup`, `/login`, `/confirm` | Auth |
| `/dashboard` | Fleet overview and live telemetry |
| `/dashboard/devices` | Devices, tags, downlinks |
| `/dashboard/destinations` | Webhook destinations |
| `/dashboard/schema` | Packed schemas and encryption |
| `/dashboard/debugger` | Client-side packet simulator |
| `/dashboard/organization` | Workspaces and members |
| `/dashboard/settings` | Plans and billing |
| `/dashboard/audit-logs` | Scale-tier audit history |
