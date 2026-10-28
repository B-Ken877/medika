Last updated: 2026-10-28T20:25:00Z (run cron-20261029-0358)
Last updated: 2026-10-28T20:04Z (run cron-20261029-0347)

## Active issue
- NONE IN PROGRESS.
- #51: IN REVIEW via PR #57 (run cron-20261029-0358). Root cause evidenced as
  EXTERNAL: per-preview resource provisioning fails pre-build (identical code
  READY in production; 21+ docs-only agent-state previews failed; matches the
  documented Neon per-preview branch-limit case). Repo-side mitigation shipped:
  vercel.json git.deploymentEnabled["agent-state"]=false + contract tests +
  docs/VERCEL_PREVIEW_PROVISIONING.md owner runbook. Owner-only next steps:
  dashboard -> Storage/Integrations -> check DB branch quota -> delete stale
  preview branches -> re-trigger a preview -> verify READY (doc section 4).
- #50: owner merged PR #55; issue stays open pending OWNER-ONLY Vercel VAPID
  env config + real-device verification (do NOT attempt).
- #53 (black suggestions bar) is the ONLY remaining unclaimed issue (NEW).

## Completed / history
- #36 CLOSED (PR #41), #43 CLOSED (PR #44), #40 CLOSED (PR #46).
- #45 CLOSED: owner merged PR #49 (squash-landed as main 5904fbc ~20:00Z).
- #47 CLOSED: owner merged PR #52 (main 641add2).
- #48 CLOSED: owner merged PR #54 (main d4757b2).
- #50: PR #55 MERGED by owner; issue open pending owner env config.

## Open PRs awaiting OWNER review: #57 (issue #51) only. All other agent PRs
## (#41/#44/#46/#49/#52/#54/#55) merged; mergeable=True vs main 5904fbc.

## Next action (next run)
1. Check lock -> state -> owner feedback on PR #57 (or issue #51).
2. If #57 unchanged and queue unchanged: claim #53 (black keyboard
   suggestions bar; per issue body, first determine app-rendered vs
   Gboard/IME-owned; audit composer attributes from PR #52; do not regress
   the merged viewport fix; likely mostly documentation unless evidence
   shows an app-rendered bar).
3. Keep git.deploymentEnabled[agent-state]=false in mind: agent-state pushes
   no longer create Vercel deployments (fewer status X marks on agent-state
   commits is EXPECTED, not a regression).


## Next action (next run)
1. Check lock -> inspect state -> no owner change requests on #49/#54/#55 ->
   consider #51 (Vercel preview provisioning; root cause likely owner-side
   Vercel dashboard/account — audit repo-side only) then #53 (black
   suggestions bar; likely OS/keyboard-owned — audit + document, do not
   regress PR #52).
