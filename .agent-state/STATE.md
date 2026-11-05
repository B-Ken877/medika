Last updated: 2026-11-05T05:05:00Z (cron-202611051242)

## Active issue
- NONE. #82 IN REVIEW via PR #86, branch
  feat/issue-82-structured-prescriptions (from main 58f0a17, commit 55fc4c5).
  Structured, immutable prescription documents + French « Ordonnance
  médicale ». Migration 009; repo src/repos/prescriptions.js; PUT extended
  (legacy verbatim + structured allowlist, prices stripped), GET document;
  atomic row-locked issuance, dup → 409 PRESCRIPTION_ALREADY_ISSUED (404
  kept for wrong doctor / non-active per legacy contract). Web composer FR,
  document FR, lazy html2canvas download, A4 print CSS.
  Tests: backend 474/474 (40 files), web 521/521 (41 files), typecheck/lint/
  build clean. Owner next: review + merge PR #86. Do NOT close #82 or mark
  DONE until owner verifies/merges.

## Queue
- #83 medication orders + pharmacy quotes — DEPENDS ON #82 MERGED (rebase
  from latest main; do not assume a fixed SHA).
- #84 MonCash medication payments — depends on #83 merged.
- #85 delivery ops + staff portal — depends on #83 + #84 merged.
- All four (#82-#85) arrived 2026-11-05 unlabeled → treated as same default
  priority, oldest first.

## Infra notes (carried forward)
- vercel.json git.deploymentEnabled["agent-state"]=false (safe to push state here).
- Test env: npm ci at root + medika-web; embedded PostgreSQL auto-managed by
  vitest global-setup.
- Patching src modules in tests: use createRequire anchored at the src file
  (native require cache) — dynamic import() creates a separate SSR instance.
- Issue #60 invariants bite in tests: ONE active consultation per patient
  AND per doctor. Every issuance scenario needs a fresh patient fixture AND
  any consultation left open must be closed (issue or reject) or the next
  create 409s ("Doktè sa a okipe deja"). Pattern used in
  tests/issue-82-prescription-documents.test.js (freshPatient() mints JWT
  directly — the login endpoint throttles at ~5 attempts/min).
- Read tests without routing side effects: h.createConsultationFixture()
  (direct repo insert, no routed offer).
- Temp PAT lives ONLY in the local sandbox at agent-state/.gh_token
  (chmod 600, gitignored). NOT committed anywhere.

## Next action (next run)
1. Check lock. If free: check PR #86 review state and whether #82 was
   merged/closed; if merged: remove stale IN REVIEW label if the issue is
   still open, verify, report; then #83 becomes eligible (rebase from
   latest main).
2. If owner left review feedback on PR #86: address it on the same branch.
3. One issue at a time. Never merge. Never duplicate branches/PRs.
