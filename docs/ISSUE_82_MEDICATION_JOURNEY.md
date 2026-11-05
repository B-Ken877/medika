# Issue #82 — Complete medication journey: audit, design and migration reconciliation

Working design note for the consolidated implementation (issue #82, owner directive
2026-11-05T17:29Z). Branch: `feat/issue-82-complete-medication-journey`, from
`main` @ `85fb332`.

## 1. What already exists on `main` (audited, keep + improve)

| Area | Source | Status after audit |
| --- | --- | --- |
| Structured, immutable prescription documents | PR #86 (`009_prescription_documents.sql`, `src/repos/prescriptions.js`, `PrescriptionModal.tsx`, `PrescriptionPanel.tsx`) | Sound foundations: DB-enforced single active document per consultation, row-locked atomic issuance coupled to consultation completion, allowlisted item fields, stable `ORD-…` reference, legacy projection preserved. Doctor composer is structured (multi-row, French, no auto-fill). |
| Medication orders + manual pharmacy quotes | PR #87 (`010_medication_orders.sql`, `src/repos/medication-orders.js`, patient routes, admin routes + `medicaments` admin section, `MedicationOrderPanel.tsx`) | Sound: append-only quotes/events, server-recomputed HTG totals, 1:1 quote-line ↔ prescription index, 30-min SLA from server timestamp, lazy+cron sweeps, no substitution. **Gap:** delivery zone is a free-text allowlist from `MEDIKA_MEDICATION_DELIVERY_ZONES` env — issue #82 now requires admin-managed zone RECORDS (fail-closed) and required city. |
| Verified MonCash medication payments | PR #87-squash `57d2073` + hardening `f979f83` (`011_medication_payments.sql`, `012_medication_payment_hardening.sql`, `src/repos/medication-payments.js`, `src/moncash.js`) | Sound: intents bound to the exact quote, server-derived amount, provider-side verification, REVIEW state for expired/changed quotes, no production simulation bypass. |
| Delivery operations | PR #95 `feat/issue-85-delivery-operations-clean` (**closed, reference only**) | Skeleton is useful (zones, employees, 9-state custody chain, expenses, budget, reports, patient confirmation) but was **never tested** (its own PR description admits it) and its migrations `012/013` collide with the merged chain. Audit + integrate properly; do not merge as-is. |

## 2. The coordinator's direct change and its replacement

`7ac67aa` (direct push, later reverted on `main` by `85fb332`) removed the `= {}`
default on `createMedicationOrder(token, consultationId, payload)` in
`medika-web/lib/api/endpoints.ts`.

Root problem the change was groping at: the payload type
`CreateMedicationOrderRequest` declares required fields, but the optional
parameter with `{}` default lets call sites compile while posting an empty
body, which the server then rejects with a 400 — a type-level lie.

**Replacement (implemented on this branch):**
- Remove the invalid `= {}` default — the payload parameter becomes required,
  as the coordinator intended.
- Go further than the reverted one-liner: make the contract express the real
  product requirements — `delivery_address`, `delivery_phone`, `delivery_city`
  and `delivery_zone_id` (an explicitly selected **zone record id**, not free
  text) are all required and typed; the server independently re-validates all
  of them (never trusts the client), so older clients still get precise French
  400/422 errors instead of a 500.
- `MedicationOrderPanel.tsx` collects and sends all required fields; a type
  error now happens at compile time if a field is forgotten.

## 3. Migration chain reconciliation

Current chain on `main`: `001…012` (012 = payment hardening, already merged).
PR #95 added its own `012_medika_delivery_operations.sql` +
`013_medication_payment_lifecycle.sql`.

Findings:
- PR #95's `013` is **functionally a duplicate** of merged `012` (same
  `quote_id`/`verified_amount_htg`/`redirect_url`/`create_started_at` columns,
  same `REVIEW` status, same event-type CHECK). Dropping it loses nothing.
- PR #95's `012` (delivery operations) does not exist on `main` and is needed.