2. If owner reviews any open PR with change requests, resume that issue FIRST.
3. If owner merges any open PR, merge-tree the others vs main; rebranch if
   needed (last check: 0 conflicts among #49/#54/#55).


## Active issue (updated run cron-20261029-0414 at 20:18Z)
- #53 IN PROGRESS: NEW [HIGH PRIORITY] Remove unwanted black keyboard suggestions bar from mobile chat input.
  - Branch: fix/issue-53-keyboard-suggestions-bar (to be created from latest main).
  - Plan: (1) audit composer DOM in consultations+tickets pages to rule out app-rendered bar; (2) smallest evidence-based app change (form-level autocomplete=off if form wrapper exists; no removal of PR #52 attrs); (3) docs/MOBILE_KEYBOARD_SUGGESTION_BAR.md identification runbook (Gboard dark-theme strip vs Chrome autofill strip vs app-rendered); (4) contract tests; (5) vitest/tsc/lint/build.
  - Constraint: do not regress PR #52 viewport fix or its contract tests. Device verification likely unavailable - must state honestly.
- #51: PR #57 MERGED by owner (20:12Z). Remaining #51 steps are OWNER-ONLY (Vercel dashboard quota + re-trigger preview). Issue label still IN REVIEW - leave for owner.
- Queue after #53: #56 (LiveKit video consultations, created 20:11Z, oldest-first next). #50 remains owner-only env config.


## Run cron-20261029-0414 summary (closed loop)
- #53: IN REVIEW via PR #58 (branch fix/issue-53-keyboard-suggestions-bar, 5 files +159/-3).
  Audit: NO app-rendered bar in any of 3 composer surfaces (incl. new InCallChat from PR #49);
  bar is Gboard dark-theme suggestion strip (IME-owned) OR Chrome autofill accessory strip
  (suppressible). Shipped form-level autocomplete=off on all 3 composer forms + in-call input
  parity + docs runbook + 4 contract tests. Tests: vitest 35 files/451 passed, tsc 0, lint
  clean, build ok (viewport directive intact in built HTML). NO device verification available -
  owner checklist in docs §4.
- #51: PR #57 MERGED by owner. Remaining steps owner-only (Vercel dashboard). Label still
  IN REVIEW - left for owner.
- Open PRs awaiting owner: #58 only.

## Next action (next run)
1. Check lock -> state -> owner feedback on PR #58 (or issue #53).
2. If no feedback: claim #56 (LiveKit video consultations - start in video, wait for doctor,
   preserve call across chat/video). NOTE: large feature - read issue body fully, check
   existing call/consult code from PRs #49/#55 first (lib/call/phases.ts, InCallChat.tsx,
   consultations/[id]/call/page.tsx); likely needs server+frontend coordination.
3. #50 remains owner-only (VAPID env config on Vercel). Do not attempt.


## Active issue (updated run cron-20261029-0430)
- #56 IN PROGRESS: Start consultations in LiveKit video; wait for doctor; preserve call across chat/video.
  - Branch (to create): feat/issue-56-direct-video-call from latest main.
  - Plan per issue checklist: (1) trace entry points routing to room placeholder/chat on acceptance -> direct to /call?mode=video when eligible; (2) room/page.tsx -> compatibility redirect; (3) reuse call/page.tsx + InCallChat.tsx; (4) neutral wait-and-retry bootstrap (bounded backoff, cancellable, no token bypass); (5) single room creation; (6) chat open/close = view state only; (7) End call separate; (8) auth intact; (9) tests; (10) vitest/tsc/lint/build.
  - PR #58 (#53) IN REVIEW - do not touch its files (consultations/page.tsx composer form area conflict risk - check merge-tree at PR time).
- Run cron-20261029-0414 closed: #53 via PR #58 (unchanged this run, no owner feedback yet).

#56 PLAN (audited, run cron-20261029-0430, branch feat/issue-56-direct-video-call from main a71cbdd):
- Server: token route 403 covers both not-yet-EN_COURS AND terminal states -> client must poll
  getConsultation (server stays authoritative for tokens; no bypass).
- A. lib/call/phases.ts: add phase 'waiting', failureKind 'ineligible', events
  waiting-for-eligibility + terminal-status{status}; pure eligibilityBackoffMs(attempt) (3s*1.5 cap 15s)
  + MAX_ELIGIBILITY_ATTEMPTS=40 (~bounded); chatControlVisible unchanged (waiting excluded).
- B. call/page.tsx bootstrap: eligibility poll loop FIRST (no Room before token!), neutral
  'N ap tann doktè a konekte…' during RECHERCHE_MEDECIN; terminal REFUSE/TERMINE/EXPIRE -> clear
  screen no auto-retry; MAX attempts -> neutral manual state (real retry via attempt++); network
  errors quiet-retry same loop; room wiring/connect only after eligibility+token; keep
  startCallSentRef once; keep real retry for genuine connect failures.
- C. consultations/[id]/page.tsx: roomHref->callHref(/call?mode=video); acceptance edge
  (RECHERCHE_MEDECIN->EN_COURS in applyConsultation) router.replace(callHref) both roles;
  banners relink to call (labels 'Antre nan apèl videyo a'/'Ouvri apèl videyo a'); header
  voice/video links KEEP (explicit voice action).
- D. PatientDashboard.tsx 159+206: EN_COURS links -> /call?mode=video (label 'Antre nan apèl la').
- E. DoctorDashboard.tsx:141 post-accept push -> /call?mode=video.
- F. room/page.tsx -> compact compatibility redirect to /call?mode=video (placeholder retired;
  real call flow handles waiting/eligibility/terminal safely).
- G. tests: update call-phases (new events/backoff caps), rewrite consultation-room.test.ts
  (redirect contracts), new direct-video-entry source contracts (banner/links/auto-nav/
  no-Room-before-eligibility/waiting copy); server authz tests untouched.
- PR #58 merged by owner (a71cbdd) -> no conflict risk; #53 left IN REVIEW (owner device check).


## Run cron-20261029-0430 summary (closed loop)
- #56: IN REVIEW via PR #59 (branch feat/issue-56-direct-video-call, commit 3c83656, 9 files
  +549/-444). Direct-to-video entry (auto-nav on acceptance, dashboard links, doctor post-accept,
  room placeholder -> compat redirect), two-phase call bootstrap (eligibility poll w/ bounded
  backoff BEFORE any Room; calm waiting; terminal honest states), phases machine extended
  (waiting/ineligible/backoff budget). Server token gate untouched+guarded.
  Tests: vitest 36f/468 passed, tsc 0, lint clean, build ok.
