Last updated: 2026-11-05T06:06:00Z (cron-202611051403)

## Active issue
- #83 IN PROGRESS (review-feedback round, run cron-202611051403). Owner
  posted «ChatGPT review — changes required before merge» on PR #87 at
  06:04:19Z (comment 6651030852). Branch feat/issue-83-medication-orders
  (from main ed02c26, head b4776ec). Medication orders + manual pharmacy
  quote operations: migration 010 (partner_pharmacies / medication_orders /
  pharmacy_quotes / medication_order_events — no pharmacy credentials or
  portal), repo src/repos/medication-orders.js (row-locked transitions,
  1:1 quote lines → prescription indices, server-recomputed HTG totals,
  30-min SLA from requested_at, lazy+cron ESCALATED/EXPIRED sweeps),
  patient routes + admin ops routes (router-level admin guard) +
  /api/crons/medication-deadlines; admin « Médicaments et pharmacies »
  (queue buckets, read-only Rx snapshot, WhatsApp handoff w/o patient data,
  quote form, unreachable, history, directory CRUD); patient web
  MedicationOrderPanel (FR CTA, quote review, accept/decline/cancel,
  payment = honest next-step note for #84).
  Tests (real, pre-review): backend 497/497 (41 files, 23 new), web 538/538
  (42 files, 17 new), typecheck/lint/build + admin build clean.
- REVIEW ITEMS to address (then push new commit to PR #87, re-label
  IN REVIEW, comment with changes + real test results; owner re-reviews):
  1. Delivery FREE to patient: src/repos/medication-orders.js accepts and
     persists arbitrary delivery_fee_htg; remove patient-billable delivery
     fees from quote model/API (edit unmerged migration 010 directly —
     branch not merged yet) and keep internal delivery expenses OUT of the
     quote; regression test: non-zero delivery charge cannot reach a
     patient quote.
  2. Patient UI (medika-web MedicationOrderPanel.tsx): remove delivery-fee
     line item; FR copy that delivery is offered by Medika only where the
     service is available; test: no delivery fee shown/included in total.
  3. Coverage enforcement: require delivery contact name/phone + address;
     interim gate (until #85 zone configuration): explicit supported
     Port-au-Prince zones list, server rejects unsupported/missing zone or
     address with FR fallback telling patient to download/print the
     prescription (#82 document view) and buy independently; tests: missing
     address rejected, unsupported zone rejected.

## Queue
- #84 MonCash medication payments — depends on #83 merged (PR #87).
- #85 delivery ops + staff portal — depends on #83 + #84 merged.
- Priority: all default (unlabeled), oldest first.

## Infra notes (carried forward)
- vercel.json git.deploymentEnabled["agent-state"]=false (safe to push state).
- agent-state branch worktree at /home/z/my-project/agent-state-worktree
  (git worktree add ../agent-state-worktree agent-state from medika clone).
  Push state via that worktree. The stray /home/z/my-project/agent-state
  folder only holds .gh_token (gitignored outer repo, NOT the state repo).
- Test env: npm ci at root + medika-web (+ medika-admin for builds);
  embedded PostgreSQL auto-managed by vitest global-setup; migrations
  auto-applied.
- Issue #60 invariants: ONE active consultation per patient AND per doctor.
  Test helpers must issue AND accept (or reject) — any consultation left
  EN_COURS/RECHERCHE_MEDECIN blocks the next scenario for doctor_t1
  (releaseConsultation() pattern in issue-83 tests).
- ApiError on the web: server French error lands in err.detail (ErrorAlert
  shows it); err.message is the generic Creole fallback.
- notifications CATEGORY_FOR_EVENT is DB-CHECK-constrained to
  consultations/messages/calls/wallet — new event types MUST map to an
  existing category or emit() silently no-ops (bit once this run).
- QueryResult rows: destructure { rows } or use .rows — array-style indexing
  on a pg QueryResult silently yields undefined (bit once this run).
- Temp PAT lives ONLY in agent-state/.gh_token (chmod 600, gitignored).
- KNOWN (run 1339): Vercel PREVIEW deploys of feature branches FAIL
  (dpl_FHwCwzadJBpyiz for PR #87 head b4776ec at 05:37Z; same for #86 head
  55fc4c5 at 05:02Z) while MAIN deploys of the same content SUCCEED
  (ed02c26 at 05:17Z). Environmental (likely preview-scoped env vars in the
  multi-service vercel.json), NOT a code regression — do not re-investigate
  every run; owner has the evidence note on PR #87. Do not touch deploy
  config/secrets.

## Next action (next run)
1. If STATE still says #83 IN PROGRESS (review round): continue on branch
   feat/issue-83-medication-orders per the 3 review items above (check
   `git log` for progress). If PR #87 has a NEW owner comment after our
   fix commit, address it.
2. When fixes pushed + tested: replace IN PROGRESS label with IN REVIEW
   on #83, comment on PR #87 with changes + real test results, release
   lock. Owner re-reviews before merge.
3. If #83 merged: verify labels, report; #84 becomes eligible (rebase
   from latest main; MonCash payments for ACCEPTED medication orders).
4. One issue at a time. Never merge. Never duplicate branches/PRs.
