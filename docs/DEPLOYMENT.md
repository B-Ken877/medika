# Medika — Deployment Runbook (single Vercel project + managed PostgreSQL)

This runbook takes the repository from a fresh clone to a production deployment
on Vercel with managed PostgreSQL, and covers the DNS cutover that keeps the
existing Android apps working without an APK update.

> Read `docs/VERCEL_MIGRATION_AUDIT.md` first for the architecture rationale
> and the full risk list.

---

## 1. Architecture being deployed

The whole platform — patient/doctor PWA, admin panel and Express API — runs as
ONE Vercel project using **Vercel Services** (path-based routing of multiple
independently-built apps inside a single project; public beta since June 2026):

```
Vercel project "medika" (single project, Vercel Services)
  service web   ← medika-web/   → served at /           Next.js 14 patient/doctor PWA
  service admin ← medika-admin/ → served at /admin/*    Next.js 14 admin (basePath /admin)
  service api   ← repo root     → served at /api/*, /payment/*, /uploads/*, /ws
                                                     Express REST + WebSocket, one Function
Managed PostgreSQL (Neon / Supabase / RDS…)       ← DATABASE_URL
Vercel Blob                                       ← BLOB_READ_WRITE_TOKEN (uploads)
ZEGOCLOUD WebRTC (ZEGO cloud)                     ← ZEGOCLOUD_APP_ID / SERVER_URL / SERVER_SECRET
MonCash REST (Digicel)                            ← MONCASH_CLIENT_ID / SECRET
Optional Redis (Upstash)                          ← REDIS_URL (cross-instance WS fan-out)
```

Routing is declared by the top-level `rewrites` in `vercel.json` (evaluated in
order, first match wins; the matched service receives the ORIGINAL request
path):

| Request                 | Service | Served by |
|---|---|---|
| `/` and everything not matched below | `web` | medika-web — Next.js pages, PWA assets (`/sw.js`, `/manifest.webmanifest`, icons) |
| `/admin`, `/admin/*`    | `admin` | medika-admin — Next.js with `basePath: "/admin"` |
| `/api`, `/api/*`        | `api`  | Express — REST routers + canonical `/api/payment/*` |
| `/payment`, `/payment/*`| `api`  | Express — legacy MonCash mount `/payment/api/payment/*`, simulated page |
| `/uploads`, `/uploads/*`| `api`  | Express — 302 → `LEGACY_UPLOADS_ORIGIN` (or local static in dev) |
| `/ws` (WebSocket upgrade) | `api` | Express + `ws` hub (server-attached, path `/ws`) |

Why this shape:

- **One origin for the browser** — the PWA and the admin panel call `/api`,
  `/payment`, `/uploads` and `wss://…/ws` with same-origin relative URLs; the
  platform router sends them straight to the api service. No CORS setup, no
  cross-project proxy hop, no `API_ORIGIN` build-time coupling (the old
  three-project design is gone). No proxy loop is possible: every rewrite
  destination is a `{ "service": … }` object, never a URL.
- **Byte-compatible paths** — services receive the original request path, so
  every Express mount (`/api/*`, `/payment/api/payment/*`, `/uploads/*`, `/ws`)
  answers exactly like the legacy deployment. That is what lets Android keep
  working after DNS cutover, and what keeps the PWA/admin clients unchanged.
- **Atomic deploys** — the three apps build separately but deploy, preview and
  roll back together as one deployment.

Why one Function for REST + WS: the official Vercel "Express on Vercel" +
"WebSockets on Vercel Functions" guides — a root `server.js` entry exporting
the HTTP server (Express app as listener + `ws` WebSocketServer attached).
WebSocket support on Vercel Functions is itself a public beta (since June
2026) and requires Fluid Compute (the default for projects created after
April 2025): connections are pinned to one function instance and close at the
function's max duration — **300 s** here, the value the clients' reconnect +
re-authenticate-with-catch-up logic is tuned for. Cross-instance fan-out needs
`REDIS_URL` (e.g. Upstash); without it the hub is single-instance (fine for
dev and small deployments). For an always-on `/ws` with no duration ceiling,
deploy `realtime/server.js` on any persistent-process host and point
`NEXT_PUBLIC_WS_URL` at it instead.