Resolution on this branch (one unambiguous sequential chain from latest main):
- `001…012` stay untouched.
- `013_medika_delivery_operations.sql` — the delivery migration, renumbered,
  with additive/`IF NOT EXISTS` semantics, extended beyond the PR #95 draft:
  - `users` role CHECK extended with `'delivery'` (admins provision accounts;
    public registration stays patient-only).
  - `delivery_zones` (city + zone_name UNIQUE, admin-toggled `active`; seed
    row inserted **inactive** — fail-closed until an admin activates it).
  - `medication_orders.delivery_city` + `medication_orders.delivery_zone_id`
    (FK to `delivery_zones`) so an order is bound to the exact active zone
    record that was validated at creation time.
  - `medication_deliveries` (9-state custody CHECK matching the issue list),
    `medication_delivery_events` (append-only, UNIQUE idempotency key),
    `medication_delivery_expenses`, `medication_delivery_budgets`.

## 4. Gap plan against the issue's Definition of Done

| # | Requirement | Gap → work on this branch |
| --- | --- | --- |
| 1 | Doctor composer, atomic issuance | Exists; audit tests, keep. |
| 2–3 | Beautiful on-screen HTML «Ordonnance médicale» + real PNG/A4 | Panel exists but is a plain card, and fetch errors are silently swallowed. Rebuild as a dedicated document view: white document surface, Medika green accents, document header/footer, proper typography, loading/empty/retryable-error states, legacy fallback ONLY on genuine 404. Keep html2canvas PNG (lazy) + A4 print isolation; verify long/multi-row documents render completely. |
| 4 | No prices in ordonnance | Already guaranteed by construction (server allowlist + component); add regression tests at UI level. |
| 5 | Independent purchase path | Make «Télécharger l'ordonnance et acheter les médicaments en pharmacie» explicit in the French flow. |
| 6 | Sourcing request | Exists; extend payload to city + zone record id (§2), dedupe already DB-enforced. |
| 7–8 | WhatsApp sourcing queue + quote review | Exists (admin `medicaments`, patient `MedicationOrderPanel`); swap env zone allowlist for `delivery_zones` records (fail-closed, admin CRUD), keep append-only quotes/SLA. |
| 9 | Verified MonCash on accepted quote | Exists; keep invariants, extend tests for expired/changed-quote paths. |
| 10–11 | Delivery ops: zones, employees, assignment, Friday schedule, urgent exceptions, custody, expenses, reports | Integrate PR #95 skeleton (renumbered migration 013, `src/repos/deliveries.js`, patient/employee/admin routes, admin `livraisons` page, `medika-web/app/livreur` portal) after audit; enforce Friday scheduling server-side, paid-orders-only assignment, employee isolation in every query, reasoned urgent exceptions, patient handoff confirmation. |
| 12–13 | Employee portal + patient tracking/confirm | From PR #95, hardened + French + tested. |
| 14 | Delivery free to patient; internal expenses separate | Expenses ledger already separate; patient flow must never show a delivery fee (regression tests). |
| 15 | French everywhere | All new copy French; code identifiers English. |
| 16 | Existing flows healthy | Full backend/web/admin suites + typecheck + lint + builds must pass; consultation payments untouched. |
| 17–18 | Test evidence + one PR | Run every suite for real; document exact commands/counts, migration order, screenshots, walkthrough in the PR. |

## 5. Implementation order (phases, persisted in `.agent-state/STATE.md`)

- **P0** audit + this design note (done in the P0 commit).
- **P1** migrations: `013_medika_delivery_operations.sql` (+ repo helpers), order
  payload city/zone contract (backend + web), tests.
- **P2** patient ordonnance rebuild (document view, PNG/print, states) + tests.
- **P3** delivery integration: repo/routes/portal/admin, Friday + urgency +
  custody + isolation, tests.
- **P4** zones/employees admin UX + sourcing flow swap to zone records.
- **P5** full verification pass (backend, web, admin, typecheck, lint, builds),
  PR with evidence.

Every phase: run the affected suites for real before committing; never mark
DONE ahead of verification.
