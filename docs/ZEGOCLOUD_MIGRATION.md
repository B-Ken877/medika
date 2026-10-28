# ZEGOCLOUD migration — LiveKit → ZEGOCLOUD (web PWA calls), issue #62

Controlled migration of Medika's **web** doctor–patient video/audio calls from
LiveKit to ZEGOCLOUD. Production keeps LiveKit until the ZEGOCLOUD flow has
passed real two-device testing and the owner explicitly accepts the switch.

## 1. Audit findings (code traced before any change)

**Backend (LiveKit today)**
- `POST /api/call/token` (`src/routes/call.js`): `authenticate` → consultation
  membership (403 "Not part of this consultation") → service availability
  (503, no credential fallback ever) → consultation lifecycle eligibility
  (403 unless `EN_COURS`; a RECHERCHE_MEDECIN row can already carry the
  current offer holder as `doctor_id`, so identity alone is not acceptance —
  issue #45) → mint LiveKit AccessToken (identity = user id, grants
  join/publish/subscribe/data) for room `medika_<consultationId>`.
- Credentials: `LIVEKIT_URL` (public), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  (`src/config.js`).

**Web (LiveKit today)**
- Entry: consultation page links `/app/consultations/[id]/call?mode=video`
  (primary) and `?mode=voice`; `/room` is a retired redirect (issue #56).
- Call page (`medika-web/app/app/consultations/[id]/call/page.tsx`):
  bounded, cancellable eligibility poll (calm waiting; terminal statuses get
  honest copy with no retry storm) → token fetch → `livekit-client` Room →
  publish mic/camera → attach local/remote video elements.
- Issue #45 guarantees: the in-call chat (`InCallChat`) is an overlay on the
  call page — switching to chat NEVER unmounts the call, so the RTC session
  and local tracks survive. "End call" is the only user action that
  disconnects. Lifecycle transitions go through the pure state machine
  `medika-web/lib/call/phases.ts` (connecting/waiting/active/reconnecting/
  ended/failed with generic/permission/ineligible kinds).

**Android (out of scope, untouched)**
- The Android app uses Agora RTC for calls and Zego ZIM for chat. This
  migration changes ONLY the web PWA path; the chat transport (WebSocket +
  ZIM on Android) is not modified. No Android code or dependency changed.

## 2. ZEGOCLOUD SDK facts (verified against official sources)

- Low-level Web SDK: **`zego-express-engine-webrtc`** (official ZEGO npm
  package; verified 3.13.0 definitions + bundle). NOT the Prebuilt UI kit —
  Medika keeps its own branded call UI.
- Engine: `new ZegoExpressEngine(appID: number, server: string)` — the
  `server` argument is the WebSocket endpoint from the ZEGO console. This is
  exactly what `ZEGOCLOUD_SERVER_URL` holds. It is client-visible by design
  (like `LIVEKIT_URL`), NOT a secret.
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
  (exactly 32 chars). The token payload can pin `room_id`, the
  `privilege` map (`"1"` = loginRoom, `"2"` = publishStream) and
  `stream_id_list`. Medika uses all three, so a token only works for ITS
  room, ITS user and ITS stream.
- `ZEGOCLOUD_APP_SIGN` is NOT needed for token04 authentication and is never
  sent to the browser. It stays server-only, unused unless a future SDK
  requirement proves otherwise.
- Vendored token04: `src/zego.js` — copied from ZEGOCLOUD's official server
  assistant (github.com/ZEGOCLOUD/zego_server_assistant,
  token/nodejs/server/zegoServerAssistant.js, retrieved 2026-10-29), with the
  upstream debug `console.log` calls removed (token plaintext must never hit
  logs) and repo style applied. Zero new runtime dependencies (Node `crypto`).

## 3. Architecture of the change

**Server-side provider switch (fail-safe)**
- `CALL_PROVIDER` env: `livekit` (default) | `zego`.
- `config.callProvider` honors `zego` ONLY on preview/development
  deployments (VERCEL_ENV preview/development, or non-production off-Vercel).
  On ANY production deployment `zego` is ignored and LiveKit is used — even
  if `CALL_PROVIDER=zego` and the ZEGOCLOUD_* variables leak into production
  scope. Unknown values fail closed to `livekit`.
- `POST /api/call/token` runs the SAME authorization funnel for both
  providers: authenticate → membership 403 → provider availability 503 (with
  a provider-specific, no-fallback error) → `EN_COURS`-only 403 → mint.
- Response adds a `provider` field (`'livekit'` | `'zego'`); the legacy
  LiveKit response shape is otherwise unchanged. Zego responses additionally
  carry the public engine data the browser needs: `appId`, `url`
  (= `ZEGOCLOUD_SERVER_URL`), the server-derived `streamId`
  (`medika_<consultationId>_<userId>`) and `tokenTtlSeconds` (3600).
- Secrets: `ZEGOCLOUD_SERVER_SECRET` / `ZEGOCLOUD_APP_SIGN` are server-only.
  They are never returned by any endpoint, never logged, never placed in any
  `NEXT_PUBLIC_*` variable and never committed. Tests use throwaway values.

**Web client**
- `medika-web/lib/api/types.ts`: `CallTokenResponse` gained optional
  `provider`/`appId`/`streamId`/`tokenTtlSeconds`. The client NEVER assumes
  a provider — it follows the server's response. Absent `provider` (older
  backend) keeps the LiveKit path.
