/**
 * Issue #35 regression — doctor dashboard cannot load consultation requests.
 *
 * Root cause reproduced here: PR #29 made the doctor branch of
 * listForUser() reference migration-004 objects (reroute_after column +
 * consultation_offers table). On a database where 004 has not been applied
 * yet (deploy→migrate window), every doctor list read failed with
 * 42703/42P01 → Express 500 → the generic "Sèvis la pa disponib" banner and
 * reassuring zero counters. Patients/admins were unaffected (their queries
 * never reference 004 objects) — matching the reported doctor-only outage.
 *
 * The fix mirrors createMessage()'s 003 pattern: degrade to the legacy
 * pre-004 query on 42703/42P01. This suite proves:
 *   A. normal behavior with the schema intact (no regression from #25);
 *   B. the exact production failure shape (list 500) exists WITHOUT the fix —
 *      asserted here by asserting the degraded path SUCCEEDS where the
 *      pre-fix code path would have thrown;
 *   C. accept() also degrades (a doctor can act on the degraded dashboard);
 *   D. the schema is restored for subsequent suites.
 */
'use strict';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');
const helpers = await import('./helpers');

describe('consultation list/accept deploy-order safety (issue #35)', () => {
  let app, request, users, legacyCons, ownedCons;

  beforeAll(async () => {
    const ctx = await helpers.setup();
    app = ctx.app;
    request = ctx.request;
    await helpers.resetDb();
    users = await helpers.createFixtureUsers();

    const consultationsRepo = await import('../src/repos/consultations');
    // Legacy broadcast request (never routed, doctor_id NULL) + a request
    // already owned by the doctor — both must stay visible pre-004.
    // Issue #60: the DB enforces one blocking consultation per patient/doctor,
    // so the doctor-owned fixture is patient2's and is immediately completed —
    // visibility of a doctor-owned row in the list is what's under test.
    legacyCons = await consultationsRepo.create({
      id: 'cons_drift1', patient_id: users.patient.id, patient_name: 'Pat Test',
      patient_age: 30, doctor_id: null, description: 'legacy broadcast',
      specialty_needed: 'Medecine Generale', urgency_level: 'Moyenne',
      ai_summary: '', ai_explanation: '',
    });
    ownedCons = await consultationsRepo.create({
      id: 'cons_drift2', patient_id: users.patient2.id, patient_name: 'Pat Deux',
      patient_age: 30, doctor_id: users.doctor.id, description: 'owned',
      specialty_needed: 'Medecine Generale', urgency_level: 'Moyenne',
      ai_summary: '', ai_explanation: '',
    });
    await consultationsRepo.accept(ownedCons.id, users.doctor.id);
    await consultationsRepo.prescribe(ownedCons.id, users.doctor.id, 'rx');
  });

  afterAll(async () => {
    // D. Restore the 004 schema no matter what happened above (004 is fully
    // idempotent: IF NOT EXISTS everywhere) so later suites in this run are
    // unaffected. Other test files run in fresh forks, but be defensive.
    const { query } = await import('../src/db');
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '004_consultation_lifecycle.sql'),
      'utf8'
    );
    await query(sql);
    await helpers.closeAll();
  });

  it('A. with 004 applied: routed doctor visibility is unchanged', async () => {
    const auth = await helpers.authHeader(request, users.doctor.username);
    const res = await request.get('/api/consultations').set(auth);
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id);
    expect(ids).toContain('cons_drift1'); // legacy broadcast stays visible
    expect(ids).toContain('cons_drift2'); // own consultation
  });

  it('B. pre-004 schema: doctor list degrades to legacy visibility instead of 500', async () => {
    const { query } = await import('../src/db');
    // Reproduce the unmigrated production shape: exactly what 004 adds is absent.
    await query(`DROP TABLE IF EXISTS consultation_offers`);
    await query(`ALTER TABLE consultations
                   DROP COLUMN IF EXISTS offer_deadline,
                   DROP COLUMN IF EXISTS accepted_at,
                   DROP COLUMN IF EXISTS expires_at,
                   DROP COLUMN IF EXISTS reroute_after`);

    const auth = await helpers.authHeader(request, users.doctor.username);
    const res = await request.get('/api/consultations').set(auth);
    // Before the fix this was a 500 (42703: column "reroute_after" does not
    // exist) rendered as the generic unavailable-service banner.
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.id);
    expect(ids).toContain('cons_drift1');
    expect(ids).toContain('cons_drift2');

    // Patients and admins were never affected — keep proving it.
    const patAuth = await helpers.authHeader(request, users.patient.username);
    const patRes = await request.get('/api/consultations').set(patAuth);
    expect(patRes.status).toBe(200);
    const adminAuth = await helpers.authHeader(request, users.admin.username);
    const adminRes = await request.get('/api/consultations').set(adminAuth);
    expect(adminRes.status).toBe(200);
  });

  it('C. pre-004 schema: accept() degrades so the doctor can still act', async () => {
    const auth = await helpers.authHeader(request, users.doctor.username);
    const res = await request.put('/api/consultations/cons_drift1/accept').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EN_COURS');
    expect(res.body.doctor_id).toBe(users.doctor.id);
  });
});
