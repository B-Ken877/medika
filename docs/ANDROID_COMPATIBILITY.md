# Android Compatibility & Migration Notes

The existing Android apps (patient + doctor, one APK, `BASE_URL =
https://medikahaiti.site/`) are **preserved** by this migration: no Kotlin
source was changed, and every REST route, request body and response shape they
use is implemented with the same contract. The table below is the complete
compatibility matrix, including the small number of behavior changes that are
inherent to fixing critical security findings.

## What keeps working unchanged

| Feature | Notes |
|---|---|
| Login / register / admin login | Same request/response shapes; the returned token is now a JWT (Android treats it as an opaque string — it echoes whatever login returns). |
| Doctor listing / specialty pricing | Same shapes. `GET /api/doctors` no longer returns doctors' `email`/`phone` (PII hardening); `license_number` and everything the profile cards render are unchanged. |
| Consultation create / list / detail / messages | Same shapes, same status enum. `created_at` etc. remain unix seconds. Message ids remain numeric. |
| Accept / reject / prescription | Same shapes. Doctors can now only act on consultations they are allowed to act on (unassigned queue items or their own) — the atomic claim also removes the double-accept race. |
| Tickets (list / create / detail / message) | Re-implemented server-side from the Android contract (`{content, file_url, file_type, file_size}` bodies, `messages[]` embedded in detail, `open`/`closed` status, 409 on closed tickets). |
| Medical history / snapshot / update | Re-implemented from the Moshi DTOs (all snake_case fields, camelCase update request). Notes auto-update the dossier (medications, chronic conditions, timeline) exactly as documented in the README. |
| MonCash payment flow | Same endpoints (`/payment/api/payment/create` + `/verify`), same response shapes incl. `payment.status === "completed"` and `payment.transactionId`. Server now verifies with MonCash before answering success. |
| Profile, availability, admin CRUD, stats, finance | Same shapes. |
| Zego ZIM chat (primary path) | Not touched by this migration. |
| Agora calls + `/token` server | Not part of this repo — keep the existing host serving `/token` (see DEPLOYMENT §7). |

## Behavior changes (security-driven)

1. **One-time re-login for every user.** The legacy bearer token *was* the raw
   user id, which let anyone impersonate anyone (user ids are public — the
   doctor list returns them). Tokens are now JWTs: previously stored tokens
   fail with `401` and the app's normal login flow re-authenticates. This is
   the coordinated authentication migration; it is safe because login itself
   is unchanged.
2. **WebSocket fallback chat needs an app update (v2 auth frame).** The
   Android WS client sends `{type:'auth', userId}` — which authenticated
   nothing — and the migrated backend rejects it with an `auth:error` frame
   and closes the socket. Until the app sends `{type:'auth', token:<jwt>}`
   (a ~5-line change in `GeminiApi.kt`'s `connectWebSocket`), the Android
   **ZIM primary chat path continues to work**, and message history still
   arrives via REST (`GET /api/consultations/{id}/messages`). Only the
   WS-fallback delivery is paused.
3. **Consultation creation now requires a verified payment** (when
   `REQUIRE_PAYMENT=true`, the production default). The Android flow already
   always pays before creating (`SymptomIntakeScreen` → `PaymentActivity` →
   `selectDoctorAndSendRequest(transactionId, paymentAmount, orderId)`), so
   compliant flows are unaffected. Server-side consequences:
   - an un-paid or under-paid order is rejected (`402`),
   - the same order cannot buy two consultations (`409`),
   - a payment made by another account cannot be used (`402`).
   If MonCash credentials are not configured, payment endpoints fail closed
   (`503`) and consultation creation answers `402`.
4. **Upload cap is 4 MB** (Vercel Functions reject request bodies > 4.5 MB).
   Typical Android voice notes (AMR/AAC) and photos stay well under this;
   large videos will fail with `413`. Full-size media needs a future client
   update (direct-to-Blob upload) or an always-on upload proxy.
5. **Uploaded file URLs are absolute** (Vercel Blob) instead of relative
   `/uploads/...` paths. Android already treats them as opaque strings inside
   messages. Historical relative URLs keep resolving during migration via a
   302 redirect to `LEGACY_UPLOADS_ORIGIN`.

## Known, pre-existing gaps (unchanged by this migration — documented, not silently removed)

- **Android ↔ web calls do not interoperate**: Android uses Agora rooms, the
  web PWA uses LiveKit rooms (both get tokens after server-side
  authorization). This predates the migration; unifying requires a product
  decision (migrate Android to LiveKit, or the web to Agora).
- **ZIM messages are not persisted server-side** (Zego relays them
  peer-to-peer); the WS path persists. Android↔Android chat history therefore
  lives on-device, as today.
- Android notifications screen has no dedicated backend endpoint (events are
  derived client-side from WS/consultations), unchanged.

## Suggested future Android updates (not required for cutover)

1. Send `{type:'auth', token}` on the WS (restores the fallback chat path).
2. Send chat messages through `POST /api/consultations/{id}/messages` (new,
   additive REST endpoint with identical semantics) when the WS is unavailable
   instead of dropping to failed status.
3. Direct-to-storage uploads for large media.
4. Raise the client password minimum from 4 characters in coordination with
   the backend.