---

## 2. Provision the database

1. Create a managed PostgreSQL database (Neon, Supabase, RDS…). Note the
   connection string. Prefer TLS (`sslmode=require`).
2. Create a **least-privilege application role**:
   - The app role needs: `SELECT/INSERT/UPDATE/DELETE` on the Medika tables +
     `CREATE` on `public` during migrations.
   - Migrations run as a separate owner role (e.g. from your workstation or CI
     with the admin URL), so the runtime role never owns the schema.
   - With Neon/Supabase the default role is fine to start; harden before real
     patient data flows.
3. Apply migrations and seed reference data:

   ```bash
   DATABASE_URL="postgres://…" \
   ADMIN_USERNAME="admin" ADMIN_PASSWORD="<generate-a-strong-one>" \
   node scripts/migrate.js
   ```

   This creates the schema (all constraints + indexes), seeds the 20
   specialties from `specialties.json`, and ensures the admin account exists
   (the password is never logged).

## 3. Migrate the legacy JSON data (from the VPS)

> The legacy `data/*.json` files contain **real patient data**. Copy them over
> SSH, keep them encrypted at rest, and never commit them to the repository
> (`data/` is gitignored).

```bash
# on your workstation, from the VPS:
scp root@<vps>:/root/medika-backend/data ./legacy-data

# dry-run first — prints counts without writing:
DATABASE_URL="postgres://…" DATA_DIR=./legacy-data node scripts/import-json-data.js --dry-run

# real import (idempotent, re-runnable; JSON files are never modified):
DATABASE_URL="postgres://…" DATA_DIR=./legacy-data node scripts/import-json-data.js

# verify: row counts + referential integrity + uniqueness:
DATABASE_URL="postgres://…" DATA_DIR=./legacy-data node scripts/smoke-verify.js
```

Rollback plan: the JSON files are untouched and remain the source of truth
until you explicitly retire them. Keep backups of both (see §8). **Do not
delete the legacy JSON files until the migration has been verified and the
team signs off.**

Note: legacy consultations have no `payments` rows (the old backend never
recorded payments). Historical finance reports stay price-based exactly like
the legacy server; only new consultations are payment-gated.

## 4. Deploy the single Vercel project ("medika")

1. In Vercel: **Add New → Project → Import** the Git repository.
   **Root Directory = repository root** (the root contains `server.js`,
   `package.json` and the `vercel.json` with the `services` block).
