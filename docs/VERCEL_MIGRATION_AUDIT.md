# Medika — Vercel Migration & Compatibility Audit (Phase 1)

> Audit date: 2026-10-22 · Branch audited: `feat/medika-pwa-web-ux` (includes `main` history + PWA)
> Auditor: automated code review of the actual repository contents (code takes precedence over README claims).
> **No credentials or secrets are reproduced in this document.** Findings reference where secrets live, not their values.

---

## 1. Executive summary

Medika today is a single-VPS deployment (`medikahaiti.site`) behind nginx, running five processes: an Express
backend (`server.js`, JSON-file storage), a Next.js admin panel (PM2), a **separate MonCash payment server**
(PM2, port 9998, **not in this repository**), a **separate Agora token server** (`/token`, **not in this
repository**), self-hosted LiveKit (7880) and coturn. The Android app (patient + doctor in one APK) and the
new web PWA (`medika-web/`, PR #1) are the two first-class clients; the admin panel is the third.

Porting this to Vercel is **feasible without changing the Android app's REST contract**, but five hard
blockers must be fixed first, and the current authentication model (token = user ID) is so insecure that it
must be migrated as part of this work, not after. The production backend also **diverged from the repo**
(16 endpoints exist only on the VPS), which this migration must re-implement from the client contracts in
this repository (Kotlin/Moshi DTOs + TypeScript types + admin panel code), clearly flagged as such.

**Recommended target**: one Vercel project at the repo root exposing the Express app + WebSocket (public
beta) as a single Function (`server.js` entry, per official "Express on Vercel" + "WebSockets on Vercel
Functions" docs), managed PostgreSQL (Neon/Supabase-class) via `pg` + SQL migrations, Vercel Blob for
uploads, JWT bearer tokens (opaque to Android), MonCash verification implemented server-side from the
official Digicel REST API (`/Api/v1/CreatePayment`, `/Api/v1/RetrieveOrderPayment`,
`/Api/v1/RetrieveTransactionPayment`), and optional Redis pub/sub for cross-instance WebSocket fan-out.

---

## 2. Current architecture (as deployed, per repo + README + code)

```
medikahaiti.site (nginx, VPS 167.86.124.101)
├── /api/* /ws /uploads/*  → Express server.js (Docker, :3000)  ← IN REPO (but behind production)
├── /payment/*             → MonCash payment server (PM2, :9998) ← NOT IN REPO
├── /token?channel=&uid=   → Agora token server                  ← NOT IN REPO
├── /admin                 → medika-admin (Next.js, PM2, :4000)  ← IN REPO
├── (web PWA)              → medika-web (PR #1, Next.js :4100)   ← IN REPO (new)
├── :7880                  → self-hosted LiveKit (ws://, no TLS) ← referenced by server.js
└── :3478                  → coturn
External SaaS used by Android: Zego ZIM (chat, AppID committed in Kotlin), Agora RTC (AppID committed)
```

Client stack reality (code, not README):

| Client | Chat | Calls | REST base | Auth sends |
|---|---|---|---|---|
| Android app | **Zego ZIM primary**, server `/ws` fallback | **Agora RTC** (token from `/token`) | `https://medikahaiti.site/` | `Bearer <user id>` |
| Web PWA (`medika-web/`) | server `/ws` (same protocol as Android) | **LiveKit** (`POST /api/call/token`) | same-origin `/api` (nginx/rewrites) | `Bearer <user id>` |
| Admin panel | polling (3–5 s) | — | same-origin `/api` | `Bearer <user id>` |

Consequences: Android↔Android chat works via ZIM; web↔Android chat works via `/ws`; **Android↔web calls do
not interoperate today** (Agora vs LiveKit — pre-existing gap, out of scope for this migration, must be
documented, not silently ignored).

---

## 3. Endpoint inventory & client matrix

### 3.1 Implemented in the repo (`server.js`)

| Method & path | Android | Web PWA | Admin | Notes |
|---|---|---|---|---|
| POST /api/auth/login | ✅ | ✅ | — | returns `token = user.id` (C1) |
| POST /api/auth/register | ✅ | ✅ | — | patient self-registration |
| POST /api/admin/auth/login | ✅(admin mode) | — | ✅ | admin role check |
| GET/PUT /api/profile | ✅ | ✅ | — | |
| PUT /api/doctor/availability | ✅ | ✅ | — | |
| GET /api/doctors[?specialty] | ✅ | ✅ | — | returns PII (M1) |
| GET /api/specialties/prices, /price | ✅ | ✅ | — | public |
| POST /api/consultations | ✅ | ✅ | — | ignores payment fields (C5) |
| GET /api/consultations, /:id, /:id/messages | ✅ | ✅ | ✅(admin variant) | role-scoped |
| PUT /api/consultations/:id/accept|reject|prescription | ✅ | ✅ | — | authz holes (H2) |
| POST /api/call/token | ✅(legacy path) | ✅ | — | LiveKit JWT; hardcoded creds (C3) |
| POST /api/upload | ✅ | ✅ | ✅(admin variant) | multer disk, 50 MB (H3, V3) |
| GET /api/health | ✅ | ✅ | — | |
| Admin: stats, doctors CRUD, patients, consultations(+delete, messages), finance, reset-password, upload, specialties | ✅(subset) | — | ✅ | `authenticateAdmin` = same user-id token (C1) |
| GET /uploads/* (static) | ✅(media fetch) | ✅ | — | **no access control** (H3) |
| WS /ws (auth, message:send, typing, call:start/accept/reject/end, catch-up) | ✅ fallback | ✅ primary | — | unauthenticated auth frame (C2) |

### 3.2 Called by in-repo clients but **missing from the repo backend** (production-only)

Reconstructed from `GeminiApi.kt` (Retrofit + Moshi DTOs), `medika-web/lib/api/endpoints.ts`, and
`medika-admin/app/(admin)/customer-care/**`:

| Method & path | Used by | Contract source |
|---|---|---|
| GET /api/tickets · POST /api/tickets {subject} | Android, Web | `GeminiApi.kt:403-413`, endpoints.ts |
| GET /api/tickets/:id (embeds `messages[]`) | Android, Web | TicketChatScreen.kt:122-128 |
| POST /api/tickets/:id/messages {content,…} | Android, Web (web sends `message` — accept both) | SendMessageRequest |
| GET/PUT /api/consultations/:id/notes | Android, Web | ConsultationNote DTO |
| GET /api/medical-history/:patientId [/snapshot] · PUT | Android, Web | MedicalHistory DTOs |
| GET /api/admin/tickets[?status] → {tickets:[…]} | Admin | customer-care/page.js |
| GET /api/admin/tickets/:id → {ticket, messages} | Admin | customer-care/[id]/page.js |
| POST /api/admin/tickets/:id/messages {content} | Admin | same |
| PUT /api/admin/tickets/:id/close · /reopen | Admin | same |
| POST /payment/api/payment/create {orderId, amount} → {success, redirectUrl} | Android, Web | PaymentActivity.kt:298-301 |
| POST /payment/api/payment/verify {orderId} → {success, payment:{transactionId}} | Android, Web | PaymentActivity.kt:349-367 |
| GET /token?channel&uid → {token} | Android (Agora) | CallActivity.kt:179 |

**These must be re-implemented** (except `/token`, see §6.4) to keep Android/web/admin functional on Vercel.
They are reconstructions of the client contract, flagged wherever behavior could diverge from the VPS
implementation (which is unavailable for diffing).

---

## 4. Findings (severity-ranked)

### CRITICAL

- **C1 — Bearer token is the user ID.** `server.js:437,727,761` return `token: user.id`;
  `authenticate()` (376-387) treats any user ID as valid proof. User IDs are exposed by public/low-privilege
  endpoints (`GET /api/doctors`), so **any patient can impersonate any doctor or the admin** and read/write
  medical data. Fix: JWT (HS256) with server-side verification; opaque to Android (it echoes whatever login
  returns). Coordinated migration: all stored tokens invalidate → users re-login (documented).
- **C2 — WebSocket auth is unauthenticated.** `server.js:131-135`: `{type:'auth', userId}` binds the socket
  to any claimed user → full chat/call-signaling impersonation. Fix: auth frame must carry the JWT; web PWA
  updated in-repo; Android WS fallback requires an app update (ZIM primary chat unaffected) — documented.
- **C3 — LiveKit API secret committed.** `server.js:81-83` and `README.md` (§ LiveKit Credentials). Must be
  rotated and moved to env vars; treat as compromised since the repo is on GitHub.
- **C4 — VPS root SSH password & admin credentials committed in README.md.** Rotate; remove from history is
  out of scope, but at minimum strip from the repo going forward.
- **C5 — No server-side payment verification.** `POST /api/consultations` (499-525) ignores
  `transactionId`/`orderId`/`paymentAmount`; consultation creation is unconditionally free at the API level.
  The separate payment server's verify semantics are unknown (not in repo). Fix: implement MonCash
  verification from the official REST API with idempotent payment records; gate consultation creation.
- **C6 — Production backend diverged from the repository.** 16 endpoints + 4 data files (tickets,
  ticket_messages, consultation-notes, medical-histories) exist only on the VPS. The repo is not the source
  of truth; redeploying from GitHub today would break Android ticket/notes/dossier features. This migration
  re-implements them in-repo (flagged) and provides a JSON→PostgreSQL import path for all data files.

### HIGH

- **H1 — JSON-file storage is not durable or concurrent-safe.** `loadData/saveData` (85-94) read-modify-write
  whole files; no locking, no transactions, no atomic writes. Message IDs via `Math.max(...)+1` (194, 585,
  630) collide under concurrency. Every WS message re-reads `consultations.json` + `messages.json`.
  Fix: PostgreSQL + BIGSERIAL ids + transactions.
- **H2 — Authorization holes.** `PUT /:id/accept` (563): any doctor accepts any consultation, can steal an
  assigned one, no atomic claim (double-accept). `PUT /:id/prescription` (614) and `/reject` (598): any
  doctor can act on consultations that are not theirs. Fix: `UPDATE … WHERE doctor_id IS NULL OR
  doctor_id=$me` atomic claim; prescriptions require `c.doctor_id = req.user.id`.
- **H3 — Uploaded medical media is public and ephemeral.** `/uploads` is `express.static` (116) with **no
  authentication** — consultation voice notes/images/videos are fetchable by anyone holding a URL; and the
  filesystem is ephemeral on Vercel. Fix: object storage + per-consultation access check via an
  authenticated streaming/redirect route. (Public blob URLs remain a known limitation — see §7 risks.)
- **H4 — Wide-open CORS.** `app.use(cors())` (373) reflects any origin. Fix: explicit allowlist
  (`CORS_ORIGINS`), credentials off (Bearer model).
- **H5 — No login throttling / rate limiting / security headers.** Admin password reset (1071) has no
  notification or rate cap. Password minimum length is 4 (698, 870).
- **H6 — Serverless-incompatible runtime patterns.** `setInterval` heartbeat (363-369), in-memory
  `userSockets` Map (121) — break under multi-instance and function recycling even before Vercel.
- **H7 — Default admin credentials seeded and logged.** `seedIfEmpty` (1132-1176) hardcodes a known
  password and logs it. Fix: env-driven seeding only.

### MEDIUM

- **M1 — Doctor PII exposure.** `GET /api/doctors` (678-689) returns email/phone/license_number to any
  authenticated patient. Trim to the fields the clients render (name, specialty, hospital, location, bio,
  rating, availability, avatar).
- **M2 — Finance is inferred, not recorded.** Admin stats/finance compute revenue from *current* specialty
  pricing at read time (780-789, 1022-1029); no payment records exist. Payments table (new) becomes the
  source of truth; legacy stats endpoint stays price-based for compatibility, documented.
- **M3 — WS catch-up semantics.** Catch-up (137-167) slices the last 50 messages across all the user's
  consultations, not per consultation; acceptable, but the port makes it per-consultation-limited and
  DB-indexed.
- **M4 — Error handling leaks internals** in upload paths (`err.message` passthrough, 398) and logs message
  bodies in some paths. Normalize to user-safe errors; log ids only.
- **M5 — README is stale vs code** (claims LiveKit for Android calls; actual Agora+Zego; claims Next 16
  admin; actual 14.2). Trust code — documented in this audit.
- **M6 — Ticket message field mismatch.** Android sends `{content}`; web PWA sends `{message}`. Server must
  accept both (documented divergence).
- **M7 — Suspected admin-panel syntax bug: DISPROVEN during implementation.** The customer-care ticket
  page initially *appeared* to contain a malformed React hook when viewed through terminal tooling.
  In fact the committed source is valid JavaScript: literal bracket-m character pairs inside the file
  are consumed by ANSI terminal rendering, the exact phenomenon this repository's own README already
  documents for an earlier bug of the same kind. Byte-level inspection confirmed the file is correct
  and the admin panel builds cleanly. No change was needed; recorded so future audits do not re-chase
  the same ghost.

### LOW

- L1: `express.json()` default 100 kB body limit will reject long AI summaries — raise to 1 MB.
- L2: consultation `GET /:id` returns `200 null` for foreign consultations (hides existence) — preserved.
- L3: specialties duplicated (repo `specialties.json` vs VPS `data/specialties.json`) — repo file becomes
  the seed source.

---

## 5. Vercel compatibility assessment (official docs, checked 2026-10)

| Concern | Official position (source) | Impact on Medika |
|---|---|---|
| Express support | Zero-config: root `server.{js}` entry, app becomes a **single Function**; `express.static()` is ignored; static via `public/` (docs: Express on Vercel) | REST ports cleanly; `/uploads` static must go |
| WebSockets | **Public beta on all plans**: export the HTTP server (Express + `ws`) from the function; connections pin to an instance; **close at max duration** (Hobby 300 s; Pro 800 s max); cross-instance fan-out needs external pub/sub (Redis) (docs: WebSockets on Vercel Functions) | `/ws` protocol can stay identical; clients must tolerate periodic reconnects (web PWA already has backoff+dedup); Redis optional for multi-instance |
| Request body | **4.5 MB hard limit** (413 `FUNCTION_PAYLOAD_TOO_LARGE`) (docs: Functions limits) | 50 MB uploads impossible through functions → cap `/api/upload` at 4 MB, use Blob direct upload for large web files; Android large-media limitation documented |
| Duration | Hobby 300 s default/max; Pro 300 s default / 800 s max (docs: Functions limits) | Fine for REST + MonCash calls; sets WS session ceiling |
| Filesystem | Ephemeral; `express.static` ignored | JSON DB + multer disk storage must be replaced |
| DB connections | Node functions, module scope reuse; 1,024 fds/instance | `pg` Pool singleton (max 10), `sslmode=require` |
| Fluid compute | Default; WS requires it | Enabled by default on new projects |

---

## 6. Proposed architecture (Phase 2 blueprint)

### 6.1 Shape

```
Vercel project "medika-api" (repo root)
├── server.js                ← thin entry: builds Express app + http server + WSS, exports server (zero-config)
├── src/…                    ← modular backend (routes, repos, auth, payments, realtime)
├── db/migrations/*.sql      ← PostgreSQL schema (versioned)
├── scripts/migrate.js       ← migration runner (node, pg)
├── scripts/import-json-data.js ← JSON → PG importer (users, consultations, messages, specialties, tickets, notes, histories)
├── vercel.json              ← security headers, function config, /ws rewrite if needed
└── package.json             ← NEW: backend dependencies (express, ws, cors, bcryptjs, pg, jsonwebtoken,
                               livekit-server-sdk, multer→busboy-compatible memory storage, @vercel/blob, ioredis)

Vercel project "medika-web"  (medika-web/) — PWA; proxies /api,/payment,/uploads to medika-api; WS direct
Vercel project "medika-admin"(medika-admin/) — admin panel; same proxying
Managed PostgreSQL (Neon/Supabase/RDS…)     — DATABASE_URL
Vercel Blob                                  — BLOB_READ_WRITE_TOKEN (uploads)
Optional Redis (Upstash/Vercel Marketplace)  — REDIS_URL for cross-instance WS fan-out
LiveKit Cloud or existing self-hosted        — LIVEKIT_URL/API_KEY/API_SECRET (env, rotated)
MonCash (Digicel) REST API                   — MONCASH_CLIENT_ID/SECRET/MODE
```

### 6.2 Key decisions

1. **Single-function Express + WS** (officially documented pattern) preserves every route path and the `/ws`
   protocol byte-for-byte. Android keeps working with **DNS cutover only** (no APK change) — see §7.
2. **Auth = JWT (HS256, 30 d)** issued at login/register; `Authorization: Bearer <jwt>`. Android treats it
   as opaque (it already does for the user-id token). WS auth frame switches to `{type:'auth', token}`.
3. **PostgreSQL replaces all JSON files**; API layer converts timestamps to unix seconds to preserve the
   client contract exactly; message ids remain numeric (BIGSERIAL).
4. **Payments**: `payments` table (unique order_id, unique transaction_id, unique consultation_id once
   consumed). `/api/payment/create` + `/api/payment/verify` mounted at the legacy paths
   (`/payment/api/payment/*` **and** `/api/payment/*`). Verification calls MonCash
   `RetrieveOrderPayment`/`RetrieveTransactionPayment` server-side; consultation creation requires a
   verified, owned, unconsumed payment of the correct amount (env-gated: `REQUIRE_PAYMENT`).
   Simulation mode (`PAYMENT_SIMULATION=true`) is dev/sandbox-only and **refuses to boot in production**.
5. **Uploads → Vercel Blob** with the same response shape `{url, filename, mimetype, size}` (absolute URLs);
   4 MB cap (Vercel body limit); legacy `/uploads/*` requests 302-redirect to
   `LEGACY_UPLOADS_ORIGIN` during migration.
6. **Realtime**: same protocol; optional Redis pub/sub (`REDIS_URL`) for cross-instance delivery; the WS
   handler module also runs as a standalone always-on server (`realtime/server.js`) for operators who
   prefer a non-Vercel gateway — same code, two deployment targets.
7. **Missing endpoints** (§3.2) implemented to the client contracts; every such route is commented
   `// RECONSTRUCTED:` in code and listed in the PR.
8. **`/token` (Agora)** is NOT re-implemented: Android Agora calls keep using the existing token server or
   the same DNS path; LiveKit remains the web path per project direction. Cross-client call interop is a
   documented, pre-existing gap.

### 6.3 Database schema (summary — full DDL in `db/migrations/`)

`users`, `specialties`, `consultations`, `messages` (BIGSERIAL), `payments`, `tickets`,
`ticket_messages` (BIGSERIAL), `consultation_notes`, `medical_histories` (document-style JSONB columns for
allergies/medications/etc. to preserve the exact client DTO shapes), `schema_migrations`. FKs with
appropriate ON DELETE, uniqueness constraints (username, order_id, transaction_id, consultation_id on
payments), indexes on (patient_id, created_at), (doctor_id, status), (consultation_id, id), ticket status.
All timestamps `timestamptz`; API emits unix seconds.

### 6.4 What deliberately does NOT change

- Route paths and response shapes for all §3.1 endpoints (Android compatibility).
- The Android app and admin panel clients (no Kotlin or admin page changes required).
- LiveKit token response shape `{token, url, roomName, participantIdentity}` (values from env).
- The Express framework and the `ws` protocol (message envelopes unchanged).

---

## 7. Migration risks

1. **Token invalidation** (C1/C2 fix): every stored token stops working once → one forced re-login per
   client. Android re-login is safe (login flow unchanged). Android WS-fallback chat needs the JWT auth
   frame (app update) — ZIM primary chat unaffected. Web PWA ships the fix in this PR.
2. **DNS cutover**: Android has `https://medikahaiti.site/` compiled in. Either point the domain at Vercel
   (recommended; paths preserved) or keep the VPS proxying to Vercel during a transition. `/token` (Agora)
   must keep resolving somewhere — keep that path on the VPS or port it later.
3. **WebSocket beta limits**: 5-minute (Hobby) / 13-minute (Pro) connection ceiling; clients reconnect
   (already implemented on web; Android WS is a fallback path). Multi-instance fan-out requires REDIS_URL —
   without it, delivery across instances is not guaranteed. Escape hatch: standalone realtime host.
4. **4.5 MB body limit**: Android media messages >4 MB fail. Mitigation for web: Blob direct upload; for
   Android: document + future client update (voice notes at typical AMR/AAC bitrates stay <4 MB).
5. **Payment provider coupling**: MonCash REST status vocabulary must be confirmed against the official
   PDF/sandbox during rollout; the integration fails closed (503/402) when credentials are absent.
6. **Data migration**: JSON import must be verified (row counts + smoke checks) before the VPS JSON files
   are retired; they are never deleted by tooling. Existing `data/*.json` on the VPS includes production
   medical records — handle per privacy requirements (transport over SSH, encrypted at rest).
7. **Reconstructed endpoints** (§3.2) may diverge in edge-case behavior from the VPS implementation; first
   rollout should shadow-test against production traffic before the VPS is decommissioned.

---

## 8. Files that need to change (Phase 2 plan)

| File | Action | Why |
|---|---|---|
| `server.js` | rewrite as thin entry (compose app + WS, export server) | zero-config Vercel function (§6.1) |
| `src/**` (new ~20 files) | add | routes, repos, auth, payments, realtime, uploads, errors |
| `package.json`, `package-lock.json` (root, new) | add | backend deps for Vercel builds |
| `vercel.json` (new) | add | headers, function limits |
| `db/migrations/001_init.sql` (new) | add | schema |
| `scripts/migrate.js`, `scripts/import-json-data.js`, `scripts/smoke-verify.js` (new) | add | DB lifecycle + migration verification |
| `.env.example` (root, new) | add | env var contract (no values) |
| `medika-web/lib/ws/socket.ts`, `medika-web/lib/auth/*`, `medika-web/next.config.mjs`, `medika-web/.env.example`, `medika-web/README.md` | edit | JWT WS auth frame, API_ORIGIN/WS_URL production config |
| `medika-admin/next.config.mjs` | edit | proxy config for Vercel (API_ORIGIN) |
| `README.md` | edit | replace leaked credentials section with env-var docs; refresh architecture |
| `docs/DEPLOYMENT.md` (new) | add | Vercel + Postgres + cutover runbook |
| `tests/` (root, new) | add | API contract, authz, concurrency, payments, WS tests (supertest + vitest) |

Android sources: **unchanged** (except none — no edits planned).
