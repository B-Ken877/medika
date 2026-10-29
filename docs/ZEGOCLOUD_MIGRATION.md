# ZEGOCLOUD video calls (sole provider) — issues #62 / #66

Medika's doctor–patient video/audio calls run on **ZEGOCLOUD only**, on web
and Android alike. There is no LiveKit dependency, no provider switch and no
fallback path: every token is minted server-side by the authorization
funnel, and a missing or invalid ZEGO configuration fails closed with a
clear error. A real two-device test is still required before declaring the
migration verified in production.

## 1. Architecture

**Backend (`src/routes/call.js`, `src/zego.js`, `src/config.js`)**
- `POST /api/call/token`: `authenticate` → consultation membership
  (403 "Not part of this consultation") → service availability (503, no
  credential fallback ever) → consultation lifecycle eligibility (403 unless
  `EN_COURS`; a RECHERCHE_MEDECIN row can already carry the current offer
  holder as `doctor_id`, so identity alone is not acceptance — issue #45)
  → mint a token04 grant for room `medika_<consultationId>`.
- Room and stream identity are SERVER-derived: the token payload pins
  `room_id`, the privilege map (`"1"` = loginRoom, `"2"` = publishStream)
  and `stream_id_list` = exactly `medika_<consultationId>_<userId>`. A
  stolen token cannot join another room or publish another stream.
- Response: `{ provider: 'zego', token, url, roomName, participantIdentity,
  streamId, appId, tokenTtlSeconds }`. `tokenTtlSeconds` is 3600; renewal
  re-runs the full authorization funnel.
- Secrets: `ZEGOCLOUD_SERVER_SECRET` (32 chars) / `ZEGOCLOUD_APP_SIGN` are
  server-only — never returned by any endpoint, never logged, never placed
  in any `NEXT_PUBLIC_*` variable and never committed. Tests use throwaway
  values. There are no LiveKit credentials anymore.
- Missing configuration answers 503 with `ZEGOCLOUD non configure …`
  (ZEGOCLOUD_APP_ID / ZEGOCLOUD_SERVER_URL / ZEGOCLOUD_SERVER_SECRET
  requis); an invalid secret length also answers 503 without leaking
  details. A non-WebSocket `ZEGOCLOUD_SERVER_URL` (for example an
  `https://` console page or a typo) answers 503 with a clear actionable
  error BEFORE any token is minted (`zegoServerUrlProblem`) — the browser
  engine would otherwise fail opaquely at runtime (issue #68).

**Web (`medika-web`)**
- `lib/call/zego-session.ts`: `ZegoCallSession` bridges the low-level
  `zego-express-engine-webrtc` SDK (dynamic import; browser-only) onto the
  page's machinery — the pure phases state machine, the calm eligibility
  wait, the WS signaling (call:start once per session; call:ended/
  call:rejected → end call), the in-call chat overlay and the branded UI.
  ZEGO `RECONNECTING`/`RECONNECTED` surface as true automatic reconnection
  states; `DISCONNECTED`/`KICKOUT` (not user-caused) surface as an
  unexpected disconnect with a REAL retry that re-fetches a fresh token;
  capture denials (`NotAllowedError`) surface as the permission failure
  state. Camera mute uses the ZEGO-recommended track `enabled` toggle; mic
  mute uses `muteMicrophone` plus track enable.
- `app/app/consultations/[id]/call/page.tsx`: bounded, cancellable
  eligibility poll (calm waiting; terminal statuses get honest copy with no
  retry storm) → token fetch → `new ZegoCallSession()` (exactly one
  creation site) → loginRoom/publish/subscribe. Local/remote video use the
  same host elements and styling as before (muted local preview,
  `object-fit` cover/contain, voice mode hides the remote video host while
  audio keeps playing). The in-call chat overlay never unmounts the page,
  so the session and local tracks survive chat switches (issue #45).
- `lib/api/types.ts`: `CallTokenResponse` is the zego contract — `provider`
  (`"zego"`, required), `appId`, `streamId`, `tokenTtlSeconds`. The session
  re-validates the shape at its boundary and rejects anything else.
- Token renewal: on `tokenWillExpire` the page re-POSTs `/api/call/token` —
  every renewal re-runs the FULL server authorization funnel (membership +
  EN_COURS) — and hands the fresh token to `renewToken`. A failed renewal
  never silently extends a grant; room events surface the outcome.

**Android**
- The Android app already calls through the ZEGOCLOUD UIKit Prebuilt Call
  (`com.example.data.zego.ZegoCallManager` / `ZegoChatManager`, ZIM chat).
  Issue #66 renamed the legacy `data.livekit` package to `data.zego` so the
  source tree matches the actual provider; no behavior change.

## 2. ZEGOCLOUD SDK facts (verified against official sources)

- Low-level Web SDK: **`zego-express-engine-webrtc`** (official ZEGO npm
  package; verified 3.13.0 definitions + bundle). NOT the Prebuilt UI kit —
  Medika keeps its own branded call UI.
- Engine: `new ZegoExpressEngine(appID: number, server: string)` — the
  `server` argument is the WebSocket endpoint from the ZEGO console. This is
  exactly what `ZEGOCLOUD_SERVER_URL` holds. It is client-visible by
  design, NOT a secret.
- Room/stream flow: `loginRoom(roomID, token, {userID, userName},
  {userUpdate: true})` → `createZegoStream({camera: {audio, video}})` →
  `startPublishingStream(streamID, localStream)`; remote media via the
  `roomStreamUpdate` event (`ADD`/`DELETE`) → `startPlayingStream(streamID)`
  returns the remote `MediaStream`.
- Lifecycle events: `roomStateChanged(roomID, reason, errorCode, extendedData)`
  with reasons LOGINING/LOGINED/LOGOUT/DISCONNECTED/RECONNECTING/RECONNECTED/
  KICKOUT; `publisherStateUpdate`; `playerStateUpdate`; `tokenWillExpire` →
  `renewToken(token, roomID?)`. Teardown: `stopPublishingStream`,
  `stopPlayingStream`, `destroyStream`, `logoutRoom`, `destroyEngine`.
- Auth: **token04** generated SERVER-SIDE from `AppID + ServerSecret`
  (exactly 32 chars).
- `ZEGOCLOUD_APP_SIGN` is NOT needed for token04 authentication and is never
  sent to the browser. It stays server-only, unused unless a future SDK
  requirement proves otherwise.
- Vendored token04: `src/zego.js` — copied from ZEGOCLOUD's official server
  assistant (github.com/ZEGOCLOUD/zego_server_assistant,
  token/nodejs/server/zegoServerAssistant.js, retrieved 2026-10-29), with the
  upstream debug `console.log` calls removed (token plaintext must never hit
  logs) and repo style applied. Zero new runtime dependencies (Node `crypto`).
  Re-diffed against upstream on 2026-10-30 (issue #68 audit): byte-layout and
  semantics remain upstream-identical.

### 2.1 Official references (required reading)

- Official integration repository (UIKit Prebuilt, web):
  https://github.com/ZEGOCLOUD/zego_uikit_prebuilt_web — its sample
  (`sample/index.ts`) illustrates the supported flow: the application server
  issues a room-scoped token, the client creates its session from that token
  and joins the room. Medika follows the SAME pattern adapted to the
  low-level `zego-express-engine-webrtc` package it actually installs
  (server-minted token04 → `loginRoom`), keeping the branded call UI instead
  of the generic prebuilt interface.
- Official integration guide:
  https://www.zegocloud.com/docs/uikit/callkit-web/quick-start/using-npm-package-manager
- Official token04 server implementation (vendored source):
  https://github.com/ZEGOCLOUD/zego_server_assistant (token/nodejs/server).
- The API surface is matched to the EXACT installed package and version
  (`zego-express-engine-webrtc@3.13.0`, per `medika-web/package-lock.json`);
  every engine method and event string used by `zego-session.ts` was
  re-verified against that version's bundle on 2026-10-30.

## 3. Environment variables

| Variable | Role | Exposure |
|---|---|---|
| `ZEGOCLOUD_APP_ID` | ZEGO project id (number) | server + sent to browser in the token response (public by design) |
| `ZEGOCLOUD_SERVER_URL` | public engine endpoint (wss://…) from the ZEGO console | server + sent to browser (public by design) |
| `ZEGOCLOUD_SERVER_SECRET` | token04 minting secret (32 chars) | **server only — never client, never logs** |
| `ZEGOCLOUD_APP_SIGN` | not used by token04 auth | **server only; kept unused** |

Each Vercel scope (Production / Preview / Development) must carry the
credentials of the ZEGO project intended for that scope; never copy
temporary test-project credentials into Production. `.env.example`
documents empty placeholders only.

## 4. Rollback / incident handling

There is no second provider to fall back to — by design. If ZEGO is
unavailable or misconfigured:
- Calls fail closed: the token endpoint answers 503 and the UI shows the
  explicit failure screen with retry — it never pretends a call is live.
- Restoring service = fixing the ZEGO credentials/endpoint in the affected
  Vercel scope, or rolling the deployment back to a previous release in the
  Vercel dashboard (application-level rollback, still ZEGO-only).

## 5. Manual two-device test steps (owner / production devices)

Environment: a deployment with the intended `ZEGOCLOUD_*` variables
configured for its scope. Use one doctor device and one patient device
(browser or PWA), on different networks if possible.

1. **Connect** — patient opens an `EN_COURS` consultation → call page; doctor
   does the same. Both reach the branded call UI with connecting state first.
2. **Media** — video+audio flow both ways; local preview appears (self view);
   toggling camera and microphone on both sides works and the other side
   observes the change.
3. **Voice mode** — the `?mode=voice` entry connects audio-only (no camera
   permission prompt for video).
4. **Chat without disconnect** — during the call, open the in-call chat panel
   on both sides, exchange messages, return to video: the call must NOT
   disconnect, reset or restart; timers/status stay continuous.
5. **Reconnect** — force a network interruption (airplane mode ~10s) on one
   side: the UI shows the honest automatic-reconnect state and media
   resumes; leaving the page or ending the call must not be faked.
6. **Hang-up** — one side hangs up: the other side gets "partner hung up"
   and lands back on the conversation; no ghost media.
7. **Repeat call** — the same participants can immediately call again
   (fresh tokens each time).
8. **Authorization negative tests** — a user NOT part of the consultation
   cannot obtain a token (403); a non-EN_COURS consultation cannot mint
   tokens (403); with the ZEGO vars removed the deployment answers 503.
9. **Secrets hygiene** — browser devtools network tab: the token response
   contains appId/serverUrl/streamId/token but never the ServerSecret or
   AppSign; no console log contains credential material.

## 6. Automated verification actually performed (issue #66)

- Root backend suite: **36 files / 414 tests passed** (`npx vitest run`,
  embedded-PostgreSQL harness). Call-token tests rewritten for the zego-only
  contract (token04 shape, provider/streamId fields, fail-closed 503);
  the LiveKit-specific test file was removed.
- medika-web: **37 files / 477 tests passed** (ZegoCallSession suite,
  session-based source contracts on the call page); `tsc --noEmit` 0 errors;
  `next lint` clean; `next build` succeeded.
- `livekit-client` removed from `medika-web/package.json`;
  `medika-web/package-lock.json` and the root `package-lock.json`
  regenerated without any LiveKit package.

## 7. Known limitations / not yet verified

- No real-device or video-quality verification has been performed by the
  agent (owner-only step). Acceptance criteria requiring an actual
  authenticated ZEGO call remain unchecked until the owner runs the
  two-device script (§5) on a deployment.
- The temporary ZEGO test project credentials must be rotated/revoked after
  testing (owner note in the issue).
- The Android rename is a mechanical source move (package/imports/symbols);
  no Android build was executed in the agent environment, so a Gradle build
  on the owner side is still the verification step for the mobile module.

## 8. Deployment status evidence (2026-10-30 audit, issue #68)

Owner report: "the app has continued showing LiveKit after PR #67 was
merged." Audit outcome: **the deployed production build is older than the
code that removes LiveKit — deployment lag, not an active-code defect.**

Evidence (GitHub commit statuses, repo B-Ken877/medika):
1. `082aa6c` (main HEAD, PR #67 — LiveKit removed completely) Vercel
   production deploy **FAILED** at 2026-10-29T01:23:29Z; the status target
   URL is the Vercel build-rate-limit page.
2. `bbd0070` (PR #65) production deploy **FAILED** the same way at
   2026-10-28T22:31:59Z.
3. The last SUCCESSFUL production deploy is `d48258b`
   (2026-10-28T22:27:24Z) — the issue #62 build whose provider gate ran
   **LiveKit in production by design** (fail-closed default before the
   explicit production opt-in landed in PR #65).
4. Repo-wide scan of `082aa6c`: ZERO active LiveKit code/config/dependency
   references (remaining matches are no-regression test guards and clearly
   marked historical docs).
5. The PWA service worker cannot serve a stale call bundle: navigations are
   network-first, `/_next/static/*` assets are content-hashed per build,
   and `/api/*` (the token endpoint) is never cached.

Consequence: until a production deploy of `082aa6c` (or later) succeeds,
the production site keeps serving the `d48258b` build and therefore keeps
showing LiveKit — exactly what the owner observed.

Owner-only actions (agent has no Vercel access; not attempted):
1. From the Vercel dashboard, retry/redeploy the latest main commit once
   the build-rate-limit window has reset, then confirm the production
   alias points at that deployment (commit hash visible in the dashboard).
2. With the intended scope-scoped `ZEGOCLOUD_*` variables configured, run
   the two-device script in §5 — a merged PR or a green preview build is
   NOT proof of a working production call.
3. Rotate the temporary ZEGO test credentials after testing (§7).
4. If a real build error (not rate limiting) appears in the Vercel logs,
   report it on issue #68 so the agent can fix it on a branch.