- LESSON (fixed in scripts/agent_state_update.py): the script used to leave the repo on the
  agent-state branch (which carries a FULL OLD tree) — a later tsc/build/diff then ran against
  the wrong tree; one intermediate verification pass was discarded and re-run on the branch.
  Script now restores the previous branch after every push.
- #53: PR #58 MERGED by owner (a71cbdd). Remaining #53 work is owner-side (device checklist in
  docs/MOBILE_KEYBOARD_SUGGESTION_BAR.md §4). Label left IN REVIEW for owner.
- #51: PR #57 merged earlier; remaining steps owner-only (Vercel dashboard).

## Next action (next run)
1. Check lock -> state -> owner feedback on PR #59 (or issue #56).
2. QUEUE EMPTY otherwise: no new agent-eligible issues exist. #50 stays owner-only (Vercel
   VAPID env/secrets config + real-device push verification - do NOT attempt).
3. If owner merges PR #59: verify deployment/preview, report; do not mark #56 DONE until owner
   verifies on a real device (per issue acceptance criteria).
Check-only run cron-202610290450 (no lock acquired): PR #59 open/unmerged, mergeable=True, 0 reviews, no owner feedback on #56/#59 yet. #50 owner-only. No eligible issue -> QUEUE EMPTY. Next run: same checks; on merge of #59 verify Vercel preview/deployment and report (do NOT mark #56 DONE - owner real-device verification still required).## Run cron-20261029-0455 (2026-10-29 04:55 +08 / ~20:55Z) — post-merge verification + housekeeping; QUEUE EMPTY

- PR #59 (issue #56) MERGED by owner; merge commit e66a4200 is HEAD of main ("feat(call): start consultations directly in LiveKit video; wait calmly for the doctor (issue #56) (#59)"). Vercel bot posted deployment for the PR; no GitHub deployment objects exist (Vercel app does not create them) — production deploy rides on main push per owner setup.
- Issue #56 closed by owner via merge; no owner feedback/comments requiring response. Remaining verification is OWNER-ONLY: real-device check of direct-to-video entry + calm wait (do not mark DONE from agent side).
- Housekeeping: removed stale IN REVIEW label from closed issues #51 (PR #57 merged) and #56 (PR #59 merged). Priority labels (bug / high priority / NEW) preserved on all issues.
- Verified: lock active=false (free, run_id cron-20261029-0430); branches intact incl. agent-state @ ba680a5; PAT authenticates as B-Ken877; no open PRs; only open issue is #50 (owner-only Vercel VAPID env + real-device push verification — do not attempt).
- Tooling note (fixed this run): verify_merge_56.py had a missing leading "/" in GitHub API paths causing spurious 404s (URL /medikacommits); corrected and re-run successfully. gh_state_check.py (overview/pr/issue modes) unaffected.
- No code changes this run (read-only + label housekeeping + this state append). No tests run because no code was modified.

