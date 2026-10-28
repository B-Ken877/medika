# Push notification system (issue #36)

## Architecture

```
business transition (consultations, chat, calls, wallet, payouts)
  └─ notifications.emit()            fire-and-forget, never throws
       ├─ notifications              in-app history row (always kept)
       └─ notification_outbox        durable outbox row (queued)
                                      │
GET/POST /api/crons/notification-dispatch  (Vercel cron / GH Actions / manual)
  └─ dispatchDueNotifications()      claim (FOR UPDATE SKIP LOCKED)
       ├─ preference off?            → suppressed
       ├─ no active subscription?    → suppressed
       ├─ web-push 2xx               → delivered
       ├─ 404/410                    → subscription revoked → revoked
       ├─ 429/5xx/network            → retryable (backoff 1m→6h, max 6) → dead
       └─ other 4xx                  → dead
```

## Event matrix

| event | emitted at (commit point) | recipient | idempotency key | push policy |
|---|---|---|---|---|
| consultation:submitted | POST /consultations after create+route | patient | `consultation:{id}:submitted` | normal |
| consultation:offer | POST /consultations, reject-reroute, lifecycle reroute — after the offer commits | offered doctor only | `consultation:{id}:offer:{doctorId}` | high priority |
| consultation:accepted | PUT accept after transition | patient | `consultation:{id}:accepted` | normal |
| consultation:rejected | PUT reject, definitive REFUSE only | patient | `consultation:{id}:rejected` | normal |
| consultation:rerouted | lifecycle reroute commit (coalesced: one per consultation) | patient | `consultation:{id}:rerouted` | normal |
| consultation:expired | lifecycle 5h expiry commit | patient | `consultation:{id}:expired` | normal |
| consultation:completed | PUT prescription after transition | patient | `consultation:{id}:completed` | normal |
| message:new | WS hub + REST fallback, after persistence | recipient | `message:{msgId}` | suppressed while recipient connected (live WS delivery) |
| call:incoming | WS call:start relay | callee | `call:{consId}:{callerId}:{minuteBucket}` | suppressed while connected (live ring) |
| wallet:earnings | materializeEarnings RETURNING (exactly when earnings become AVAILABLE) | doctor | `wallet:earning:{earningId}` | normal |
| payout:paid | POST /admin/payouts/settle after commit (idempotent re-settle dedups) | doctor | `payout:{payoutId}:paid` | normal |

Never notified (by design): typing, recording activity, presence, read
receipts, reconnects, polling, unchanged waiting state, failed/uncommitted
transitions. Waiting-state retries emit nothing.

## Privacy

Payloads are generic Haitian Creole copy only. Message bodies, symptoms,
diagnoses, prescriptions and patient names are never written to notification
tables. Deep links are same-origin app paths; protected content renders only
after normal authentication. Deep-link URLs contain opaque ids only.

## Operations

- **Setup**: `npx web-push generate-vapid-keys` → set `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` (server-side only), `VAPID_SUBJECT`.
- **Unset VAPID = push disabled safely**: the dispatcher no-ops, outbox rows
  stay queued, in-app notifications keep working (rollout/rollback switch).
- **Migration**: run `node scripts/migrate.js` (007 is additive).
- **Scheduler**: point a Vercel cron / the GitHub Actions workflow at
  `/api/crons/notification-dispatch` every ~1–5 minutes (same CRON_SECRET
  authorization as the deadlines cron). Duplicate/overlapping runs are
  harmless (SKIP LOCKED + stable idempotency keys).
- **Monitoring**: the cron response returns aggregate counts (claimed /
  delivered / suppressed / retryable / revoked / dead). Alert on a growing
  `dead` count or a persistently non-zero `retryable` backlog.
- **Keys rotate** without redeploy (the config is read per call).

## Verified vs unverified

Verified by automated tests (366 backend + 335 web): API contracts, outbox
state machine, error classification, idempotency, privacy assertions, event
wiring, VAPID-unconfigured rollout switch, service-worker handler contracts.

NOT verified here (requires real devices/browsers — documented limitation):
actual push delivery on real Android/iOS/desktop browsers, iOS Home Screen
PWA push (iOS 16.4+), and provider outages. The web-push library itself is
exercised against a stub in tests; no claim of real delivery is made.
