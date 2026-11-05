/**
 * Issue #82 — structured, immutable prescription documents.
 *
 * Covers: valid issuance (structured + legacy free-text), wrong doctor,
 * patient attempting to issue, non-active/closed consultation, duplicate
 * submission (sequential + concurrent), item validation and allowlist
 * (price fields can never be persisted), patient ownership on the read
 * endpoint, admin access, legacy API compatibility, and that notes /
 * medical-history behavior keeps working after issuance.
 *
 * Fixture note: issue #60 enforces ONE active consultation per patient, so
 * every scenario runs against its own fresh patient (freshPatient()).
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

const ITEMS = [
  {
    name: 'Paracétamol',
    strength: '500 mg',
    form: 'comprimé',
    dose: '1 comprimé',
    route: 'orale',
    frequency: '3 fois par jour',
    duration: '5 jours',
    quantity: '15 comprimés',
    refills: '0',
    instructions: 'À prendre après les repas',
  },
  { name: 'Ibuprofène', strength: '200 mg', dose: '1 comprimé', frequency: '2 fois par jour', duration: '3 jours' },
];

let patientSeq = 0;

/** Fresh patient user + token (issue #60: one active consultation per patient,
 *  so every issuance scenario needs its own patient fixture). */
async function freshPatient() {
  patientSeq += 1;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword, issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  const id = `patient_seq${patientSeq}`;
  const username = `t.seq${patientSeq}`;
  await usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'),
    role: 'patient', name: `Pat Seq ${patientSeq}`, age: 30,
  });
  // Mint the JWT directly — hammering the login endpoint trips its
  // best-effort per-instance throttle (defense-in-depth, by design).
  return { id, token: issueToken({ id, role: 'patient', username, name: `Pat Seq ${patientSeq}` }) };
}