Next action (next run):
1. Check lock -> state -> owner feedback on #56 / #53 real-device verification results.
2. Check for NEW issues from owner (titles start with NEW) — none exist as of this run.
3. QUEUE EMPTY otherwise: do not start new work; #50 remains owner-only (Vercel VAPID env/secrets + real-device push verification).## Run cron-20261029-0505 — STARTED issue #60 (NEW [HIGH PRIORITY]) — IN PROGRESS

- Owner closed #50 (21:02Z) and opened #60: Prevent overlapping consultations + reconcile legacy duplicate open bookings. Agent-eligible: NEW-titled, high priority, 0 comments, no duplicate branch/PR. Claimed with IN PROGRESS (priority labels preserved).
- Lock: cron-20261029-0505 / issue 60 / active.
- Branch (planned): feat/issue-60-one-active-consultation (from origin/main @ e66a420).
- Scope: server-side + DB-enforced one-active-per-patient AND one-active-per-doctor; atomic reservation (partial unique index + transaction, no check-then-insert race); bounded pending timeout that never expires in-progress; deterministic rerunnable reconciliation keeping newest eligible record per patient/doctor conflict set (no hard-delete); UI guards + conflict responses; tests for transitions/cleanup/concurrency; vitest/tsc/lint/build.
- Next action: audit consultation model/status enum/creation routes/migrations in repo; write blocking-state set + timeout policy; implement reconciliation BEFORE invariant enforcement.## Run cron-20261029-0505 — issue #60 DESIGN COMPLETE (checkpoint 1)

Root-cause audit done. Facts: single creation path POST /api/consultations (patient-only, payment-gated); blocking states = RECHERCHE_MEDECIN + EN_COURS; terminal = TERMINE/REFUSE/EXPIRE; migration 004 already gives 1h offer windows + reroute/waiting + 5h EN_COURS expiry; NO per-patient/doctor uniqueness anywhere; waiting-state RECHERCHE_MEDECIN rows can wait forever (no bounded pending timeout); test harness = embedded real Postgres + supertest (migrations auto-applied in global-setup).

