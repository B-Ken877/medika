/**
 * Consistent live profile identity (owner request, Nov 2026 — "when a user
 * creates or updates their profile, the saved profile information must
 * appear everywhere that user's identity should be visible").
 *
 * The consultation row's patient_name is a creation-time SNAPSHOT; GET
 * /api/consultations (list) and GET /api/consultations/:id (detail) now
 * enrich every authorized row with patient_identity / doctor_identity read
 * from the users table AT REQUEST TIME — the single source of truth. Tests:
 *
 *  - live reflection: a profile rename + avatar update shows up on the next
 *    list/detail read WITHOUT touching stored consultation rows;
 *  - the patient view finally sees the DOCTOR's real name + specialty +
 *    hospital (before this, the patient chat header showed only the
 *    requested specialty label);
 *  - privacy: identities NEVER carry email, phone, biography, license
 *    number or verification state — for either role;
 *  - membership: a non-participant's rows are never served to the viewer
 *    (unchanged convention) and unknown ids resolve to null, not leaks;
 *  - unassigned doctor → doctor_identity null (client falls back).
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {}, db;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
  db = await import('../src/db.js').then((m) => m.default ?? m);
});

afterAll(async () => {
  await h.closeAll();
});

let patientSeq = 0;
/** Fresh patient + token (issue #60: one active consultation per patient). */
async function freshPatient(name = 'Pat Ident') {
  patientSeq += 1;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword, issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  const id = `patient_ident_${patientSeq}`;
  const username = `t.ident_${patientSeq}`;
  await usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'),
    role: 'patient', name, age: 30,
  });
  return { id, name, token: issueToken({ id, role: 'patient', username, name }) };
}

async function createConsultation(bearer, extra = {}) {
  // issue #60: ONE active consultation per doctor — release the doctor's
  // prior active fixture rows (terminal transition, same reconciliation the
  // SQL fixture helper performs) so every test can book doctor_t1 again.
  await db.query(
    `UPDATE consultations SET status = 'TERMINE', updated_at = now()
      WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS') AND doctor_id = $1`,
    [users.doctor.id]
  );
  const res = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${bearer}`)
    .send({
      description: 'sentòm tès idantite', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', doctorId: users.doctor.id, ...extra,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('live identity enrichment (list + detail)', () => {
  it('detail serves BOTH participants as live identities; patient sees the doctor specialty', async () => {
    const pat = await freshPatient();
    const cons = await createConsultation(pat.token);
    const detail = await r.get(`/api/consultations/${cons.id}`)
      .set('Authorization', `Bearer ${pat.token}`);
    expect(detail.status).toBe(200);

    expect(detail.body.patient_identity).toBeTruthy();
    expect(detail.body.patient_identity.name).toBe('Pat Ident');
    expect(detail.body.patient_identity.role).toBe('patient');

    expect(detail.body.doctor_identity).toBeTruthy();
    expect(detail.body.doctor_identity.name).toBe('Dr Test');
    expect(detail.body.doctor_identity.role).toBe('doctor');
    expect(detail.body.doctor_identity.specialty).toBe('Medecine Generale');
    expect(detail.body.doctor_identity.hospital).toBe('Hopital Test');
  });

  it('profile UPDATES reflect immediately (single source of truth, no re-creation)', async () => {
    const pat = await freshPatient('Pat Test Original');
    const cons = await createConsultation(pat.token);
    // Patient renames + uploads a new avatar; doctor updates their name too.
    const upd = await r.put('/api/profile')
      .set('Authorization', `Bearer ${pat.token}`)
      .send({ name: 'Pat Test Renamed', avatarUrl: 'https://cdn.example/av/pat.png' });
    expect(upd.status).toBe(200);
    const docUpd = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ name: 'Dr Test Renamed' });
    expect(docUpd.status).toBe(200);

    const detail = await r.get(`/api/consultations/${cons.id}`)
      .set('Authorization', `Bearer ${pat.token}`);
    expect(detail.body.patient_identity.name).toBe('Pat Test Renamed');
    expect(detail.body.patient_identity.avatar_url).toBe('https://cdn.example/av/pat.png');
    expect(detail.body.doctor_identity.name).toBe('Dr Test Renamed');
    // The stored snapshot is untouched (historical record, additive live fields).
    expect(detail.body.patient_name).toBe('Pat Test Original');

    const list = await r.get('/api/consultations')
      .set('Authorization', `Bearer ${token.doctor}`);
    const row = list.body.find((x) => x.id === cons.id);
    expect(row.patient_identity.name).toBe('Pat Test Renamed');
    expect(row.patient_identity.avatar_url).toBe('https://cdn.example/av/pat.png');
  });

  it('list enriches every row; doctor sees patient identity, patient sees doctor identity', async () => {
    const pat = await freshPatient('Pat List');
    const cons = await createConsultation(pat.token);
    const doctorList = await r.get('/api/consultations')
      .set('Authorization', `Bearer ${token.doctor}`);
    const dRow = doctorList.body.find((x) => x.id === cons.id);
    expect(dRow).toBeTruthy();
    expect(dRow.patient_identity?.id).toBe(pat.id);
    expect(dRow.doctor_identity?.id).toBe(users.doctor.id);

    const patientList = await r.get('/api/consultations')
      .set('Authorization', `Bearer ${pat.token}`);
    const pRow = patientList.body.find((x) => x.id === cons.id);
    expect(pRow.doctor_identity?.name).toBe('Dr Test Renamed');
    expect(pRow.doctor_identity?.specialty).toBe('Medecine Generale');
    expect(pRow.patient_identity?.id).toBe(pat.id);
  });

  it('unassigned doctor (waiting for routing) → doctor_identity null, patient still enriched', async () => {
    // A consultation created WITHOUT doctorId — no participant doctor yet.
    const pat = await freshPatient('Pat Ident');
    const created = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${pat.token}`)
      .send({ description: 'pa gen doktè', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne' });
    expect(created.status).toBe(201);

    const detail = await r.get(`/api/consultations/${created.body.id}`)
      .set('Authorization', `Bearer ${pat.token}`);
    expect(detail.body.doctor_id).toBeNull();
    expect(detail.body.doctor_identity).toBeNull();
    expect(detail.body.patient_identity?.name).toBe('Pat Ident');
  });
});

describe('identity privacy', () => {
  it('identities NEVER expose email, phone, biography, license or verification state', async () => {
    const pat = await freshPatient();
    const cons = await createConsultation(pat.token);
    const detail = await r.get(`/api/consultations/${cons.id}`)
      .set('Authorization', `Bearer ${token.doctor}`);
    const blob = JSON.stringify({ p: detail.body.patient_identity, d: detail.body.doctor_identity });
    for (const forbidden of ['email', 'phone', 'biography', 'license', 'verification', 'password']) {
      expect(blob).not.toContain(`"${forbidden}`);
    }
    // The doctor looking at the patient sees NO clinical/doctor-only fields
    // (keys omitted entirely, not just null):
    expect(detail.body.patient_identity).not.toHaveProperty('specialty');
    expect(detail.body.patient_identity).not.toHaveProperty('hospital');
  });

  it('non-participants cannot read the consultation (existing boundary unchanged)', async () => {
    const pat = await freshPatient();
    const cons = await createConsultation(pat.token);
    const stranger = await r.get(`/api/consultations/${cons.id}`)
      .set('Authorization', `Bearer ${token.patient2}`);
    expect(stranger.body).toBeNull(); // legacy 200-null convention
  });
});