async function createAcceptedConsultation({ doctorId = users.doctor.id, patient } = {}) {
  const pat = patient || (await freshPatient());
  const created = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${pat.token}`)
    .send({
      description: 'Douleurs abdominales', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', doctorId, patientAge: 30,
    });
  expect(created.status).toBe(201);
  const consId = created.body.id;
  const accepted = await r.put(`/api/consultations/${consId}/accept`)
    .set('Authorization', `Bearer ${doctorId === users.doctor.id ? token.doctor : token.doctor2}`);
  expect(accepted.status).toBe(200);
  return { consId, patient: pat };
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.doctor2 = await h.loginToken(r, 't.doctor2');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

describe('issue #82 — structured prescription issuance', () => {
  it('assigned doctor issues a structured prescription while EN_COURS', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: ITEMS, general_instructions: 'Repos et hydratation abondante.' });
    expect(res.status).toBe(200);

    // Consultation completed atomically with the issuance.
    expect(res.body.status).toBe('TERMINE');
    // Legacy plain-text projection stays populated for older Android clients.
    expect(typeof res.body.prescription).toBe('string');
    expect(res.body.prescription).toContain('1. Paracétamol 500 mg (comprimé)');
    expect(res.body.prescription).toContain('Dose : 1 comprimé');
    expect(res.body.prescription).toContain('Instructions générales : Repos et hydratation abondante.');

    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.status).toBe(200);
    expect(doc.body.reference).toMatch(/^ORD-\d{4}-[0-9A-F]{10}$/);
    expect(doc.body.status).toBe('ISSUED');
    expect(doc.body.version).toBe(1);
    expect(doc.body.items).toHaveLength(2);
    // Structured items persist exactly what the doctor dictated — including
    // optional fields — with no invented clinical values.
    expect(doc.body.items[0]).toMatchObject({
      name: 'Paracétamol', strength: '500 mg', form: 'comprimé', dose: '1 comprimé',
      route: 'orale', frequency: '3 fois par jour', duration: '5 jours',
      quantity: '15 comprimés', refills: '0', instructions: 'À prendre après les repas',
    });
    expect(doc.body.items[1]).toMatchObject({ name: 'Ibuprofène', strength: '200 mg' });
    expect(doc.body.items[1].route).toBeUndefined();
    expect(doc.body.general_instructions).toBe('Repos et hydratation abondante.');
    // Server-derived identity — never client-supplied.
    expect(doc.body.doctor.name).toBe('Dr Test');
    expect(doc.body.doctor.license_number).toBe('MSPP-1');
    expect(doc.body.doctor.specialty).toBe('Medecine Generale');
    expect(doc.body.patient.name).toBe('Pat Seq 1');
    expect(doc.body.patient.age).toBe(30);
  });

  it('no price field can ever be persisted (allowlist strips unknown keys)', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({
        items: [
          { name: 'Amoxicilline', strength: '500 mg', price: 150, prix: 150, amount: 150, cost: 150 },
          { name: 'Vitamine C', delivery_fee: 50, pharmacy_price: 75 },
        ],
        general_instructions: 'Ok.',
      });
    expect(res.status).toBe(200);
    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.status).toBe(200);
    for (const item of doc.body.items) {
      expect(item).toEqual(
        expect.not.objectContaining({
          price: expect.anything(), prix: expect.anything(), amount: expect.anything(),
          cost: expect.anything(), delivery_fee: expect.anything(), pharmacy_price: expect.anything(),
        })
      );
    }
    expect(JSON.stringify(doc.body).toLowerCase()).not.toContain('price');
    expect(JSON.stringify(doc.body)).not.toContain('150');
  });

  it('wrong doctor is rejected (legacy 404) and consultation stays EN_COURS', async () => {
    // doctor2 owns this consultation, so doctor_t1's slot stays free for the
    // other scenarios even though this consultation intentionally stays open.
    const { consId, patient } = await createAcceptedConsultation({ doctorId: users.doctor2.id });
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Test' }] });
    // Historical code preserved (the old repo guard answered 404 for any
    // non-issuable state) — no existence/state leak to non-owners.
    expect(res.status).toBe(404);
    const cons = await r.get(`/api/consultations/${consId}`).set('Authorization', `Bearer ${patient.token}`);
    expect(cons.body.status).toBe('EN_COURS');
    expect(cons.body.prescription).toBeNull();
    // Close it with the rightful doctor to free doctor2's slot.
    const close = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor2}`)
      .send({ items: [{ name: 'Suivi standard' }] });
    expect(close.status).toBe(200);
  });

  it('patient cannot issue a prescription (403, role gate)', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ items: [{ name: 'Auto-prescription' }] });
    expect(res.status).toBe(403);
    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.status).toBe(404); // nothing was issued
    // Close the consultation so the doctor's single active slot is freed
    // (issue #60) for the following scenarios.
    const close = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Suivi standard' }] });
    expect(close.status).toBe(200);
  });

  it('not-yet-active consultation (patient-chosen doctor, still RECHERCHE_MEDECIN) → legacy 404', async () => {
    const pat = await freshPatient();
    const created = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${pat.token}`)
      .send({ description: 'Toux', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('RECHERCHE_MEDECIN');
    const res = await r.put(`/api/consultations/${created.body.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`) // the ASSIGNED doctor — auth passes, state fails
      .send({ items: [{ name: 'Sirop' }] });
    // Historical code preserved: non-active consultations were 404 before.
    expect(res.status).toBe(404);
    // Free the doctor's slot (issue #60): the assigned doctor declines the
    // pending request, which terminates it as REFUSE.
    const rejected = await r.put(`/api/consultations/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(rejected.status).toBe(200);
  });

  it('structured payload validation: empty list, missing name, wrong types (400, French messages)', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const base = { Authorization: `Bearer ${token.doctor}` };
    const empty = await r.put(`/api/consultations/${consId}/prescription`).set(base).send({ items: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain('au moins un médicament');

    const noName = await r.put(`/api/consultations/${consId}/prescription`).set(base)
      .send({ items: [{ strength: '500 mg' }] });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toContain('nom du médicament');

    const notArray = await r.put(`/api/consultations/${consId}/prescription`).set(base)
      .send({ items: 'Paracétamol' });
    expect(notArray.status).toBe(400);

    const neither = await r.put(`/api/consultations/${consId}/prescription`).set(base).send({});
    expect(neither.status).toBe(400);

    const both = await r.put(`/api/consultations/${consId}/prescription`).set(base)
      .send({ items: [{ name: 'X' }], prescription: 'texte libre' });
    expect(both.status).toBe(400);

    // The consultation is untouched by every rejected attempt.
    const cons = await r.get(`/api/consultations/${consId}`).set('Authorization', `Bearer ${patient.token}`);
    expect(cons.body.status).toBe('EN_COURS');

    // …and the assigned doctor can still issue normally afterwards (freeing
    // the doctor slot for the next scenarios).
    const ok = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Doliprane', dose: '1 comprimé' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('TERMINE');
  });

  it('duplicate submission answers 409 PRESCRIPTION_ALREADY_ISSUED and never overwrites', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const first = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Original', dose: '1 comprimé' }] });
    expect(first.status).toBe(200);

    const second = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'REPLACEMENT-ATTACK' }] });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PRESCRIPTION_ALREADY_ISSUED');
    expect(second.body.error).toContain('déjà été établie');

    // The original document is intact — no silent overwrite of the clinical record.
    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.body.items).toHaveLength(1);
    expect(doc.body.items[0].name).toBe('Original');
  });

  it('concurrent double-submit: exactly one 200, one 409 (row-locked atomicity)', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const [a, b] = await Promise.allSettled([
      r.put(`/api/consultations/${consId}/prescription`)
        .set('Authorization', `Bearer ${token.doctor}`)
        .send({ items: [{ name: 'Course A' }] }),
      r.put(`/api/consultations/${consId}/prescription`)
        .set('Authorization', `Bearer ${token.doctor}`)
        .send({ items: [{ name: 'Course B' }] }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const statuses = [a.value.status, b.value.status].sort();
    expect(statuses).toEqual([200, 409]);

    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.status).toBe(200);
    expect(doc.body.items).toHaveLength(1);
    expect(['Course A', 'Course B']).toContain(doc.body.items[0].name);
  });
});