- `medika-web/lib/call/zego-session.ts`: `ZegoCallSession` bridges ZEGO to
  the SAME machinery the page already has — the pure phases state machine,
  the calm eligibility wait, the WS signaling (call:start once per session;
  call:ended/call:rejected → end call), the in-call chat overlay and the
  UI. ZEGO `RECONNECTING`/`RECONNECTED` surface as true automatic
  reconnection states; `DISCONNECTED`/`KICKOUT` (not user-caused) surface as
  an unexpected disconnect with a REAL retry that re-fetches a fresh token;
  capture denials (`NotAllowedError`) surface as the permission failure
  state. Camera mute uses the ZEGO-recommended track `enabled` toggle; mic
  mute uses `muteMicrophone` plus track enable.
- The call page branches on `res.provider === "zego"` AFTER the token fetch;
  the LiveKit code path is unchanged byte-for-byte otherwise. Local/remote
  video use the same host elements and styling (muted local preview,
  `object-fit` cover/contain, voice mode hides the remote video host while
  audio keeps playing).
- Token renewal: on `tokenWillExpire` the page re-POSTs `/api/call/token` —
  every renewal re-runs the FULL server authorization funnel (membership +
  EN_COURS) — and hands the fresh token to `renewToken`. A failed renewal
  never silently extends a grant; room events surface the outcome.

**Dependencies**
- Added `zego-express-engine-webrtc` (^3.13.0) to `medika-web` only.
- LiveKit dependencies are intentionally NOT removed yet (see rollout).

## 4. Environment variables (Preview/Development only)

Configured by the owner in Vercel for the `medika` project (Preview and
Development scopes only, NOT Production):

| Variable | Role | Exposure |
|---|---|---|
| `CALL_PROVIDER` | `zego` to switch non-production calls to ZEGO | server |
| `ZEGOCLOUD_APP_ID` | ZEGO project id (number) | server + sent to browser in the token response (public by design) |
| `ZEGOCLOUD_SERVER_URL` | public engine endpoint (wss://…) from the ZEGO console | server + sent to browser (public by design) |
| `ZEGOCLOUD_SERVER_SECRET` | token04 minting secret (32 chars) | **server only — never client, never logs** |
| `ZEGOCLOUD_APP_SIGN` | not used by token04 auth | **server only; kept unused** |

`.env.example` documents empty placeholders only. Missing ZEGO configuration
on a preview call answers 503 with a clear `ZEGOCLOUD non configure`
message — it never silently falls back to LiveKit and never breaks existing
LiveKit production deployments.

## 5. Rollout boundary and rollback

- Production continues on LiveKit with zero code-path change: `config.callProvider`
  collapses to `livekit` on production deployments regardless of env vars.
- Rollback = remove `CALL_PROVIDER=zego` (or set `livekit`) on the Vercel
  Preview/Development scopes. No code or dependency change required.
- LiveKit code and dependencies remain in place until acceptance; removal is
  a separate, explicitly documented cleanup decision.

## 6. Manual two-device test steps (owner / preview devices)

Environment: Vercel Preview deployment with `CALL_PROVIDER=zego` and the
`ZEGOCLOUD_*` Preview variables set. Use one doctor device and one patient
device (browser or PWA), on different networks if possible.

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
   tokens (403); with ZEGO vars removed the preview answers 503 (no LiveKit
   fallback).
9. **Secrets hygiene** — browser devtools network tab: the token response
   contains appId/serverUrl/streamId/token but never the ServerSecret or
   AppSign; no console log contains credential material.

## 7. Automated verification actually performed

- Root backend suite: **37 files / 418 tests passed** (includes 15 new tests:
  token04 format + decrypt round-trip + error codes, provider gate defaults /
  preview / development / production fail-safe / unknown values, zego token
  route happy path + payload pinning + non-member 403 + RECHERCHE_MEDECIN
  403 + missing-config 503 no-fallback; existing LiveKit tests unchanged and
  green).
- medika-web: **37 files / 477 tests passed** (9 new ZegoCallSession tests:
  provider guard, server-derived identity, voice mode, room-reason mapping,
  own-stream filtering + remote ADD/DELETE, token renewal, permission
  failure, toggles without teardown, idempotent disconnect); `tsc --noEmit`
  clean; `next lint` clean; `next build` succeeded.

## 8. Known limitations / not yet verified

- No real-device or video-quality verification has been performed by the
  agent (owner-only step). Acceptance criteria requiring an actual
  authenticated ZEGO call remain unchecked until the owner runs the
  two-device script on a preview deployment.
- The temporary ZEGO test project credentials must be rotated/revoked after
  testing (owner note in the issue).
- Android impact: none (Agora calls + ZIM chat untouched); documented here
  to make the scope boundary explicit.
