Last updated: 2026-11-05T05:20:00Z (cron-202611051316)

## Active issue
- #83 IN PROGRESS (claimed run cron-202611051316). Branch
  feat/issue-83-medication-orders created from latest main ed02c26
  (includes merged #82 — PR #86 was merged by owner at 05:15:43Z; #82
  closed, stale IN REVIEW label removed).
- #83 scope: medication orders + manual pharmacy quote operations.
  Plan: migration 010 (partner_pharmacies, medication_orders,
  pharmacy_quotes, medication_order_events); repo
  src/repos/medication-orders.js (row-locked state machine, server-side
  transition validation, 30-min SLA from requested_at, lazy+cron
  ESCALATED/EXPIRED sweeps); patient routes
  src/routes/medication-orders.js (create/fetch/accept/decline/cancel);
  admin routes src/routes/admin-medication-orders.js (pharmacy directory,
  ops queue buckets, quote recording, unreachable); crons endpoint
  /api/crons/medication-deadlines; admin UI « Médicaments et pharmacies »
  (medika-admin/app/(admin)/medicaments + nav entry); patient web
  MedicationOrderPanel (FR): CTA « Demander le prix et la livraison avec
  Medika », quote review, decline/cancel, payment = next-step note (#84).
  Key decisions: quote totals recomputed server-side (client totals
  ignored); quote items 1:1 mapped to prescription item indices, no
  substitution field (prescriber authz out of scope, UI states it);
  notification reuses category 'consultations' (DB CHECK constraint in
  007 — no schema change), event_type 'medication:quoted', French copy;
  no pharmacy credentials/portal (name/contact/location only).
- NEXT: implement migration + repo + routes, then UI, then tests
  (tests/issue-83-medication-orders.test.js + web test), run full suites,
  open PR, mark IN REVIEW. Never merge.

## Queue
- #84 MonCash medication payments — depends on #83 merged.
- #85 delivery ops + staff portal — depends on #83 + #84 merged.
- Priority: all default (unlabeled), oldest first.

## Infra notes (carried forward)
- vercel.json git.deploymentEnabled["agent-state"]=false (safe to push state here).
- Test env: npm ci at root + medika-web; embedded PostgreSQL auto-managed by
  vitest global-setup (migrations auto-applied — new 010 picked up free).
- resetDb TRUNCATE list in tests/helpers.js must gain the new tables.
- Patching src modules in tests: createRequire anchored at the src file.
- Issue #60 invariants: ONE active consultation per patient AND per doctor;
  freshPatient() fixture mints JWT directly (login endpoint throttles).
- Temp PAT lives ONLY in agent-state/.gh_token (chmod 600, gitignored).

## Next action (next run)
1. If STATE says IN PROGRESS for #83: continue implementation on branch
   feat/issue-83-medication-orders (check `git log` for progress).
2. If PR open for #83: address review feedback on same branch.
3. If #83 merged: #84 becomes eligible (rebase from latest main).
4. One issue at a time. Never merge. Never duplicate branches/PRs.
