# Medika — Deployment Runbook (Vercel + Managed PostgreSQL)

This runbook takes the repository from a fresh clone to a production deployment
on Vercel with managed PostgreSQL, and covers the DNS cutover that keeps the
existing Android apps working without an APK update.

> Read `docs/VERCEL_MIGRATION_AUDIT.md` first for the architecture rationale
> and the full risk list.

---

## 1. Architecture being deployed

```
Vercel project "medika-api"  (repo root)          ← Express REST + /ws WebSocket, one Function
Vercel project "medika-web"  (medika-web/)        ← patient/doctor PWA; proxies /api,/payment,/uploads
Vercel project "medika-admin" (medika-admin/)     ← admin panel; proxies /api
Managed PostgreSQL (Neon / Supabase / RDS…)       ← DATABASE_URL
Vercel Blob                                       ← BLOB_READ_WRITE_TOKEN (uploads)
LiveKit (Cloud or self-hosted, TLS)               ← LIVEKIT_URL / API key / secret (ROTATED)
MonCash REST (Digicel)                            ← MONCASH_CLIENT_ID / SECRET
Optional Redis (Upstash)                          ← REDIS_URL (cross-instance WS fan-out)
```

Why one Function for REST + WS: the official Vercel "Express on Vercel" +
"WebSockets on Vercel Functions" guides — a root `server.js` entry exporting
the HTTP server (Express app as listener + `ws` WebSocketServer attached).
All route paths and the `/ws` protocol are byte-compatible with the legacy
deployment, which is what lets Android keep working after DNS cutover.

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
until you explicitly retire them. Keep backups of both (see §9). **Do not
delete the legacy JSON files until the migration has been verified and the
team signs off.**

Note: legacy consultations have no `payments` rows (the old backend never
recorded payments). Historical finance reports stay price-based exactly like
the legacy server; only new consultations are payment-gated.

## 4. Deploy the API project (`medika-api`)

1. In Vercel: **Add New → Project → Import** the Git repository.
   Set **Root Directory = repository root** (the repo root contains
   `server.js`, `package.json`, `vercel.json`).
2. Framework preset: **Express** (auto-detected from the `express`
   dependency in `package.json`; confirm it if the import flow guessed
   something else). Do NOT pick "Other / no framework" — the Express preset
   is what wires the catch-all route that sends every request path
   (`/api/*`, `/payment/*`, `/uploads/*`, `/ws` upgrades) to the single
   Function.

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
   `vercel.json` `functions` key, export shape).
3. Environment variables (Production + Preview — see `.env.example` for the
   full annotated list):

   | Variable | Notes |
   |---|---|
   | `DATABASE_URL` | from §2, TLS |
   | `JWT_SECRET` | generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **rotated** credentials; `wss://` public URL |
   | `MONCASH_MODE` / `MONCASH_CLIENT_ID` / `MONCASH_CLIENT_SECRET` | from the MonCash business portal |
   | `REQUIRE_PAYMENT` | `true` (default in production) — consultations require verified payment |
   | `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob |
   | `LEGACY_UPLOADS_ORIGIN` | e.g. `https://medikahaiti.site` while old uploads live on the VPS |
   | `REDIS_URL` | optional (Upstash) — recommended once you expect >1 concurrent function instance |
   | `CORS_ORIGINS` | browser origins allowed cross-origin (the PWA/admin are same-origin via proxy; native apps don't need it). **Unset in production = cross-origin browsers denied (fail-closed)** |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | only used by `scripts/migrate.js` seeding, not by the runtime |

4. Deploy. Sanity checks against `https://medika-api.<team>.vercel.app`:

   ```bash
   curl -s https://…/api/health
   curl -s https://…/api/specialties/prices | head -c 200
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

## 5. Deploy the web PWA (`medika-web`)

1. Second Vercel project from the same repo, **Root Directory = `medika-web`**.
2. Build-time environment variables:
   - `API_ORIGIN` = `https://medika-api.<team>.vercel.app` (proxies `/api`,
     `/payment`, `/uploads` through the Next server — same-origin for browsers)
   - `NEXT_PUBLIC_WS_URL` = `wss://medika-api.<team>.vercel.app/ws`
     (WebSocket upgrades cannot be proxied by Next.js rewrites)
