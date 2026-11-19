# Web Push production setup — operator runbook (issue #50)

This is the **owner-only** configuration checklist that turns the (already
shipped, issue #36) push system on in production. The application code needs
**no changes** for this — the system reports `configured: false` and keeps
in-app notifications working until exactly these steps are done.

**Security rules (non-negotiable):**
- Generate the keys YOURSELF, on YOUR machine. Never ask an agent, a
  collaborator, or a third party to generate or transport the private key.
- The private key never goes into the repository, a PR, an issue comment, a
  chat message, or a screenshot.
- The private key is only ever a **server-side** environment variable
  (`VAPID_PRIVATE_KEY`). It must NEVER use a `NEXT_PUBLIC_` variable — anything
  prefixed that way is compiled into the browser bundle and is public.
- Only `VAPID_PUBLIC_KEY` (via the authenticated endpoint) ever reaches clients.

## 1. Generate a matching VAPID key pair (locally)

```bash
npx web-push generate-vapid-keys
```

This prints two values — keep them on screen only:

```
Public Key:  <B… 87 chars, base64url>
Private Key: <base64url string>
```

Both values come from the SAME pair. If you ever regenerate, all existing
browser subscriptions become invalid and users must re-enable push — so
generate once, store the pair in your password manager, and rotate only if
the private key is compromised.

## 2. Set the environment variables (Vercel project: the API service)

Project settings → Environment Variables → add for **Production** (and
**Preview** if you want push testable on preview deployments):

| Name                | Value                             | Notes |
|---------------------|-----------------------------------|-------|
| `VAPID_PUBLIC_KEY`  | public key from step 1            | served to authenticated clients by `GET /api/notifications/vapid-public-key` |
| `VAPID_PRIVATE_KEY` | private key from step 1           | server-side only — never exposed, never logged |
| `VAPID_SUBJECT`     | `mailto:you@yourdomain.tld`       | optional; defaults to `mailto:admin@medika.ht`. Use a mailbox you actually watch — push services use it for abuse contact. |

Scope them to the **api** service (the Express project). The web service
never needs any VAPID variable — the public key is fetched from the API at
runtime, which is what keeps key rotation a server-side-only operation.

## 3. Redeploy (required)

Environment variable changes only take effect for NEW deployments. After
saving the variables, redeploy the API (Vercel dashboard → Deployments →
Redeploy, or push any commit). Until then the endpoint keeps answering
`configured: false` — that is the designed rollout switch, not a bug.

## 4. Make sure the dispatcher runs (delivery latency)

The outbox is drained by `GET/POST /api/crons/notification-dispatch`. A
ready-made GitHub Actions workflow ships in this repo:
`.github/workflows/notification-dispatch.yml` (every 5 minutes). One-time
repo settings:

- Repository secret `CRON_SECRET` — the same value as the API's
  `CRON_SECRET` environment variable (generate: `openssl rand -hex 32`).
- Optional repository secret `PRODUCTION_URL` if the deployment URL is not
  the default the workflow assumes.
- The API project also needs `CRON_SECRET` set (Production) for the cron
  authorization to pass.

Without a scheduler, pushes still drain opportunistically: every authenticated
notification read (the header bell's unread poll, the history fetch) triggers a
throttled dispatch, so any user opening Medika drains due rows for everyone.
The workflow remains the background-latency guarantee for pushes that must
arrive while nobody is using the app (device closed, app killed). Duplicate or
overlapping runs are harmless (FOR UPDATE SKIP LOCKED + stable idempotency
keys).

## 5. Verify (in order)

1. **Endpoint (authenticated):** sign in in the browser, then
   `GET /api/notifications/vapid-public-key` (DevTools network tab while
   opening the notification center) → must return
   `{"publicKey":"B…","configured":true}` — exactly two fields, never the
   private key. Unauthenticated calls return 401.
2. **UI:** notification center → enable push → the browser permission prompt
   appears → after granting, the toggle reports enabled and the failure
   message is gone. If anything goes wrong, the UI now says WHICH state:
   unconfigured (`server-disabled`), network/server problem
   (`server-unreachable`), server rejected the registration
   (`registration-failed`), or a device limitation (`unsupported-browser`,
   `denied`, …).
3. **Subscription persisted:** the row appears in `push_subscriptions` for
   the signed-in user (active, `revoked_at` null).
4. **Dispatch pipeline:** run the workflow manually
   (Actions → Notification dispatcher → Run workflow) and check its output —
   aggregate counts only (`claimed / delivered / suppressed / retryable /
   revoked / dead / unconfigured`). After configuring VAPID the first runs
   should show `unconfigured` disappearing and previously queued rows
   draining (`delivered` or `suppressed`).
5. **Real device (the only proof of delivery):** Android Chrome with the app
   backgrounded, notification received and tappable to the deep link. This
   step cannot be automated and is intentionally left to the operator —
   automated tests only cover the contracts (see PUSH_NOTIFICATIONS.md
   "Verified vs unverified").

## 6. Rollback / off switch

Unset `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` and redeploy: pushes stop, rows
queue harmlessly, in-app notifications continue. Re-set and redeploy to turn
back on. Rotating the keys does NOT require a redeploy (config is read per
call) — but rotating invalidates existing subscriptions (users re-enable).

## 7. First-login permission bootstrap (owner request, Nov 2026)

On the first login of an account on a device, the app now asks for camera,
microphone and push-notification permission automatically — fired from the
login/register submit click (a genuine user gesture), with a one-tap fallback
card inside the authenticated shell for browsers that swallow programmatic
prompts (iOS Safari, Chrome quiet-UI). The per-account, per-device flag lives
in localStorage (`medika_perm_bootstrap_<userId>`), so the app never nags
twice for the same account on the same device.

Practical consequences for this runbook:
- Fresh users no longer need to visit the notification settings page to turn
  push on: granting the login prompt subscribes the device immediately (the
  subscription registration still needs the VAPID variables above — without
  them `enablePush` reports `server-disabled` and the user is simply not
  subscribed, exactly as before).
- Users who previously granted notification permission in the browser but
  never subscribed get wired up automatically on their next visit (quiet
  re-enable, no new prompt).
- The explicit settings page (`/app/settings/notifications`) remains the
  manual enable/disable/retry path; the logout push revocation is unchanged.


## 8. What changed in November 2026 (medication push + read-aware suppression)

Two owner-requested fixes landed on top of this system:

**Medication push coverage.** The full medication lifecycle now flows through
the SAME dispatcher as consultation events — `medication:order-submitted`
(order REQUESTED → ops admins), `medication:quoted` (→ patient),
`medication:paid` and `medication:payment-review` (→ patient + admins),
`medication:delivery-assigned` / `medication:delivery-update` (→ patient).
All payloads are generic copy: no medication names, patient names or medical
data ever leave the server. If medication pushes still do not arrive in
production, check IN ORDER: (1) the recipient's device actually has a push
subscription (`push_subscriptions`, `revoked_at IS NULL` — fresh patient
devices get asked on first login by the permission bootstrap);
(2) `VAPID_*` is configured (§2); (3) `CRON_SECRET` is set (§4) — without it
delivery waits for SOMEONE to open the app.

**Read-aware chat suppression.** A new message only suppresses the recipient's
push when they are ACTIVELY VIEWING that exact conversation (per-connection
`consultation:viewing` frame, membership-validated server-side) AND their
read receipt (`POST /api/consultations/:id/read`) actually lands. Viewing
alone arms a 30-second grace window on the queued row; a read receipt marks
it `suppressed` (`read_in_conversation`), otherwise it dispatches normally —
an unread message is never silently lost. Merely being online, browsing
another page or viewing a different conversation still gets a push.
Medication/payment/delivery/consultation lifecycle pushes are NEVER
suppressed by connectivity or viewing state.