Design (blocked on nothing):
1. Migration 008_one_active_consultation.sql: close_reason TEXT column; plpgsql fn reconcile_duplicate_active_consultations() (greedy newest-first: a blocking row is KEPT iff no still-blocking row with (created_at,id) > (r.created_at,r.id) shares patient_id or doctor_id; losers → EXPIRE + close_reason='duplicate_open_consultation' + system message; RAISE NOTICE aggregate counts only); run it; THEN 2 partial unique indexes uq_consultations_patient_active / uq_consultations_doctor_active ON (patient_id)/(doctor_id) WHERE IS NOT NULL AND status IN ('RECHERCHE_MEDECIN','EN_COURS'); pending-age partial index. Reconciliation BEFORE indexes so legacy duplicates cannot fail the migration; function kept for rerun/tests.
2. config.pendingExpiryHours (PENDING_EXPIRY_HOURS, default 4): bounded pending timeout — RECHERCHE_MEDECIN rows older than 4h → EXPIRE + close_reason='pending_timeout' + system message + consultation:expired push (reuses existing EXPIRE notify branch). Never touches EN_COURS (its 5h expiry is issue #25 product behavior, untouched).
3. Routing: NEXT_ELIGIBLE_DOCTOR_SQL excludes doctors holding an active consultation; routeNewConsultation catches 23505 → 1 retry with pure pool → still busy → park in waiting state (bounded, no 500, no hot loop). Sequential patient-choice of a busy doctor → 409 pre-check.
4. POST /api/consultations: pre-check patient active → 409 {error, existing_id}; pre-check patient-choice doctor busy → 409; INSERT catches 23505 → 409 + existing_id (index is the authority; pre-checks are fast-fail UX).
5. accept(): 23505 → 'DOCTOR_BUSY' sentinel → route 409 with clear message (no 500).
6. consToApi: close_reason additive. Web: ApiError.existingId from body, Consultation.close_reason type, consult page guard panel (active consultation exists → panel with link replaces booking CTAs; 409 during submit shows link too). DoctorDashboard already surfaces 409 messages.
7. tests/consultation-uniqueness.test.js (embedded PG): sequential 409, concurrent same-patient Promise.all, concurrent same-doctor, routing skips busy, patient-choice busy 409, accept-busy 409, pending expiry (RECHERCHE_MEDECIN yes / EN_COURS no), reconciliation greedy incl. cross-participant edge (P: A(D1) older, B(D2) newer; Q: C(D2) newest → keep C+A, cancel B), rerun no-op, migration source contract.
8. docs/CONSULTATION_UNIQUENESS.md: state sets, rule, migration safety, deploy order.

Next action: write migration 008 → config → repo → lifecycle → routes → web → tests → run vitest/tsc/lint/build → PR.## Run cron-20261029-0505 — issue #60 COMPLETE → IN REVIEW via PR #61

- Branch feat/issue-60-one-active-consultation, commit 7666b34 (19 files, +1193/−63). PR #61 open, mergeable=true, IN REVIEW label on the PR, status comment posted on #60.
- Shipped: migration 008 (close_reason + deterministic rerunnable reconcile fn + 2 partial unique indexes + pending-age index, reconcile BEFORE indexes); config.pendingExpiryHours=4 + expireStalePending in the deadline processor; routing pool skips busy doctors + 23505 fallbacks (pool retry → waiting); POST /consultations pre-checks + typed 409s (existing_id / doctor-busy) + issue-#40 same-payment replay preserved (sequential + raced via bounded local poll); accept() DOCTOR_BUSY → 409; consToApi close_reason; web booking guard panel + ApiError.existingId + Consultation.close_reason.
- Tests: NEW tests/consultation-uniqueness.test.js (11 tests, embedded PG). Full root suite: 33 files / 403 tests passed. tsc 0 errors, next lint clean, next build success.
- Test-suite migrations for the new invariant (fixtures released slots): helpers.createConsultationFixture releases participant slots; beforeEach releases in lifecycle/payments/idempotent files; two legacy-shape fixtures split across two patients (attachments, ws, schema-drift, wallet-payouts, lifecycle adoption test). No production behavior weakened.
- Disclosed: no real-device verification (owner-only). Deploy note: npm run migrate reconciles legacy duplicates then creates indexes in one migration.

Next action (next run):
1. Check lock -> state -> PR #61 feedback/merge (owner).
2. If merged: do NOT mark #60 DONE until owner verifies in production; verify migration applied cleanly if owner reports.
3. QUEUE EMPTY otherwise. #50 closed by owner on their side (21:02Z).## Run cron-20261029-0550 — STARTED issue #62 (LiveKit -> ZEGOCLOUD web migration)

- Owner-created high-priority issue (21:51Z). IN PROGRESS label added; NEW + high priority preserved.
- Also this run: PR #61 (issue #60) MERGED by owner as e1fb9cc (now main HEAD). #60 stays open+IN REVIEW per plan: no DONE until owner production verification. #50 closed by owner themselves. #53/#51/#56 remain closed+merged.
- Branch: feat/issue-62-zegocloud-migration (from main @ e1fb9cc).
- Scope per issue: audit LiveKit paths first; ZEGO Web SDK low-level (custom UI); server-side short-lived tokens after auth+consultation checks; feature switch (Preview/Dev only) keeping LiveKit fallback; env names ZEGOCLOUD_APP_ID / ZEGOCLOUD_SERVER_SECRET / ZEGOCLOUD_APP_SIGN / ZEGOCLOUD_SERVER_URL (Preview/Dev only, never client bundles/logs/repo); .env.example placeholders; keep branded UI + call/chat switching without disconnect; tests; no production changes; no LiveKit removal.
- Progress: audit starting (LiveKit token endpoint, call component, chat mount behavior).
- Next action: complete audit -> ZEGO SDK research -> config + provider switch -> token endpoint -> web provider implementation -> tests.