3. Run a production build locally once with the same env to verify:
   `npm test && npm run typecheck && npm run build` inside `medika-web/`.

## 6. Deploy the admin panel (`medika-admin`)

1. Third Vercel project, **Root Directory = `medika-admin`**, build-time
   `API_ORIGIN` = the API origin. `basePath` stays `/admin`.
2. Log in with the admin account created in §2 (JWT; stored in localStorage).

## 7. DNS cutover (keeps Android working without an APK update)

The Android app has `https://medikahaiti.site/` compiled in. Two options:

- **Recommended**: point `medikahaiti.site` at Vercel (Vercel → Domains → Add),
  and make the web PWA project serve the apex/`www`. The PWA already proxies
  `/api`, `/payment` and `/uploads` to the API project, so Android's REST +
  payment flows hit the same paths as before.
- **Gradual**: keep nginx on the VPS as a reverse proxy to the Vercel API
  during a transition window, then cut over.

During the transition the VPS should keep serving:
- `/token` (Agora token server for Android calls — **not part of this repo**;
  port it separately or keep the VPS path alive)
- `/uploads/*` legacy files (the API 302-redirects `/uploads/*` there via
  `LEGACY_UPLOADS_ORIGIN` until files are synced to Vercel Blob)

Cutover checklist:

1. Migrations imported + `smoke-verify` PASSED (§3).
2. JWT auth live → **all existing sessions invalidate once**; users re-login
   (Android login flow is unchanged — see `docs/ANDROID_COMPATIBILITY.md`).
3. MonCash sandbox tested end-to-end (§8) before production keys.
4. `REQUIRE_PAYMENT=true` verified with a real sandbox payment.
5. WS reconnects observed (Vercel closes connections at the function's max
   duration — clients already reconnect and re-authenticate with catch-up).

## 8. MonCash rollout notes

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

## 9. Backups & data protection

- Managed PostgreSQL: enable the provider's PITR / scheduled backups before
  loading real patient data.
- Keep the legacy JSON files encrypted until decommission sign-off.
- Do not log medical data: the backend logs ids and error categories only
  (enforced by the error middleware and the WS hub).
- `GET /api/health` is the only unauthenticated endpoint that reveals uptime.

## 10. Remaining manual configuration and security tasks

These are **not** done by this migration and require a human decision:

1. **Rotate every previously committed credential** (audit C3/C4): VPS SSH
   password, admin password, LiveKit API key/secret (already forced into env
   vars here — rotate at the provider), Zego/Agora app IDs if concerned.
2. **Upload privacy**: new uploads go to public Blob URLs (unguessable but
   unauthenticated). For per-consultation access control, move to private
   blobs + an authenticated streaming route (note the 4.5 MB function
   response limit) or signed URLs.
3. **Edge-level login throttling**: the in-app limiter is per-instance only;
   add Vercel WAF rules or provider rate limits for `/api/auth/*`.
4. **Vercel WS beta limits**: 300 s per connection on Hobby (5 min reconnect
   cycle), 800 s max on Pro; cross-instance fan-out needs `REDIS_URL`. If
   unacceptable, deploy `realtime/server.js` on an always-on host instead and
   point `NEXT_PUBLIC_WS_URL` at it.
5. **`/token` (Agora)**: still served from wherever it lives today; port it
   into the API (or migrate Android calls to LiveKit) as a follow-up.
6. **Android WS-fallback chat** needs an app update to send the JWT auth
   frame (ZIM primary chat is unaffected) — see
   `docs/ANDROID_COMPATIBILITY.md`.
7. **Cross-client calls** (Android Agora ↔ web LiveKit) remain
   non-interoperable — pre-existing gap, needs a product decision.
8. **Password policy**: minimum length is 4 for Android compatibility;
   raising it requires a coordinated client update.
9. Confirm MonCash status vocabulary in sandbox (§8).
10. Monitoring/alerting (uptime + DB + payment success rate) is not included.

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
cd medika-web && npm run dev
```
