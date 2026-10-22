/**
 * Test helpers — app/server composition per test file (worker isolation gives
 * each file a fresh module registry, so env vars set at the top of a test
 * file apply before src/config.js is loaded).
 *
 * NOTE: this module must NOT import anything from src/ at module scope.
 * All src modules are CommonJS; dynamic import() interop is normalized via
 * importCjs() below.
 */
'use strict';

const request = require('supertest');

async function importCjs(modulePath) {
  const m = await import(modulePath);
  return m.default ?? m;
}

/** Build a fresh app+server (env must already be set). */
async function setup() {
  const server = await importCjs('../server.js');
  const app = server.app;
  return { server, app, request: request(app) };
}

/** Wipe user data between tests/files (specialties + migrations preserved). */
async function resetDb() {
  const { query } = await importCjs('../src/db.js');
  await query(`TRUNCATE messages, ticket_messages, tickets, consultation_notes,
               medical_histories, payments, consultations, users RESTART IDENTITY CASCADE`);
}

async function closeAll() {
  const { getPool } = await importCjs('../src/db.js');
  await getPool().end();
}

/** Standard fixture users. Returns {admin, doctor, patient} API user objects. */
async function createFixtureUsers() {
  const usersRepo = await importCjs('../src/repos/users.js');
  const { hashPassword } = await importCjs('../src/auth.js');
  const mk = async (id, username, role, extra = {}) =>
    usersRepo.create({
      id, username, password_hash: hashPassword('Passw0rd!'), role,
      name: extra.name || `User ${username}`, email: extra.email, phone: extra.phone,
      age: extra.age ?? 30, gender: 'Homme', specialty: extra.specialty,
      license_number: extra.license_number, location: extra.location,
      hospital: extra.hospital, biography: extra.biography,
    });
  await mk('admin_t1', 't.admin', 'admin', { name: 'Admin Test' });
  await mk('doctor_t1', 't.doctor', 'doctor', { name: 'Dr Test', specialty: 'Medecine Generale', license_number: 'MSPP-1', hospital: 'Hopital Test' });
  await mk('doctor_t2', 't.doctor2', 'doctor', { name: 'Dr Deux', specialty: 'Cardiologie' });
  await mk('patient_t1', 't.patient', 'patient', { name: 'Pat Test', email: 'pat@test.ht', phone: '+509 1' });
  await mk('patient_t2', 't.patient2', 'patient', { name: 'Pat Deux' });
  return {
    admin: { id: 'admin_t1', username: 't.admin' },
    doctor: { id: 'doctor_t1', username: 't.doctor' },
    doctor2: { id: 'doctor_t2', username: 't.doctor2' },
    patient: { id: 'patient_t1', username: 't.patient' },
    patient2: { id: 'patient_t2', username: 't.patient2' },
  };
}

/** Login and return the JWT bearer token. */
async function loginToken(r, username) {
  const res = await r.post('/api/auth/login').send({ username, password: 'Passw0rd!' });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function authHeader(r, username) {
  return { Authorization: `Bearer ${await loginToken(r, username)}` };
}

/** Create a consultation directly via repo (test fixture). */
async function createConsultationFixture({ patientId, patientName = 'Pat Test', doctorId = null, status = 'RECHERCHE_MEDECIN', specialty = 'Medecine Generale' }) {
  const consultationsRepo = await importCjs('../src/repos/consultations.js');
  const { v4: uuidv4 } = await importCjs('uuid');
  const row = await consultationsRepo.create({
    id: 'cons_' + uuidv4().substring(0, 8),
    patient_id: patientId,
    patient_name: patientName,
    patient_age: 30,
    doctor_id: doctorId,
    description: 'fixture',
    specialty_needed: specialty,
    urgency_level: 'Moyenne',
    ai_summary: '', ai_explanation: '',
  });
  if (status !== 'RECHERCHE_MEDECIN' && doctorId) {
    return consultationsRepo.accept(row.id, doctorId);
  }
  return row;
}

/** Simulated payment fixture: creates + verifies a payment row (simulation mode only). */
async function createPaidPaymentFixture({ patientId, orderId, amount }) {
  const paymentsRepo = await importCjs('../src/repos/payments.js');
  const row = await paymentsRepo.create({ order_id: orderId, patient_id: patientId, amount, simulated: true });
  const tx = 'SIM-' + Buffer.from(orderId).toString('base64url').slice(0, 12);
  return paymentsRepo.markVerified(row.id, { transaction_id: tx, verified_amount: amount, provider_raw: { simulated: true }, simulated: true });
}

module.exports = {
  setup,
  resetDb,
  closeAll,
  createFixtureUsers,
  loginToken,
  authHeader,
  createConsultationFixture,
  createPaidPaymentFixture,
};
