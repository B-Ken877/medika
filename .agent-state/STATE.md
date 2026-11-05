Last updated: 2026-11-06T02:50:00Z (cron run, sandbox-recycle recovery + issue #109)

## THIS RUN (visual fix requested by owner in chat + recycle recovery)
- Sandbox was recycled: /home/z/my-project/.agent (instructions, gh_token,
  state.json, lock) is GONE. No GitHub token available this run -> NO push,
  NO issue/PR comments possible. API rate-limited (anon). HTML scrape worked.
- Recreated repo clone from origin; restored state from agent-state branch.
- Verified: #97 CLOSED (owner completed Vercel preset/build-command fixes).
  PR #96/#82 already merged earlier? (main has 6b80b1c/#103 work) — #82/PR #96
  status unchanged from last run's records. Open issues: #106 (IN PROGRESS,
  owner), #109 (IN PROGRESS, agent). No open PRs seen via HTML.
- OWNER MESSAGE (chat): my #103 dashboard implementation deviates from the
  approved concept — proportions too big + missing the polymorphism green
  background. Owner: "Make sure they match. Continue."

## Issue #109 WORK DONE THIS RUN (branch feat/issue-109-doctor-hero-artwork,
   commit 17dd22d, LOCAL ONLY — push blocked, no token)
- Asset medika-web/public/img/dashboard-doctor-hero.png: cut from the approved
  reference; bell/avatar/chevron + subtitle fragment removed via bilinear
  fills; alpha edge-fades baked. Same person (exact crop) — issue #109 AC.
- patient-theme.css: hero compacted to reference rhythm (band clamp(176px,
  22vh, 236px), greeting clamp(30px,8.8vw,40px) 9ch wrap on mobile, cards
  15px/26px values), rich green field: .app-shell.patient-shell top-right
  emerald radial + stronger ambient waves; patient header glass 0.55.
- PatientDashboard.tsx: real <img> artwork replaces .hero-art-shape (aria-
  hidden, eager, high priority, intrinsic size = no layout shift).
- Verified: web 563/563, tsc clean, lint clean, production build OK.
- Evidence: docs/screenshots/issue-109-doctor-hero/ (README method+differences,
  8 real-app screenshots 360/390/720/820/1440, seeded data mirroring concept).
- Screenshots via single-command pipeline (scripts/visual_pipeline.sh outside
  repo): boot embedded pg :5433 + server.js :3000 + web dev :4100 +
  agent-browser login (kenley/Passw0rd!) + captures. NOTES: processes may
  survive tool-call boundaries -> pkill -f medika-pg-data before rerun;
  snapshot refs parse as 'ref=eN' (use @eN for click/fill).

## Next action (next run)
1. If token available: push feat/issue-109-doctor-hero-artwork (17dd22d) to
   origin, open PR -> main linking #109, do NOT merge; verify Vercel preview.
2. Check #109 + #106 for owner feedback; address on SAME branch.
3. Restore /home/z/my-project/.agent/gh_token setup before any push.

One issue at a time. Never merge. Never push main.


## MAJOR CONTEXT RESET (this run)
Issue #82 was REPURPOSED by the owner (issue body rewritten ~17:31Z, directive
comment 17:29:24Z: «GLM — START THIS TASK»): it is now the SINGLE consolidated
end-to-end medication journey task, replacing the split approach of #82/83/84/85
and closed PR #95. One issue, one branch, one PR, full Definition of Done in the
issue body (18 acceptance criteria + 12 sections of spec).

## Repo reality (verified this run via API + git)
- PR #86 (prescriptions, ed02c26) MERGED 05:15:43Z. Issue #82 old scope done.
- PR #87 (#83 orders+quotes, 066405e) MERGED 06:15:53Z by owner. #83 closed
  (stale label IN PROGRESS still on it — cleanup optional, owner closed it).
- 7ac67aa "fix(api): require medication order delivery details" — DIRECT change
  by coordinator (not via PR), REVERTED on main in 85fb332 (only
  medika-web/lib/api/endpoints.ts, 1 line). Must NOT be reapplied; design
  correct API contract instead, explain replacement in PR.
- PR #87-squash→#84 MonCash (57d2073) MERGED 06:26:12Z; hardened f979f83 06:39Z.
  #84 closed.
- #85 closed; PRs #93/#94/#95 (delivery) all closed UNMERGED. PR #95
  (feat/issue-85-delivery-operations-clean) = REFERENCE ONLY (its own
  description admitted tests were not executed; owner closed it 17:29:13Z).
- main tip = 85fb332. NO open PRs. NO open issues except #82.
- #82 labels: enhancement (need to add IN PROGRESS + claim comment).

## Active issue
- #82 CONSOLIDATED MEDICATION JOURNEY — IN PROGRESS (claimed this run).
- Branch: feat/issue-82-complete-medication-journey (from main 85fb332).
  Must include revert of coordinator change 7ac67aa is ALREADY on main via
  85fb332 (branch starts from it; nothing to revert again — audit call sites).
- Scope (issue body): doctor composer (multi-med rows, atomic+immutable,
  server-side authz) → beautiful patient HTML «Ordonnance médicale» (on-screen
  doc as visual focus, PNG download via html2canvas-type lib, A4 print, NO
  prices) → independent purchase path always available → medication sourcing
  request (address+Haitian phone+city+explicit zone record, dedupe active
  orders) → admin WhatsApp sourcing queue (30-min SLA from server timestamp,
  append-only quotes, no substitution without doctor authorization) → patient
  quote view → verified MonCash on accepted unexpired quote (server-derived
  amount, quote-version binding, no production simulation bypass) → Medika-
  owned delivery (explicit zone records fail-closed, employee role+portal,
  Friday schedule + reasoned urgent exceptions, 9-stage custody chain row-
  locked idempotent, patient confirmation, French notifications, internal
  expense ledger + weekly/monthly reports + budget alerts) → migrations
  reconciliation (one unambiguous sequential chain from latest main; PR #95
  had introduced 012/013 — resolve numbering/drift; test from clean DB) →
  full French UX bar → tests for EVERYTHING (issue §11) → PR with exact
  commands/counts/screenshots/migration order/walkthrough.

