# Vercel preview deployments — "Resource provisioning failed" triage runbook

> Incident date: 2026-10-28 · Trigger issue: #51 (predecessor observation: #40 item 5)
> **No credentials or secret values appear in this document.** It names where things
> live (dashboard tabs, environment variable names) but never their contents.

---

## 1. Symptom

Vercel preview deployments (PR previews and deployments of the `agent-state`
bookkeeping branch) fail with:

```
BUILD_FAILED — Resource provisioning failed
```

The failure happens **before any build event is emitted** (the deployment-event
lookup returns no build logs), so the build itself never starts. Production
deployments from `main` keep reaching `READY` in the same time window.

## 2. Evidence gathered from the repository side (no dashboard access)

Deployment statuses were read from the GitHub commit-status API for every
commit deployed on 2026-10-28 between ~18:30Z and ~20:00Z:

| Commit | Branch / context | Deployed (~UTC) | Result |
|---|---|---|---|
| `991aeee` | main (production) | earlier | READY |
| `01ec3b6` | main (production) | earlier | READY |
| `a801729` | main (production) | earlier | READY |
| `f100028` | PR #49 preview | 19:21 | **FAILED** |
| `6714c7c` … `b030000` … `d5a24e7` | agent-state previews | 18:34 → 19:57 | **21+ consecutive FAILED** |
| `641add2` | PR #52 preview | ~19:25–19:30 | READY |
| `d4757b2` | PR #54 preview | ~19:46 | READY |
| `f7cfda4` | PR #55 preview | ~19:52 | **FAILED** |
| `462cd50` | main (production) | ~20:00 | READY |

Why this exonerates the application code:

1. **Identical code fails as a preview and succeeds in production.** PR #49's
   head `f100028` failed as a preview at 19:21; the very same code, merged to
   `main` as `462cd50`, deployed to production and reached READY at ~20:00.
   A code/build defect cannot behave differently per deployment type.
2. **Docs-only changes fail.** The `agent-state` branch contains only
   `.agent-state/LOCK.json` / `STATE.md` bookkeeping updates — zero
   application code, zero dependency changes — and 21+ of its previews failed
   consecutively. There is no build step involved that could fail.
3. **The failure precedes the build.** No build events exist for failed
   deployments; the failure occurs in the provisioning phase (allocating
   build resources and provisioning linked per-deployment resources), not in
   compiling or configuring the app.
4. **Production is unaffected.** Production deployments reuse the
   already-provisioned linked resources, so they never hit the exhausted
   provisioning step.

## 3. Root cause analysis

The evidence pattern — *previews fail before build with "Resource provisioning
failed", production fine, docs-only previews fail, identical code succeeds in
production* — matches a **Vercel linked-resource/integration provisioning
failure for per-preview resources**, not an application problem.

The documented identical case (Vercel Community: "Neon Postgres integration
provisioning failure blocking Vercel preview deployments") had exactly this
signature:

- Every preview deployment asks the linked database integration (Neon, in
  that project) to provision a fresh database branch for the preview.
- The Neon **free plan caps database branches** (e.g. 10). Preview branches
  accumulate as previews pile up.
- Once the cap is hit, Vercel cannot provision the per-preview resource and
  the deployment dies in the provisioning phase — **before any build log** —
  with "Resource provisioning failed".
- Production keeps working because it reuses the main database branch.

This project's deployment architecture (docs/DEPLOYMENT.md) uses managed
PostgreSQL (`DATABASE_URL`) alongside Vercel Blob (`BLOB_READ_WRITE_TOKEN`)
on a single Vercel Services project — the same class of per-preview
provisioning. Which integration specifically is exhausted must be confirmed
in the dashboard (owner-only, see below); the repository-side evidence cannot
distinguish Neon-branch-exhaustion from another linked-resource quota, but
every observed fact is consistent with that failure class.

Secondary effect (also external): Vercel Hobby-plan concurrency/daily
deployment limits can surface as provisioning failures when many deployments
are requested in bursts. The agent-state branch alone triggered several
deployments per 5-minute agent run. This is now mitigated at the repository
level (§5).

## 4. Exact owner actions (smallest next steps)

1. **Open the Vercel dashboard → project `medika` → Storage / Integrations**
   and check each linked resource's usage/plan panel — specifically the
   database integration's **branch count / quota** (Neon: "Branches x/y").
2. **Free provisioning slots**: delete stale preview database branches (all
   preview branches can go — production uses the main branch). In the
   referenced identical case, deleting old preview branches took usage from
   10/10 to 1/10 and previews immediately deployed again.
   - Alternatively, upgrade the integration's plan (more branches) or detach
     per-preview branching if the integration offers it.
3. **Re-trigger one preview** (e.g. from an open PR, or push a commit to any
   feature branch) and confirm it reaches **READY**.
4. If previews still fail after slots are freed: check the Vercel project's
   **Deployments → failed entry → Settings/Events** for the integration error
   text, and Vercel account **Usage** for concurrency/daily limits; if the
   error text is not self-explanatory, open a Vercel support case with the
   deployment ID (e.g. `dpl_EkdBJCFoLRYoXYwomzUvePe6K5nf`).
5. Do **not** change environment variable values, rotate credentials, or
   touch production data while triaging — nothing in the evidence suggests
   credentials are involved.

## 5. Repository-side mitigation shipped with this runbook

- `vercel.json` now sets `git.deploymentEnabled["agent-state"] = false`.
  The `agent-state` branch only carries agent bookkeeping files
  (LOCK.json/STATE.md); deploying it to Vercel served no review purpose,
  burned per-preview provisioning attempts, and littered commit statuses
  with red X marks unrelated to code. PR previews and `main` deployments
  are untouched. The contract is pinned by `tests/vercel-git-deployments.test.js`.

## 6. Honest limitations of this investigation

- The agent has **no Vercel dashboard/API access**, so the failing
  integration could not be identified by name from here; §3's mechanism is
  evidenced by (a) the repository-side facts in §2 and (b) a documented
  community case with an identical symptom signature — it is not yet
  confirmed inside this project's dashboard.
- The agent cannot trigger or verify a fresh preview deployment on demand;
  verification of "a preview reaches READY" requires the owner's §4 step 3.
- If the PR carrying this runbook itself shows a failed preview check with
  the same error, that is **expected** under this diagnosis (provisioning
  slots are still exhausted) and further corroborates it; it does not
  indicate a regression from this change, which alters no build or runtime
  behavior.
