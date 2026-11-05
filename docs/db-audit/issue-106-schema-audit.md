# Issue #106 — Phase 1 read-only audit (production schema / migration mismatch)

**Status: static (repo-side) lane COMPLETE · live (database) lane BLOCKED pending owner-side verification · no production system was touched.**

Audited commit: `8b2030e` (current `main`, production deployment READY per Vercel commit-status 2026-11-05T21:35:52Z). Every statement below is traceable to a file in this repo at that commit; live-database statements are restricted to what issue #106 itself reported and are re-derivable only by the owner.

---

## 1. Method

- Read every migration file `001`–`013` in full (no filename inference).
- Read `scripts/migrate.js` in full and its full git history (`--follow`).
- Inspected `vercel.json`, root `package.json` scripts, `.github/workflows/*`, `server.js` startup, `.env.example`, `docs/DEPLOYMENT.md`.
- Mapped each production runtime error reported in #106 to the exact SQL in `src/`.
- Reconciled the reported production table count against the schema objects the recorded migrations create.

---

## 2. Production state reconciliation (strong internal consistency)

Reported production facts (#106): PostgreSQL 18.6, **12 public tables**, `schema_migrations` = {`001_init.sql`, `002_messaging_upgrade.sql`, `003_message_client_id.sql`, `006_doctor_verification.sql`}.

Schema objects created by 001–003 + 006:

| Source | Objects |
|---|---|
| `001_init.sql` | `schema_migrations`, `users`, `specialties`, `consultations`, `messages`, `payments`, `tickets`, `ticket_messages`, `consultation_notes`, `medical_histories` (10 tables) |
| `002_messaging_upgrade.sql` | `consultation_attachments` (+1 → 11) |
| `003_message_client_id.sql` | column only |
| `006_doctor_verification.sql` | `verification_audit_log` (+1 → **12**) |

**12 = exactly the reported production count.** The reported history and reported table census are mutually consistent — the inspected database is a coherent `001+002+003+006` state. This makes "the audit inspected a random unrelated database" unlikely, though #106's step-2 identity confirmation is still mandatory before any write (§9).

## 3. Migration mechanism (how migrations actually run)

- `scripts/migrate.js` (148 lines, **never modified since creation** — verified via `git log --follow`):
  - applies `db/migrations/*.sql` in **lexicographic filename order**;
  - per file: `BEGIN` → execute → `INSERT INTO schema_migrations (id) VALUES ($1)` → `COMMIT` — **each migration is transactional**; a partial failure rolls back that file completely;
  - **stops on the first failure** (`break`, exit code 1) — it never skips a failed file and never records a file that did not apply;
  - records the **filename** as the id (matches the production history format);
  - after the loop (even after a failure) it still seeds specialties/admin — noteworthy but harmless.
- **No deploy-time migration hook exists**: `vercel.json` defines the three services (`web`, `admin`, `api`) with no `buildCommand` migrations; `server.js` never runs migrations at boot; the two GitHub workflows (`consultation-deadlines.yml`, `notification-dispatch.yml`) are HTTP schedulers only. **Migrations reach production exclusively via a manual `DATABASE_URL=… npm run migrate`.**

## 4. Per-migration analysis (004–013)

| # | File | Objects / changes | Additive? | Data-mutating? | Destructive? | Lock risk | Error mapped (§7) |
|---|---|---|---|---|---|---|---|
| 004 | consultation_lifecycle | `consultations` +`offer_deadline`/`accepted_at`/`expires_at`/`reroute_after` (all NULL-able), status CHECK re-added admitting `EXPIRE`, `consultation_offers` table, 3 partial indexes | yes | no | no (CHECK keeps all legacy values) | brief CHECK re-validation on `consultations` | E3 (42703) |
| 005 | doctor_wallet_payouts | `payouts`, `doctor_earnings` + 4 indexes | yes | no | no | low | — (wallet features silently degraded) |
| 006 | doctor_verification | `users` +`verification_status`/`verified_at`/`verified_by` + CHECK, `verification_audit_log` | yes | no | no | low | — (**already applied in prod**) |
| 007 | push_notifications | `push_subscriptions`, `notification_outbox`, `notifications`, `notification_preferences` | yes | no | no | low | E1 |
| 008 | one_active_consultation | `consultations` +`close_reason`, 2 plpgsql functions, 2 partial unique indexes | yes | **YES — `reconcile_duplicate_active_consultations()` closes duplicate blocking consultations to `EXPIRE` + inserts a system message** (rerunnable, aggregate-only logging, nothing deleted) | no | row locks on blocking rows; brief | — (uniqueness rule not yet enforced) |
| 009 | prescription_documents | `prescription_documents` + 3 indexes (incl. one-active-per-consultation unique) | yes | no | no | low | E4 |
| 010 | medication_orders | `partner_pharmacies`, `medication_orders`, `pharmacy_quotes`, `medication_order_events` | yes | no | no | low | E5 |
| 011 | medication_payments | `medication_payments`; CHECK replace on `medication_orders.status` (+`PAID`) and `medication_order_events.event_type` (+`PAYMENT_VERIFIED`) | yes | no | no | brief CHECK re-validation | E5 |
| 012 | medication_payment_hardening | `medication_payments` +4 cols; CHECK widen (`REVIEW`); index | yes | **YES — backfill `UPDATE medication_payments SET quote_id=…` guarded by `quote_id IS NULL`** (no-op on empty table) | no | low | E5 |
| 013 | medika_delivery_operations | `users.role` CHECK +`delivery`; `delivery_zones` (+1 **INACTIVE** seed row, fail-closed), `medication_orders` +`delivery_city`/`delivery_zone_id`, `medication_deliveries`, `medication_delivery_events`, `medication_delivery_expenses`, `medication_delivery_budgets` | yes | **YES — inserts one INACTIVE zone row** (`ON CONFLICT DO NOTHING`; nothing serviceable until an admin activates) | no | brief CHECK re-validation on `users` | E2 |

No migration issues destructive SQL (`DROP TABLE`, `DELETE`, column drops). All object creation is `IF NOT EXISTS`-guarded; constraint drops are `IF EXISTS`. All amounts remain integer HTG; no financial invariants weakened.

## 5. Dependency / order map (why filename order is the repair order)

```
001 → 002 → 003 → [004 → 008] (008 sets status='EXPIRE'; requires 004's CHECK)
                → [006]        (independent: touches users only)
       005                    (independent: users/consultations/payments from 001)
       007                    (independent: users only)
       009 → 010 → 011 → 012 (FK chain: prescription_documents → medication_orders → payments/hardening)
                    010 → 013 (medication_orders FK + users CHECK)
```

- **004, 005, 006 are mutually independent** (consultations vs new tables vs users). Therefore replaying `004`, `005` on a database where `006` is already recorded — in filename order, exactly what the existing runner does (it skips recorded ids) — is schema-safe. No out-of-order hazard exists anywhere in this chain **provided filename order is respected**.
- The runner requires no code change for the repair.

## 6. The 006 anomaly (006 recorded; 004/005 absent)

The current runner **cannot** have produced this history in a single pass: it applies in filename order and stops at the first failure. A run that reached `006` necessarily recorded `004`/`005` first. Since `git log --name-status` shows the files were added once, in order (004/005 in `90a1883`, 006 in `04360ef`), and never renamed or deleted, plausible explanations are:

1. **Out-of-band application**: an operator applied `006` directly (e.g., during the trust-feature rollout) — via psql — and inserted its id into `schema_migrations` in the runner's format (or a tool did).
2. **A historical failure + manual workaround**: 004 (or 005) failed on production data at the time, and the operator manually applied only 006.
3. History-table timestamps would disambiguate: if `applied_at(006)` is **not** between `applied_at(003)` and `applied_at(007)` — or 006's `applied_at` predates 004's commit date — out-of-band application is proven. **Requires the live read-only query (§9, Q3).**

Notably, the observed runtime errors are consistent with 004/005 being absent **and** 006 being present (§7), so the anomaly is real state, not an inspection artifact.

## 7. Runtime error → missing object mapping (verified against source at `8b2030e`)

| # | Observed production error | Exact code | Missing object | Migration |
|---|---|---|---|---|
| E1 | `GET /api/notifications/unread` — DatabaseError ×20 | `src/routes/notifications.js:139` `SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL` (also `:132`) | `notifications` table | **007** |
| E2 | `GET /api/delivery-zones` — DatabaseError ×5 | `src/routes/medication-orders.js:36` → reads `delivery_zones` | `delivery_zones` table | **013** |
| E3 | Opportunistic lifecycle enforcement — `42703 undefined column` ×5 | `src/consultation-lifecycle.js:120-155` writes `offer_deadline` / `reroute_after` on `consultations` | 4 columns from **004**; amplified every 10 min by the GitHub Actions deadline scheduler hitting the same endpoints |
| E4 | Consultation prescription endpoints — DatabaseError | `src/repos/prescriptions.js:175,196` reads/inserts `prescription_documents` | `prescription_documents` table | **009** |
| E5 | Consultation medication-order endpoints — DatabaseError | `src/repos/medication-orders.js:428,438,533,604` uses `medication_orders`; quote/payment flows use `pharmacy_quotes`, `medication_payments` | tables of **010/011/012** |

Also degraded (no error observed yet): doctor wallet/payouts ledger absent (005) → earnings never materialize; one-active-consultation invariant not enforced (008); push subscriptions/outbox absent (007).

## 8. Constraint-naming pre-flight (repair-safety check)

Later migrations drop constraints by explicit name (`consultations_status_check` in 004, `users_role_check` in 013, `medication_orders_status_check` / `medication_order_events_event_type_check` in 011/012, `medication_payments_status_check` in 012). On any database built by this chain in filename order, PostgreSQL auto-names inline single-column CHECKs exactly `<table>_<column>_check`, so the `DROP … IF EXISTS` + re-`ADD` pairs behave correctly. **Pre-flight requirement before repair (live, read-only):** confirm the actual constraint names in the production catalog (§9, Q4) — a database whose constraints carry collision-suffixed names would make a `DROP IF EXISTS` a silent no-op and leave a stale stricter CHECK alongside the new one (e.g., status `EXPIRE` or role `delivery` would then fail at runtime).

## 9. Open items requiring the owner (live lane of phase 1 — steps 2–3)

The agent has no Vercel/Neon access and must never handle or reveal credentials. Requested (non-secret, read-only):

- **Q1 (identity):** confirm which Neon project/branch/database is wired to the Vercel **production** environment (`DATABASE_URL`, Production scope). Non-secret identifiers only (project name/id, branch name, database name, region).
- **Q2 (preferred execution path):** create a **Neon branch** of the production database and grant the agent access to that branch, or run the phase-1 queries below on the owner's side. A branch gives the repair a full-fidelity rehearsal target with zero production risk.
- **Q3 (history + anomaly):** `SELECT id, applied_at FROM schema_migrations ORDER BY applied_at;`
- **Q4 (catalog pre-flight):** constraint names + table census:
  `SELECT conrelid::regclass AS tbl, conname FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace ORDER BY 1,2;`
  and `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;`
- **Q5 (column presence):** `SELECT column_name FROM information_schema.columns WHERE table_name='consultations' AND column_name IN ('offer_deadline','accepted_at','expires_at','reroute_after','close_reason');` — expected: 0 rows now, 5 after repair.

## 10. Phase 2 repair plan (draft — NOT executed; approval gate applies)

1. **Rehearsal on a Neon branch of production** (Q2): run `npm run migrate` against the branch. Expected: applies `004, 005, 007, 008, 009, 010, 011, 012, 013` in filename order; skips recorded `001, 002, 003, 006`. Zero failures expected; 008's reconcile reports aggregate kept/cancelled counts on branch data.
2. **Data-impact review on the branch**: inspect 008's cancelled rows (status `EXPIRE`, `close_reason='duplicate_open_consultation'`), 012's backfilled `quote_id`s, 013's single INACTIVE seed row. No deletions anywhere.
3. **Apply to production** only after explicit owner approval, via the existing runner (`DATABASE_URL=… npm run migrate`) — no new runner, no automatic hook. Estimated duration: seconds-to-low-minutes total; longest statements are CHECK re-validations on `users`/`consultations` (small tables). Downtime: none expected; brief row locks during 008's reconcile of blocking rows.
4. **Rollback / recovery**: Neon branch restore point / backup verified **before** starting (issue-mandated). Each migration commits atomically; a mid-run failure leaves all previously committed migrations in place and the failed one fully rolled back — re-running after correction resumes cleanly (recorded ids are skipped).
5. **Post-migration verification (read-only)**: Q3/Q4/Q5 re-queries; then endpoint smoke tests: unread notifications, delivery-zones, lifecycle enforcement (no 42703), prescription issuance/retrieval on a test consultation, medication-order + quote + MonCash payment flow with existing payment records untouched, patient/doctor consultation workflows.
6. **Runtime confirmation**: Vercel production logs show no new DatabaseError/42703 occurrences after repair.

## 11. Local-validation note

The agent sandbox has no local PostgreSQL and installing one is not possible in this environment; the Neon-branch rehearsal (§10.1) is strictly stronger than a local test database because it rehearses against real production data shape. This satisfies the issue's "local/test-database validation" lane as soon as the branch exists.