describe('issue #82 — legacy API compatibility', () => {
  it('legacy free-text body still completes the consultation, verbatim projection', async () => {
    const { consId, patient } = await createAcceptedConsultation();
    const text = 'Paracétamol 500 mg: 1 tablete 3 fwa pa jou pandan 5 jou\nRepo epi bwè anpil dlo';
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: text });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('TERMINE');
    expect(res.body.prescription).toBe(text); // byte-for-byte, like the historical API

    // The document exists with the text as general instructions and no items.
    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(doc.status).toBe(200);
    expect(doc.body.items).toEqual([]);
    expect(doc.body.general_instructions).toBe(text);
    expect(doc.body.reference).toMatch(/^ORD-\d{4}-[0-9A-F]{10}$/);
  });

  it('empty prescription body is rejected (400) like the historical API', async () => {
    const { consId } = await createAcceptedConsultation();
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: '   ' });
    expect(res.status).toBe(400);
    // Nothing was persisted — close the consultation so the doctor's single
    // active slot (issue #60) is freed for the next scenarios.
    const close = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Suivi standard' }] });
    expect(close.status).toBe(200);
  });
});

describe('issue #82 — read authorization', () => {
  let consId, patToken;

  beforeAll(async () => {
    const { consId: id, patient } = await createAcceptedConsultation();
    consId = id;
    patToken = patient.token;
    const issued = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Oméprazole', dose: '1 gélule', frequency: '1 fois par jour', duration: '14 jours' }] });
    expect(issued.status).toBe(200);
  });

  it('owning patient can read the document', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].name).toBe('Oméprazole');
  });

  it('issuing doctor can read the document', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
  });

  it('admin can read the document (existing convention)', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
  });

  it('another patient gets 404 (no existence leak)', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(404);
  });

  it('another doctor (not assigned, not admin) gets 404', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor2}`);
    expect(res.status).toBe(404);
  });

  it('unauthenticated read is rejected', async () => {
    const res = await r.get(`/api/consultations/${consId}/prescription`);
    expect([401, 403]).toContain(res.status);
  });

  it('consultation without an issued document answers 404 (legacy prescriptions stay on the old field)', async () => {
    // Direct repo fixture: an unrouted pending consultation holds no doctor
    // offer/slot, keeping the doctor's single-slot invariant untouched.
    const { createConsultationFixture } = h;
    const pat = await freshPatient();
    const fixture = await createConsultationFixture({ patientId: pat.id, status: 'RECHERCHE_MEDECIN', doctorId: null });
    const res = await r.get(`/api/consultations/${fixture.id}/prescription`)
      .set('Authorization', `Bearer ${pat.token}`);
    expect(res.status).toBe(404);
  });
});

describe('issue #82 — consultation notes / medical history keep working', () => {
  let consId, patToken;

  it('doctor can still save notes after issuance; dossier auto-update intact; no diagnosis leaks into the document', async () => {
    const { consId: id, patient } = await createAcceptedConsultation();
    consId = id;
    patToken = patient.token;
    const issued = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ items: [{ name: 'Métronidazole', dose: '1 comprimé', frequency: '2 fois par jour', duration: '7 jours' }] });
    expect(issued.status).toBe(200);

    const notes = await r.put(`/api/consultations/${consId}/notes`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({
        diagnosis: 'Infection digestive',
        symptoms: 'Douleurs abdominales',
        notes: 'Traitement demarre.',
        prescriptions: [{ medication: 'Amoxicilline', dosage: '500 mg', duration: '6 jours' }],
        followUp: 'Contrôle dans 2 semaines',
        flagAllergy: false,
      });
    expect(notes.status).toBe(200);

    // Notes prescriptions still feed the patient dossier (no duplication of
    // the prescription document into the notes flow — separate sources kept).
    const history = await r.get(`/api/medical-history/${patient.id}`)
      .set('Authorization', `Bearer ${patToken}`);
    expect(history.status).toBe(200);
    const names = (history.body.current_medications || []).map((m) => m.name);
    expect(names).toContain('Amoxicilline');

    // The issued document carries NO diagnosis or note text.
    const doc = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patToken}`);
    expect(doc.status).toBe(200);
    const serialized = JSON.stringify(doc.body).toLowerCase();
    expect(serialized).not.toContain('infection digestive');
    expect(serialized).not.toContain('traitement demarre');
  });
});