## Phase plan (persist progress per phase)
- P0 (this run): claim, lock, branch, deep audit of existing
  prescriptions/orders/payments code + PR #95 reference + coordinator-change
  call sites; write DESIGN.md on feature branch (migration chain plan + API
  contract replacement for 7ac67aa).
- P1: DB layer — reconcile migrations (009/010/011 audited; 012/013 from #95
  cherry-pick+fix), zones/employees/custody/expense tables.
- P2: prescriptions hardening + composer + contract fix.
- P3: patient ordonnance HTML screen + PNG/print (visual top priority).
- P4: sourcing request + admin WhatsApp queue + quote flow (+ free delivery).
- P5: MonCash medication payments (quote-bound).
- P6: delivery ops (zones, employees, assignment, custody, tracking,
  expenses, reports).
- P7: full test pass (backend/web/admin/typecheck/lint/builds), PR #, IN REVIEW.

## Queue
- Only #82 (consolidated). Nothing else eligible.

## Infra notes (carried forward)
- vercel.json git.deploymentEnabled["agent-state"]=false (safe to push state).
- agent-state worktree at /home/z/my-project/agent-state-worktree (re-created
  this run after sandbox recycle). Push state via that worktree.
- Test env: npm ci at root + medika-web (+ medika-admin for builds); embedded
  PostgreSQL auto-managed by vitest global-setup; migrations auto-applied.
- Issue #60 invariant: ONE active consultation per patient AND per doctor;
  helpers must issue AND accept/reject (releaseConsultation() pattern).
- ApiError on web: server French error in err.detail; err.message generic
  Creole fallback.
- notifications CATEGORY_FOR_EVENT DB-CHECK-constrained (consultations/
  messages/calls/wallet) — new event types must map to existing category.
- pg QueryResult: use .rows (destructure { rows }).
- Temp PAT in /home/z/my-project/agent-state/.gh_token (chmod 600, sandbox-
  local; re-created after recycle from task message).
- KNOWN: Vercel PREVIEW deploys fail (rate limit) — environmental, not code;
  verify locally, do not re-investigate.

## Progress this run (cron-202611060132)
- P0 DONE: claim (label+comment 6664899528), lock, branch
  feat/issue-82-complete-medication-journey @ 446d322 (pushed), design note
  docs/ISSUE_82_MEDICATION_JOURNEY.md (audit + migration reconciliation +
  7ac67aa replacement contract).
- P1 DONE (commit 446d322, PUSHED): migration 013 (zones/employees/custody/
  expenses/budget; seed INACTIVE fail-closed), medication_orders.delivery_city
  + delivery_zone_id FK, repo zone-record validation (503/422/400 semantics),
  GET /api/delivery-zones, web zone SELECT + fully-required typed payload
  (real 7ac67aa replacement), FR coverage-closed state. ALSO FIXED the
  merged-but-never-run issue-84 MonCash tests (spies on wrong module
  instance -> createRequire anchored at src/routes/medication-payments.js).
- Verified real: backend 506/506 (41 files), web 540/540 (42 files),
  tsc --noEmit clean.

- P2 DONE (commit f861559, PUSHED): ordonnance document rebuilt (header/
  identity sections/numbered wrap-safe rows/footer, no prices), 404-only
  legacy fallback + retryable French error state, fonts.ready + 2x DPR PNG
  capture, independence phrase. Web 543/543, tsc clean.

- P3-backend DONE (commit 358ec13, PUSHED): deliveries repo+routes (custody
  chain, PAID-only Friday/urgent assignment, employee isolation, patient
  confirm, expenses/budget/reports, admin employee+zone provisioning),
  notifications categories, wiring. tests/issue-82-delivery-operations
  9/9; backend total 515/515 (42 files).

- P3-UI DONE (commit b864aaa, PUSHED): livreur portal, admin livraisons
  (list/detail/assign/zones/employees/reports+budget), patient delivery
  tracking + confirm, login redirect, admin nav, Role type.

- P5 DONE: full verification sweep all green (backend 515/515 / 42 files,
  web 543/543 + tsc + lint + build incl /livreur, admin build incl
  /livraisons, clean-DB migration chain 001-013 proven each run).
- **PR #96 OPEN** (feat/issue-82-complete-medication-journey -> main,
  head b864aaa): full description with DoD mapping, migration order +
  rollout, 7ac67aa replacement explanation, exact commands/counts,
  walkthrough, security highlights, risks. #82 labels: enhancement +
  IN REVIEW (evidence comment 6666024974). LOCK RELEASED.

## Next action (next run)
1. No active issue: #82 is IN REVIEW on PR #96 (owner + ChatGPT review).
2. Check PR #96 reviews/comments and #82 comments each run. If the owner
   posts changes: address on the SAME branch, re-verify, re-label IN
   REVIEW. Never merge.
3. If owner asks for screenshots: boot embedded postgres (persistent) +
   server.js + medika-web dev, agent-browser screenshot of the ordonnance
   (desktop + mobile), attach to #82/PR #96.
4. No other open issues exist. If #82 is closed/merged by the owner:
   verify labels (remove IN REVIEW), report DONE. Otherwise QUEUE EMPTY
   for new work while IN REVIEW stands.
One issue at a time. Never merge. Never push main.
