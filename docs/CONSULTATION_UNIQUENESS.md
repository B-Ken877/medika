# One Active Consultation per Patient and per Doctor (issue #60)

This document describes the server- and database-enforced invariant that
prevents overlapping consultations, the deterministic reconciliation of
legacy duplicates, and the bounded pending-request timeout. It is the
reference for the migration `db/migrations/008_one_active_consultation.sql`
and the changes in `src/repos/consultations.js`,
`src/consultation-lifecycle.js` and `src/routes/consultations.js`.

## 1. The invariant

At any moment, **at most one consultation in a blocking state may exist per
patient and per doctor**.

- **Blocking states** (the project's actual status names):
  - `RECHERCHE_MEDECIN` — pending / waiting for a doctor (includes the
    routed-offer holder state and the retryable waiting state)
  - `EN_COURS` — accepted / in progress
- **Non-blocking (terminal) states**: `TERMINE`, `REFUSE`, `EXPIRE`.
  They never prevent new bookings and never appear as active consultations.

The invariant is enforced by the **database**, not only by the API:

```sql
CREATE UNIQUE INDEX uq_consultations_patient_active
  ON consultations (patient_id)
  WHERE patient_id IS NOT NULL
    AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS');

CREATE UNIQUE INDEX uq_consultations_doctor_active
  ON consultations (doctor_id)
  WHERE doctor_id IS NOT NULL
    AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS');
```

Partial unique indexes make every violation impossible at the storage layer:
two simultaneous bookings (double taps, retries, two patients racing for the
same doctor) resolve to at most one active consultation no matter which code
path issued them. `NULL` participant ids (rows orphaned by user deletion) are
excluded — they can never conflict.

## 2. How conflicts are answered (never a generic 500)

`POST /api/consultations` (the single creation path) layers three defenses:

1. **Advisory pre-checks (fast, friendly)**
   - Patient already has a blocking consultation → `409` with
     `{ error, existing_id, existing_status }` so the UI can link back to it.
   - Patient explicitly picked a doctor who already holds a blocking
     consultation → `409` with the clear "doctor is currently busy" answer.
2. **Atomic INSERT with unique-index arbitration**
   - If a concurrent request wins the contested slot between the pre-check
     and the INSERT, the index raises `23505`. The route translates it:
     - `uq_consultations_doctor_active` → the clear doctor-busy 409;
     - `uq_consultations_patient_active` → patient-conflict 409 with
       `existing_id` — **unless** the request carries the very payment that
       bought the active consultation, in which case the issue #40 replay
       semantics apply (see below).
3. **Routing-time reservation fallback**
   - The patient-choice doctor's slot is claimed atomically at INSERT time
     (`doctor_id` is part of the row the index referees). If routing still
     loses a race (23505 while assigning the offer), the request falls back
     to the routing pool once (busy doctors are excluded), and if that also
     loses, it parks in the retryable waiting state. Bounded: at most two
     offer attempts + one wait; never a hot loop; never a failed paid
     request.

`PUT /api/consultations/:id/accept` answers `409 "Ou gen deja yon
konsiltasyon aktif…"` (not a 500) when the doctor-side index rejects a
second blocking consultation — reachable only through legacy-shaped rows
(the routing pool never offers a busy doctor).

### Issue #40 replay semantics are preserved

A double submission carrying the SAME verified payment still replays the
consultation that payment bought (`200` + `payment_replayed: true`), both in
the sequential case (payment already attached) and in the raced case (the
winner request attaches the payment milliseconds after its INSERT; the loser
polls briefly for that attachment — strictly local reads, never a provider
call). An unattached payment is never consumed by a conflict answer.

## 3. Routing skips busy doctors

The routing pool (`NEXT_ELIGIBLE_DOCTOR_SQL`) now excludes any doctor who
currently holds another blocking consultation. Consequences:

- The "20 patients queue up for one doctor" scenario is structurally
  impossible: the first request reserves the doctor, the rest are refused
  with the busy answer (patient choice) or routed to other doctors / the
  waiting state (no explicit choice).
- Availability flags (`users.is_available`) remain informational; the
  reservation is what the database enforces.

## 4. Bounded pending timeout

A `RECHERCHE_MEDECIN` request older than `PENDING_EXPIRY_HOURS` (default
**4 hours**, `src/config.js`) is expired by the scheduled deadline processor
(`processDueDeadlines`, also run opportunistically on reads):

- status → `EXPIRE`, `close_reason = 'pending_timeout'`
- a visible system message is appended to the conversation (history is kept)
- the patient receives the existing `consultation:expired` push

**In-progress consultations are NEVER expired by this pass** — the 5-hour
`EN_COURS` expiry from migration 004 (issue #25) is a separate, deliberate
product rule and is unchanged. A request with a live offer can expire
mid-window once it crosses the bound; `accept()` then answers 404/410 as it
already does for expired offers.

## 5. Legacy duplicate reconciliation (migration 008)

Deploy-order safety: **reconciliation runs BEFORE the unique indexes are
created**, so existing duplicates can never fail the migration. The same
SQL function is kept for reruns and is exercised by
`tests/consultation-uniqueness.test.js`.

`reconcile_duplicate_active_consultations()` — deterministic greedy pass:

1. Consider every blocking row newest-first
   (`ORDER BY created_at DESC, id DESC` — the authoritative creation
   timestamp with a deterministic tie-breaker), row-locked.
2. A row is **kept** iff no already-processed (i.e. strictly newer) row that
   is *still blocking* shares its `patient_id` OR its `doctor_id`. Rows not
   yet processed (older) never block the current row — their turn comes
   later in the pass.
3. Every other row transitions to `EXPIRE` with
   `close_reason = 'duplicate_open_consultation'` and a visible system
   message. **Nothing is ever deleted** — full history is preserved.
4. Because cancelled rows immediately stop being blocking, a single pass
   resolves patient/doctor cross-conflicts consistently (the issue's edge
   case: a newer request can take a participant's only slot; older
   conflicting rows are then cancelled in the same pass).
5. A second run finds no conflicts and is a no-op (**safe to rerun**).
6. Completed (`TERMINE`) consultations and unrelated records are never
   touched. Only aggregate counts are logged — never patient-identifying
   details.

Example (the tested cross-participant edge):

| row | patient | doctor | age | outcome |
|-----|---------|--------|-----|---------|
| A | P1 | D1 | 3h | kept |
| B | P1 | D2 | 2h | cancelled (D2 taken by the newer C) |
| C | P2 | D2 | 1h | kept (newest) |

## 6. UI behavior (web)

- `consult/page.tsx` detects an existing blocking consultation up front and
  replaces the booking wizard with a guard panel linking back to it (direct
  to the call for `EN_COURS`). A 409 from the server (stale guard or race)
  switches to the same panel — the refusal is always legible with a next
  step, and the payment context is never lost.
- `ApiError.existingId` carries the server's `existing_id` for the link.
- Dashboards already render only blocking statuses as active; reconciled
  duplicates land in history with their status badge. `close_reason` is
  exposed additively (`Consultation.close_reason`) for future display needs.
- The Android client needs no change: the server refuses duplicates for
  every client, and additive JSON fields are ignored by older parsers.

## 7. Migration safety notes

- `close_reason` is additive (`NULL` for every normal transition and all
  legacy rows); no column is dropped or retyped.
- The reconciliation only transitions blocking duplicates to `EXPIRE` — it
  never deletes rows, never touches `TERMINE`/`REFUSE`/non-blocking data,
  and never alters payments or medical history.
- Safe to run against existing production data: the reconcile pass precedes
  index creation inside the same migration, and the function is rerunnable
  afterwards without effect.
- Deploy order: apply migrations (`npm run migrate`) as usual; no manual
  data fix is required. `scripts/migrate.js` records the migration in
  `schema_migrations` exactly like 001–007.

## 8. Tests

`tests/consultation-uniqueness.test.js` (embedded real PostgreSQL) covers:

- sequential + concurrent (`Promise.all`) same-patient duplicates → exactly
  one consultation, loser gets 409 with `existing_id`
- terminal consultations never block new bookings
- patient-choice of a busy doctor → 409; routing skips busy doctors;
  concurrent same-doctor booking → at most one winner, loser gets the busy
  answer or a graceful reroute; doctor-side invariant verified at the DB level
- legacy broadcast double-accept → 409 (never 500)
- bounded pending timeout: stale pending expires (with `close_reason` +
  system message), young pending and EN_COURS untouched; idempotent rerun
- reconciliation: keeps the newest non-conflicting record per participant
  (cross-participant edge included), preserves history, never touches
  completed records, no-op rerun, and indexes re-creatable afterwards
- migration deploy-order contract (reconcile before indexes)

Existing suites were updated where their fixtures relied on the previously
allowed overlapping bookings (fixture helpers now release participants'
slots first); no production behavior was weakened to make tests pass.
