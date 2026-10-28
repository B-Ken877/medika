/**
 * Doctor credential verification (issue #32) — server-owned status, admin
 * workflow, audit trail, public redaction.
 *
 * Coverage:
 *  - legacy doctors are NOT verified by default (NULL = unknown, never
 *    inferred from a populated license number);
 *  - only admins can transition the status (doctors and patients get 401/403);
 *  - valid transitions update verified_at/verified_by and write the audit
 *    trail with actor/action/from/to/note;
 *  - public doctor responses expose verification_status but no audit notes,
 *    no verified_by, no internal evidence;
 *  - admin credential-field edits are audited;
 *  - GET /api/doctors/:id serves the profile page (issue #30) with the same
 *    redaction as the list;
 *  - invalid statuses/notes are rejected; unknown doctors 404.
 */
'use strict';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

describe('legacy records are not verified (issue #32)', () => {
  it('a doctor with a populated license_number is still unverified/unknown', async () => {
    const res = await r.get('/api/doctors').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    const doc = res.body.find((d) => d.id === users.doctor.id);
    expect(doc).toBeTruthy();
    expect(doc.license_number).toBeTruthy(); // MSPP-1 is populated…
    expect(doc.verification_status).toBe(null); // …but NOT inferred as verified
    expect(doc.verified_at).toBe(null);
  });

  it('the audit trail for a fresh doctor is empty', async () => {
    const res = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe(null);
    expect(res.body.audit).toEqual([]);
  });
});

describe('authorization — only admins can change verification status', () => {
  it('a doctor cannot self-verify (403)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('a patient cannot verify (403)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('an anonymous caller cannot verify (401)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .send({ status: 'verified' });
    expect(res.status).toBe(401);
  });

  it('the ordinary profile endpoint cannot write verification fields', async () => {
    // PUT /api/profile ignores unknown fields — the column is not writable
    // through it, so a doctor cannot self-assign a status.
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ verification_status: 'verified' });
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe(null); // unchanged
  });
});

describe('admin verification workflow', () => {
  it('rejects an invalid status (400)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'sort-of-verified' });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long note (400)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'verified', note: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('404 for an unknown doctor', async () => {
    const res = await r.put('/api/admin/doctors/nope/verification')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'verified' });
    expect(res.status).toBe(404);
  });

  it('admin approves → verified, with verified_at and an audit row', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'verified', note: 'MSPP licence confirmee' });
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('verified');
    expect(res.body.verified_at).toBeGreaterThan(0);

    const trail = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`);
    expect(trail.body.verification_status).toBe('verified');
    expect(trail.body.audit.length).toBe(1);
    const row = trail.body.audit[0];
    expect(row.action).toBe('status_changed');
    expect(row.from_status).toBe(null);
    expect(row.to_status).toBe('verified');
    expect(row.actor_id).toBe(users.admin.id);
    expect(row.actor_name).toBe('Admin Test');
    expect(row.note).toBe('MSPP licence confirmee');
  });

  it('public responses reflect the verified badge', async () => {
    const list = await r.get('/api/doctors').set('Authorization', `Bearer ${token.patient}`);
    const doc = list.body.find((d) => d.id === users.doctor.id);
    expect(doc.verification_status).toBe('verified');
    expect(doc.verified_at).toBeGreaterThan(0);
  });

  it('leaving verified clears verified_at (rejected transition)', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'rejected', note: 'licence expirée' });
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('rejected');
    expect(res.body.verified_at).toBe(null);

    const trail = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`);
    // Two audit rows, newest first: rejected (from verified), verified (from null).
    expect(trail.body.audit.length).toBe(2);
    expect(trail.body.audit[0].from_status).toBe('verified');
    expect(trail.body.audit[0].to_status).toBe('rejected');
  });

  it('pending is a legal re-review transition', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'pending' });
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('pending');
    expect(res.body.verified_at).toBe(null);
  });
});

describe('public redaction (issue #32)', () => {
  beforeAll(async () => {
    await r.put(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ status: 'verified', note: 'note interne — ne pas exposer' });
  });

  it('GET /api/doctors exposes the status but no audit data or internal ids', async () => {
    const res = await r.get('/api/doctors').set('Authorization', `Bearer ${token.patient}`);
    const doc = res.body.find((d) => d.id === users.doctor.id);
    expect(doc.verification_status).toBe('verified');
    expect(doc).not.toHaveProperty('verified_by');
    expect(doc).not.toHaveProperty('audit');
    expect(JSON.stringify(doc)).not.toContain('note interne');
    // PII redaction (email/phone) still holds.
    expect(doc).not.toHaveProperty('email');
    expect(doc).not.toHaveProperty('phone');
  });

  it('GET /api/doctors/:id (profile page) has the same contract', async () => {
    const res = await r.get(`/api/doctors/${users.doctor.id}`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('verified');
    expect(res.body).not.toHaveProperty('verified_by');
    expect(res.body).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('note interne');
  });

  it('GET /api/doctors/:id hides non-doctors and unknown ids (404)', async () => {
    const patient = await r.get(`/api/doctors/${users.patient.id}`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(patient.status).toBe(404);
    const unknown = await r.get('/api/doctors/does-not-exist')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(unknown.status).toBe(404);
  });

  it('the audit trail is admin-only (401/403 for others)', async () => {
    const asDoctor = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(asDoctor.status).toBe(403);
    const anon = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`);
    expect(anon.status).toBe(401);
  });
});

describe('credential-field edits are audited', () => {
  it('an admin license/hospital edit lands in the trail without a status change', async () => {
    const res = await r.put(`/api/admin/doctors/${users.doctor.id}`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ licenseNumber: 'MSPP-2', hospital: 'Hopital Nouveau' });
    expect(res.status).toBe(200);

    const trail = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`);
    const edit = trail.body.audit.find((a) => a.action === 'credential_fields_edited');
    expect(edit).toBeTruthy();
    expect(edit.note).toContain('licenseNumber');
    expect(edit.note).toContain('hospital');
    expect(edit.actor_id).toBe(users.admin.id);
    // Status untouched by the edit (explicit admin control only).
    expect(trail.body.verification_status).toBe('verified');
  });

  it('non-credential edits (availability) are not audited as credential changes', async () => {
    await r.put(`/api/admin/doctors/${users.doctor.id}`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ isAvailable: true });
    const trail = await r.get(`/api/admin/doctors/${users.doctor.id}/verification`)
      .set('Authorization', `Bearer ${token.admin}`);
    const edits = trail.body.audit.filter((a) => a.action === 'credential_fields_edited');
    expect(edits.length).toBe(1); // only the previous test's edit
  });
});
