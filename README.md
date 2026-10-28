# Medika Haiti — Telemedicine Platform

> **PROJECT MEMORY FILE** — living reference for the whole platform.
> **Never store credentials, tokens or patient data in this file.** Secrets live
> in environment variables (see `.env.example`); deployment history lives in
> `docs/`.

---

## 🖥️ Current Architecture (Vercel migration — see docs/)

Medika is migrating from a single-VPS deployment to a Vercel-centric one:

| Piece | Now (legacy VPS) | Target (this branch) |
|-------|------------------|----------------------|
| Backend | Express `server.js` (Docker, JSON files) | Same Express app as the **`api` service** of the single Vercel project (REST + `/ws` WebSocket, one Function) |
| Database | JSON files in a Docker volume | **Managed PostgreSQL** (`db/migrations/`, `pg`) |
| Web PWA | `medika-web/` (PR #1) on the VPS | **`web` service** of the same Vercel project — served at `/` (same-origin `/api` via the platform router) |
| Admin | `medika-admin/` (PM2 :4000) | **`admin` service** of the same Vercel project — served at `/admin` (basePath preserved) |
| Payments | Separate MonCash server (PM2 :9998, **not in repo**) | `/api/payment/*` + `/payment/api/payment/*` inside the API (server-side MonCash verification) |
| Video | Self-hosted LiveKit (7880) | LiveKit (Cloud or self-hosted) via env vars |
| Realtime | In-process WebSocket | Same protocol on Vercel's WS support; optional Redis pub/sub for multi-instance |
| Uploads | Local disk + static | **Vercel Blob** (4 MB cap — Vercel function body limit) |

One Vercel project ("medika"), three services, one domain — routing declared in
`vercel.json` (`services` + top-level `rewrites`, original path preserved into
each service). See `docs/DEPLOYMENT.md` §1 for the routing table and the
single-project runbook.

Key documents:

- `docs/VERCEL_MIGRATION_AUDIT.md` — Phase 1 audit (severity-ranked findings, endpoint inventory, migration risks)
- `docs/DEPLOYMENT.md` — Vercel + PostgreSQL deployment & DNS cutover runbook
- `docs/ANDROID_COMPATIBILITY.md` — what changes for the existing Android apps
- `.env.example` (repo root) — every environment variable, with descriptions

### Security posture (changed in this migration)

- Bearer tokens are **JWTs** now (the legacy server used the raw user id as the token — see audit C1). All clients re-login once after cutover.
- WebSocket auth frames carry the JWT (`{type:'auth', token}`).
- LiveKit, MonCash and admin credentials come from env vars only; previously committed secrets must be treated as **compromised and rotated** (audit C3/C4).
- MonCash payments are verified **server-side** before a consultation can be created (audit C5).
- Simulated payments are dev/sandbox-only and refuse to boot in production.

### Legacy VPS (being replaced)

The original deployment ran behind nginx on a VPS: `/api`+`/ws`+`/uploads` → Express (:3000), `/payment` → MonCash server (:9998), `/token` → Agora token server, `/admin` → admin panel (:4000), plus self-hosted LiveKit (:7880) and coturn (:3478). Infrastructure credentials (SSH, admin password, LiveKit key/secret) were previously recorded in this README — they were **removed** and must be rotated.

---

## 📱 Android App (`app/`)

- **Language**: Kotlin + Jetpack Compose; Retrofit + Moshi (`GeminiApi.kt`); Coil; Room
- **BASE_URL**: `https://medikahaiti.site/` (compiled in — DNS cutover keeps it working, no APK change needed)
- **Chat**: Zego ZIM (primary) with the server `/ws` as fallback
- **Calls**: Agora RTC + token server at `/token` (cross-client calls with the web PWA are a known, pre-existing gap — see audit §2)
- **Payments**: MonCash WebView via `https://medikahaiti.site/payment`
- Min SDK 26, target 35. See `docs/ANDROID_COMPATIBILITY.md` for the migration notes.

Key screens: Auth, Patient/Doctor dashboards, symptom intake + payment, chat, call, consultation history, medical dossier, doctor notes, tickets, notifications, profile.

---

## 🖧 Backend (`server.js` + `src/`)

- **Runtime**: Node 20+ (Express 4) — runs standalone (`node server.js`) or as the `api` service of the single Vercel project (Vercel Services). Express preset entry contract: `server.js` imports `express` directly and exports the composed `http.Server` (REST + `/ws`); the app factory lives at `src/create-app.js` so it is never mistaken for the entry — regression-checked by `tests/vercel-entrypoint.test.js` (see `docs/DEPLOYMENT.md` §4)
- **Database**: PostgreSQL via `pg` (migrations in `db/migrations/`, run `npm run migrate`)
- **Realtime**: `ws` WebSocketServer on `/ws` — legacy protocol preserved; optional Redis (`REDIS_URL`) for cross-instance fan-out; `realtime/server.js` runs the same stack as an always-on host if you prefer that over Vercel's WS beta
- **Payments**: MonCash REST (`src/moncash.js`), payments table with idempotent verification
- **Uploads**: Vercel Blob (`src/uploads.js`), 4 MB cap, legacy `/uploads/*` redirect during migration
- **Tests**: `npm test` (vitest + supertest + embedded PostgreSQL — 94 tests)

Scripts: `npm run migrate` · `npm run import-json` (JSON→PG migration) · `npm run smoke-verify` · `npm test` · `npm start`

---

## 🖥️ medika-web (PWA) & medika-admin

- `medika-web/` — Next.js 14 patient/doctor PWA (see its README) — deployed as the `web` service (served at `/`); WS auth frame sends the JWT; same-origin `/api` via the platform router (no proxy config).
- `medika-admin/` — Next.js 14 admin panel — deployed as the `admin` service (served at `/admin`, basePath preserved).
- Routing contract for all three services is pinned by `tests/vercel-services.test.js`.

---

## 👨‍⚕️ Doctors & Specialties

20 specialties with per-specialty pricing (seeded from `specialties.json` via `npm run migrate`, editable by admins through `/api/admin/specialties`). Platform fee per consultation is `PLATFORM_FEE` (default 250 HTG).

---

## 💳 MonCash

Official Digicel REST API (`/Api/oauth/token`, `/Api/v1/CreatePayment`, `/Api/v1/RetrieveOrderPayment`, `/Api/v1/RetrieveTransactionPayment`), sandbox + production modes. Server-side verification only; consultation creation requires a verified payment. Simulated payments exist strictly for dev/sandbox (`PAYMENT_SIMULATION=true` + non-production + sandbox mode).

---

## 🐛 Known Issues & Pending Tasks

See `docs/DEPLOYMENT.md` § "Remaining manual configuration and security tasks" for the current list (upload privacy, login throttling at the edge, MonCash sandbox status-vocabulary confirmation, cross-client call interop, Vercel WS beta limits).

---

## 📋 Change Log

- **2026-10 (single-project consolidation)**: one Vercel project ("medika") via Vercel Services — `web` (medika-web → `/`), `admin` (medika-admin → `/admin`), `api` (repo root → `/api`, `/payment`, `/uploads`, `/ws`); frontends became pure same-origin clients (API_ORIGIN proxy removed); admin logout redirect basePath fix; routing pinned by `tests/vercel-services.test.js`.
- **2026-10 (Vercel migration)**: Phase 1 audit (`docs/VERCEL_MIGRATION_AUDIT.md`); PostgreSQL schema + repositories; JWT auth; MonCash server-side verification; reconstructed tickets/notes/medical-history endpoints (from client contracts — production implementations were never committed); Vercel Blob uploads; realtime hub with optional Redis; 94 backend tests; secrets scrubbed from this README.
- **2026-07**: medical history + consultation notes; ticket system rebuild; 60 seed doctors; compact doctor cards; domain + SSL setup.
- **Earlier**: full platform build (auth, consultations, chat, calls, payments, admin, per-specialty pricing, avatars, tickets).
