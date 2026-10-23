# Medika Web — patient & doctor PWA

Responsive web application (installable PWA) porting the Medika Android patient and
doctor experiences to the browser. It talks to the **existing Medika backend**
(`server.js` at the repository root) — this is a companion client, not a
replacement for anything: the Android app, the backend, the database and the
admin panel are untouched.

- **Framework**: Next.js 14 (App Router) + TypeScript, custom CSS design system
  ported from the Android palette (`#16A34A` primary), no heavyweight UI libraries
  (`lucide-react` icons, `livekit-client` for calls — lazy-loaded on the call page)
- **Responsive**: verified from 320 px to desktop, bottom navigation on phones,
  WCAG-minded contrast and focus states, French (Haïti) copy matching the Android app
- **PWA**: manifest + generated icons (regular & maskable), service worker with a
  security-first caching policy, offline fallback page, install prompt

## Feature parity with the Android app

| Area | What the web app does |
|---|---|
| Auth | Login (username/password), patient self-registration, logout, session restore across refresh |
| Patient home | Greeting, consultation status chips, quick actions, recent consultations (real data + empty states), health tips |
| Doctor home | Availability toggle (En ligne / Hors ligne), queue / active / done tabs, accept / reject with live updates |
| Consultation flow | Symptom intake → specialty (20, priced from the backend) → doctor pick → MonCash payment → consultation creation |
| Chat | Realtime WebSocket messaging (same protocol as Android), typing indicators, day separators, image/video sharing |
| Calls | Voice/video consultation via LiveKit — the access token is minted by the backend (`POST /api/call/token`), browser never sees LiveKit credentials |
| Medical dossier | Patient medical history view + edit (allergies, conditions, medications), consultation timeline |
| Doctor notes | Diagnosis / symptoms / prescriptions editor feeding the patient dossier (production endpoints) |
| Prescriptions | Doctor writes & closes consultation; patient sees the prescription panel live |
| Support | Ticket list + threaded conversation with customer care |
| Notifications | In-app, realtime (WebSocket events), routes to the right screen |

## Getting started

```bash
cd medika-web
npm install
cp .env.example .env.local   # adjust if your backend runs elsewhere
npm run dev                  # http://localhost:4100
```

The dev server proxies `/api`, `/uploads` and `/payment` to
`DEV_BACKEND_ORIGIN` / `DEV_PAYMENT_ORIGIN` (default `http://localhost:3000` /
`http://localhost:9998`), mirroring the production nginx routes.

> **WebSocket note**: browsers cannot reach `/ws` through the Next.js dev
> rewrites (WebSocket upgrades are not proxied). For local development set
> `NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws` in `.env.local`. In production
> (single Vercel project) the platform routes `/ws` straight to the api
> service and this variable stays unset.

To run the backend locally: `node server.js` from the repository root
(seeded credentials are printed on first boot).

## Environment variables

| Variable | Purpose | Production value |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend REST base. Empty = same origin (nginx `/api` proxy). | *(empty)* |
| `NEXT_PUBLIC_PAYMENT_BASE_URL` | MonCash payment server base. | *(empty, `/payment`)* |
| `NEXT_PUBLIC_WS_URL` | WebSocket endpoint override (dev only). | *(unset)* |
| `DEV_BACKEND_ORIGIN` / `DEV_PAYMENT_ORIGIN` | Dev rewrite targets, never used in production. | — |

No secrets belong in these files — `.env.local` is gitignored and
`.env.example` contains placeholders only.

## Production deployment

The app builds standalone (`output: "standalone"`):

```bash
npm run build
# serve .next/standalone (copy .next/static into it, like medika-admin)
cp -r .next/static .next/standalone/.next/static/
PORT=4100 node .next/standalone/server.js
```

A suggested nginx server block (mirrors the existing `/admin` route):

```nginx
location /web/ {
    proxy_pass http://127.0.0.1:4100/;
    proxy_set_header Host $host;
    # WebSocket (if you ever colocate the channel):
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

`/api`, `/ws`, `/uploads` and `/payment` continue to be routed by the existing
nginx rules — the web app uses same-origin relative URLs for all of them.

## Security & privacy decisions

- **Session**: the auth token lives in `sessionStorage` (cleared when the tab
  closes; logout clears everything). A refresh revalidates against
  `GET /api/profile`; a *network* failure no longer signs the user out, only an
  explicit 401/403 does.
- **Service worker**: `/api/*`, `/ws`, `/uploads/*` and `/admin` are never
  cached. Only versioned static assets (`/_next/static`, icons) and the offline
  page are cached. Navigations are network-first so a logged-out user can never
  see a stale authenticated page.
- **Error messages**: all backend errors are normalized client-side into
  user-safe French messages (`lib/api/client.ts`) — no stack traces, server
  paths or internal details ever reach the UI.
- **LiveKit**: the browser only receives short-lived room tokens minted by the
  backend; the API key/secret stay server-side. When the app is served over
  HTTPS, `ws://` LiveKit URLs are upgraded to `wss://` (same host/port) to
  avoid mixed-content blocking.
- **Anti-double-submit**: login, register, consultation creation, prescription
  and notes forms ignore re-submission while a request is in flight.

## Testing

```bash
npm run test        # vitest unit suites (API client, WS protocol, formatting, session, payment)
npm run lint        # ESLint (next/core-web-vitals)
npm run typecheck   # tsc --noEmit (strict)
npm run build       # production build
```

## Known limitations (honest notes)

1. **Backend/production drift**: the Android app (and this web app) call
   `/api/tickets*`, `/api/medical-history*` and `/api/consultations/:id/notes`,
   which exist in production but are **not in the repository's `server.js`**
   (commit `4467783` only committed the Android side). This PR deliberately
   does not modify the backend; those screens degrade gracefully (French error
   + retry) until the backend routes are committed.
2. **Payments**: the MonCash payment server (`:9998`) is not part of this repo.
   The web client implements its documented protocol (`create` → gateway →
   `verify`). When the payment server is unreachable the UI offers a clearly
   labelled **test mode** (simulated payment) mirroring the Android
   sandbox behaviour, so consultations remain testable.
3. **Calls**: fully functional only when the LiveKit server configured in the
   backend (`POST /api/call/token` response) is reachable. Unreachable →
   explicit error screen with a return-to-chat button.
4. **Doctor credential fields** (specialty, license, hospital, biography) are
   read-only on the web, matching the backend's authorization model (admin
   manages doctors).

---

## Deploying to Vercel

The PWA is deployed as the **`web` service** of the single Medika Vercel
project (Vercel Services — see `../docs/DEPLOYMENT.md` for the full
runbook): the repository-root `vercel.json` routes `/` (catch-all) to this
app, and `/api`, `/payment`, `/uploads`, `/ws` to the Express `api` service
of the same project.

**No build-time environment variables are needed.** The browser talks
to the API same-origin (`/api/...` relative URLs), and the WebSocket client
defaults to `wss://<host>/ws`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | *(empty — same-origin)* |
| `NEXT_PUBLIC_PAYMENT_BASE_URL` | *(empty — same-origin `/payment`)* |
| `NEXT_PUBLIC_WS_URL` | *(unset — same-origin `wss://…/ws`)* |
| `API_ORIGIN` | **gone** — the old cross-project proxy is no longer read by `next.config.mjs`; do not set it |

Authentication note: the backend now issues **JWT bearer tokens** (the legacy
token was the raw user id — see `../docs/VERCEL_MIGRATION_AUDIT.md`). The WS
auth frame sends `{ type: "auth", token }`.