2. Framework preset: **Services**. A project builds as services only when the
   project framework is set to "Services" AND `vercel.json` contains a
   `services` key — if either is missing, Vercel falls back to plain framework
   detection and **silently ignores** the services configuration (the
   deployment then behaves like the Express-only API of October 2026: `/`
   answers the API's French 404 JSON instead of the PWA). Set it under
   **Project Settings → Build & Deployment → Framework Preset → Services**.
   Do NOT add a top-level `framework` key to `vercel.json` — it is invalid
   once `services` is present and the deployment is rejected instantly
   (observed 2026-10).

   **Existing "medika" project**: flip the preset in Project Settings → Build
   & Deployment → Framework Preset → **Services**. Flipping it while `main`
   has no `services` key is safe (plain detection is used and the current
   Express-only behavior is preserved); it takes effect with the first deploy
   of the consolidation branch.

   **Express entry contract (deployment incident 2026-10):** the Express
   preset picks the entry by scanning `app` / `index` / `server` (root, then
   `src/`) candidates **in that order**, and only accepts candidates that
   import the `express` package *directly* (regex on the file source,
   `@vercel/express` `findEntrypoint`). `server.js` satisfies the contract:
   it `require`s `express` itself and exports the composed `http.Server`
   (Express listener + `/ws` WebSocketServer) — the runtime accepts "a
   function or server", and the server shape is what keeps WebSocket
   upgrades working. The application factory lives at `src/create-app.js`
   precisely so it is *not* an entrypoint candidate: an earlier layout with
   the factory at `src/app.js` got that file auto-selected instead (it
   imports `express` but exports `{ createApp }`), producing
   `Invalid export found in module "/var/task/src/app.js". The default
   export must be a function or server.` and HTTP 500 on every request.
   `tests/vercel-entrypoint.test.js` regression-checks this contract
   (entry = `server.js`, sole matching candidate, `package.json#main`,
   api-service `functions` key, export shape), and
   `tests/vercel-services.test.js` pins the routing table.
3. Environment variables (Production + Preview — see `.env.example` for the
   full annotated list). These are project-level and reach every service;
   only the api service reads them:

   | Variable | Notes |
   |---|---|
   | `DATABASE_URL` | from §2, TLS |
   | `JWT_SECRET` | generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `ZEGOCLOUD_APP_ID` / `ZEGOCLOUD_SERVER_URL` / `ZEGOCLOUD_SERVER_SECRET` | ZEGO project credentials for this scope; secret is server-only (32 chars) |
   | `MONCASH_MODE` / `MONCASH_CLIENT_ID` / `MONCASH_CLIENT_SECRET` | from the MonCash business portal |
   | `REQUIRE_PAYMENT` | `true` (default in production) — consultations require verified payment |
   | `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob |
   | `LEGACY_UPLOADS_ORIGIN` | e.g. `https://medikahaiti.site` while old uploads live on the VPS |
   | `REDIS_URL` | optional (Upstash) — recommended once you expect >1 concurrent function instance |
   | `CORS_ORIGINS` | browser origins allowed cross-origin. The PWA (`/`) and admin (`/admin`) are **same-origin** with the API now, so it stays **unset in production** (fail-closed); native apps send no Origin and are always allowed. |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | only used by `scripts/migrate.js` seeding, not by the runtime |

   No `API_ORIGIN` / `NEXT_PUBLIC_WS_URL` / `NEXT_PUBLIC_API_BASE_URL` values
   are needed any more (see §5).
4. Deploy. Sanity checks against `https://<project>.<team>.vercel.app`:

   ```bash
   curl -s https://…/api/health          # → {"status":"ok",…}
   curl -s -o /dev/null -w '%{content_type}\n' https://…/   # → text/html (the PWA, NOT the API's 404 JSON)
   curl -s -o /dev/null -w '%{http_code}\n' https://…/admin # → 200 (the admin login page)
   # login should return a three-segment JWT:
   curl -s -X POST https://…/api/auth/login -H 'Content-Type: application/json' \
        -d '{"username":"…","password":"…"}'
   ```

5. WebSocket check (needs a valid token):

   ```js
   // node -e with the 'ws' package, or the browser console on the PWA
   const ws = new WebSocket("wss://…/ws");
   ws.onopen = () => ws.send(JSON.stringify({type:"auth", token:"<jwt>"}));
   ws.onmessage = (e) => console.log(e.data); // → {"type":"auth:ok",…}
   ```

## 5. Frontend services — no build-time configuration

`medika-web` (service `web`) and `medika-admin` (service `admin`) are part of
the same deployment and need **no** build-time environment variables:

- The browser calls `/api`, `/payment` and `/uploads` with same-origin
  relative URLs; the platform's top-level rewrites route them straight to the
  api service — those requests never pass through the Next.js servers, so
  nothing has to be proxied from the frontends.
- The WebSocket client (`medika-web/lib/ws/socket.ts`) defaults to
  `wss://<host>/ws` (same origin); the platform routes the `/ws` upgrade to
  the api service. `NEXT_PUBLIC_WS_URL` stays unset — it remains available as
  an explicit override (e.g. pointing at the standalone `realtime/server.js`
  host).
- `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_PAYMENT_BASE_URL` stay empty
  (same-origin).
- The admin panel keeps `basePath: "/admin"` — the platform forwards
  `/admin/*` with the original path preserved, exactly what a basePath'd
  Next.js app expects.
- `API_ORIGIN` (the old cross-project proxy variable) is gone: the
  `next.config.mjs` files no longer read it, and setting it has no effect.

Both `next.config.mjs` files keep a **local-development** proxy only
(`DEV_BACKEND_ORIGIN` / `DEV_PAYMENT_ORIGIN`, defaulting to `localhost:3000`
/ `localhost:9998`) that mirrors the production routing for `npm run dev`.

Verify a frontend build locally the same way CI-quality checks do:
`npm test && npm run typecheck && npm run build` inside `medika-web/`, and
`npm run build` inside `medika-admin/`.

## 6. DNS cutover (keeps Android working without an APK update)

The Android app has `https://medikahaiti.site/` compiled in. Point
`medikahaiti.site` at the **single Vercel project** (Vercel → project
"medika" → Domains → Add). Every path the app uses is served by it:
`/api/*`, `/payment/*`, `/uploads/*` and `/ws` hit the api service; `/` and
`/admin` serve the web and admin apps.

During the transition the VPS should keep serving:
- `/token` (Agora token server for Android calls — **not part of this repo**;
  port it separately or keep the VPS path alive)
- `/uploads/*` legacy files (the API 302-redirects `/uploads/*` there via
  `LEGACY_UPLOADS_ORIGIN` until files are synced to Vercel Blob)

Cutover checklist:

1. Migrations imported + `smoke-verify` PASSED (§3).
2. JWT auth live → **all existing sessions invalidate once**; users re-login
   (Android login flow is unchanged — see `docs/ANDROID_COMPATIBILITY.md`).
3. MonCash sandbox tested end-to-end (§7) before production keys.
4. `REQUIRE_PAYMENT=true` verified with a real sandbox payment.
5. WS reconnects observed (Vercel closes connections at the function's max
   duration — clients already reconnect and re-authenticate with catch-up).

## 7. MonCash rollout notes

- Sandbox first: `MONCASH_MODE=sandbox` + sandbox credentials from the MonCash
  business portal. Complete a real sandbox payment through the PWA consult
  flow and confirm the payment row reaches `PAID`.
- The provider's retrieved-transaction `status` vocabulary is normalized in
  `src/moncash.js` (success values include `successful`, `completed`, …, and
  unknown values fail closed). Confirm the exact sandbox strings during this
  test and adjust `SUCCESS_STATUSES` if needed.
- Production: switch `MONCASH_MODE=production` + production credentials.
  Verification is pull-based (`RetrieveOrderPayment` / by transactionId);
  handle MonCash's business return URL by pointing it at the PWA.

### Simulated payments on authorized testing deployments

`PAYMENT_SIMULATION=true` enables a strictly isolated simulated-payment path
so the complete patient → doctor consultation workflow can be tested without a
real MonCash transaction. The server records clearly-identified simulated
payments (`payments.simulated = true`, `SIM-…` transaction ids) and the web
payment step shows an explicit test-mode notice ("Mòd tès la aktive…") instead
of opening MonCash.

Production protection (fail closed, enforced server-side):

- Vercel Production deployments (`VERCEL_ENV=production`) **refuse to boot**
  with `PAYMENT_SIMULATION` set, and the runtime gate rejects simulated
  operations even if the boot guard were bypassed.
- Preview deployments build with `NODE_ENV=production`; `VERCEL_ENV`
  (platform-injected, not overridable from project settings) is the
  authoritative stage signal. Unknown `VERCEL_ENV` values are treated as
  production — simulation stays disabled.
- Client-supplied flags (query params, body fields) are never trusted as
  authorization; only the server-side environment decides.

Enable for preview testing: Vercel Project "medika" → Settings → Environment
Variables → add `PAYMENT_SIMULATION=true` scoped to **Preview** only. Disable
(remove the variable) to restore the ordinary MonCash flow — no code change,
no migration, nothing else to clean up.

## 8. Backups & data protection

- Managed PostgreSQL: enable the provider's PITR / scheduled backups before
  loading real patient data.
- Keep the legacy JSON files encrypted until decommission sign-off.
- Do not log medical data: the backend logs ids and error categories only
  (enforced by the error middleware and the WS hub).
- `GET /api/health` is the only unauthenticated endpoint that reveals uptime.

## 9. Rollback

- **Deployment-level (seconds):** Vercel → project "medika" → Deployments →
  the last known-good deployment → **Promote**. The pre-consolidation
  Express-only deployment remains promotable for as long as you need it; the
  database schema is untouched by the consolidation (no migrations in this
  change).
- **Code-level:** `git revert` the consolidation merge commit on `main` —
  the previous `vercel.json` (single Express function) is restored with it.
- Both paths restore the exact previous routing (Express answering
  `/api/*`, `/payment/*`, `/uploads/*`, `/ws` — plus its French 404 on `/`).

## 10. Remaining manual configuration and security tasks

These are **not** done by this migration and require a human decision:

1. **Rotate every previously committed credential** (audit C3/C4): VPS SSH
   password, admin password, Zego/Agora app IDs if concerned. (The LiveKit
   key/secret that was once committed is moot since issue #66 removed
   LiveKit entirely — ZEGOCLOUD is the sole call provider.)
2. **Upload privacy**: new uploads go to public Blob URLs (unguessable but
   unauthenticated). For per-consultation access control, move to private
   blobs + an authenticated streaming route (note the 4.5 MB function
   response limit) or signed URLs.
3. **Edge-level login throttling**: the in-app limiter is per-instance only;
   add Vercel WAF rules or provider rate limits for `/api/auth/*`.
4. **Vercel WS beta limits**: 300 s per connection (5 min reconnect cycle),
   cross-instance fan-out needs `REDIS_URL`. If unacceptable, deploy
   `realtime/server.js` on an always-on host instead and point
   `NEXT_PUBLIC_WS_URL` at it.
5. **`/token` (Agora)**: still served from wherever it lives today; port it
   into the API (or finish the Android ZEGOCLOUD cutover) as a follow-up.
6. **Android WS-fallback chat** needs an app update to send the JWT auth
   frame (ZIM primary chat is unaffected) — see
   `docs/ANDROID_COMPATIBILITY.md`.
7. **Cross-client calls**: Android (ZEGOCLOUD UIKit) and web (ZEGOCLOUD
   Express Web SDK) now share the same provider; actual cross-client
   interop (same ZEGO project + room conventions) still needs an
   owner-side verification.
8. **Password policy**: minimum length is 4 for Android compatibility;
   raising it requires a coordinated client update.
9. Confirm MonCash status vocabulary in sandbox (§7).
10. Monitoring/alerting (uptime + DB + payment success rate) is not included.
11. **Vercel Services & WebSockets are public betas**: pin expectations —
    routing semantics (original-path forwarding, per-service final routing)
    are regression-tested in `tests/vercel-services.test.js`, but platform
    behavior may change during the beta; re-run that suite (plus the endpoint
    sanity checks in §4.4) after significant Vercel platform updates.

## 11. Local development

```bash
# backend (auto-creates nothing; point at any local Postgres)
DATABASE_URL=postgres://medika:medika@localhost:5432/medika \
ADMIN_USERNAME=admin ADMIN_PASSWORD=admin-dev-only \
SEED_DEMO=true npm run migrate
npm start                      # REST :3000 + WS /ws

# backend tests (embedded PostgreSQL, no external services)
npm test

# web PWA (proxies /api,/uploads to :3000, /payment to :9998)
cd medika-web && npm run dev  # http://localhost:4100
#   (WS: set NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws in .env.local —
#    Next dev rewrites cannot proxy WebSocket upgrades)

# admin panel (proxies /api to :3000; basePath /admin)
cd medika-admin && npm run dev  # http://localhost:4000/admin
```
