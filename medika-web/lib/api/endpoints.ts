/**
 * Endpoint wrappers for the Medika backend API.
 * One function per backend route — no invented endpoints.
 * Contract source: server.js (repo) + GeminiApi.kt (production Android client).
 */
import { apiFetch } from "./client";
import type {
  AuthResponse,
  CallTokenResponse,
  Consultation,
  ConsultationNote,
  MedicalHistory,
  MedicalHistorySnapshot,
  SaveConsultationNoteRequest,
  ServerMessage,
  SpecialtyPrice,
  Ticket,
  TicketMessage,
  UpdateMedicalHistoryRequest,
  UploadResponse,
  User,
} from "./types";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export function login(username: string, password: string, signal?: AbortSignal) {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { username, password },
    signal,
    timeoutMs: 15_000,
  });
}

export interface RegisterInput {
  username: string;
  password: string;
  name: string;
  email?: string;
  phone?: string;
  age?: number | null;
  gender?: string;
}

export function register(input: RegisterInput, signal?: AbortSignal) {
  return apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: input,
    signal,
    timeoutMs: 15_000,
  });
}

export function getProfile(token: string, signal?: AbortSignal) {
  return apiFetch<User>("/api/profile", { token, signal });
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
  phone?: string;
  age?: number | string;
  gender?: string;
}

export function updateProfile(token: string, input: UpdateProfileInput, signal?: AbortSignal) {
  return apiFetch<User>("/api/profile", { method: "PUT", body: input, token, signal });
}

// ─── Doctors ──────────────────────────────────────────────────────────────────

export function getDoctors(token: string, signal?: AbortSignal) {
  return apiFetch<User[]>("/api/doctors", { token, signal });
}

export function getDoctorsBySpecialty(token: string, specialty: string, signal?: AbortSignal) {
  return apiFetch<User[]>("/api/doctors", { token, params: { specialty }, signal });
}

// ─── Specialties / pricing ────────────────────────────────────────────────────

export function getSpecialtyPrices(token?: string | null, signal?: AbortSignal) {
  return apiFetch<SpecialtyPrice[]>("/api/specialties/prices", { token: token ?? undefined, signal });
}

export function getSpecialtyPrice(specialty: string, signal?: AbortSignal) {
  return apiFetch<{ specialty: string; price: number }>("/api/specialties/price", {
    params: { specialty },
    signal,
  });
}

// ─── Consultations ────────────────────────────────────────────────────────────

export interface CreateConsultationInput {
  description: string;
  specialtyNeeded: string;
  urgencyLevel: string;
  aiSummary?: string;
  aiExplanation?: string;
  doctorId?: string | null;
  patientAge?: number | null;
  transactionId?: string | null;
  paymentAmount?: number | null;
  orderId?: string | null;
}

export function createConsultation(token: string, input: CreateConsultationInput, signal?: AbortSignal) {
  return apiFetch<Consultation>("/api/consultations", {
    method: "POST",
    body: input,
    token,
    signal,
    timeoutMs: 25_000,
  });
}

export function getConsultations(token: string, signal?: AbortSignal) {
  return apiFetch<Consultation[]>("/api/consultations", { token, signal });
}

export function getConsultation(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<Consultation | null>(`/api/consultations/${encodeURIComponent(id)}`, {
    token,
    signal,
  });
}

export function getMessages(token: string, consultationId: string, signal?: AbortSignal) {
  return apiFetch<ServerMessage[]>(`/api/consultations/${encodeURIComponent(consultationId)}/messages`, {
    token,
    signal,
  });
}

export function acceptConsultation(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<Consultation>(`/api/consultations/${encodeURIComponent(id)}/accept`, {
    method: "PUT",
    token,
    signal,
  });
}

export function rejectConsultation(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<Consultation>(`/api/consultations/${encodeURIComponent(id)}/reject`, {
    method: "PUT",
    token,
    signal,
  });
}

export function writePrescription(token: string, id: string, prescription: string, signal?: AbortSignal) {
  return apiFetch<Consultation>(`/api/consultations/${encodeURIComponent(id)}/prescription`, {
    method: "PUT",
    body: { prescription },
    token,
    signal,
  });
}

// ─── Doctor availability ──────────────────────────────────────────────────────

export function updateAvailability(token: string, isAvailable: boolean, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; isAvailable: boolean }>("/api/doctor/availability", {
    method: "PUT",
    body: { isAvailable },
    token,
    signal,
  });
}

// ─── Calls (LiveKit token generation) ─────────────────────────────────────────

export function getCallToken(token: string, consultationId: string, isVideo: boolean, signal?: AbortSignal) {
  return apiFetch<CallTokenResponse>("/api/call/token", {
    method: "POST",
    body: { consultationId, isVideo },
    token,
    signal,
  });
}

// ─── Uploads ──────────────────────────────────────────────────────────────────

export function uploadFile(token: string, file: File, consultationId?: string, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  const params: Record<string, string> = {};
  if (consultationId) params.consultationId = consultationId;
  return apiFetch<UploadResponse>("/api/upload", {
    method: "POST",
    body: form,
    token,
    params,
    signal,
    timeoutMs: 120_000,
  });
}

// ─── Consultation notes (doctor) ──────────────────────────────────────────────
// Production-only endpoints (not in repo server.js — see PR description).

export function getConsultationNotes(token: string, consultationId: string, signal?: AbortSignal) {
  return apiFetch<ConsultationNote | null>(`/api/consultations/${encodeURIComponent(consultationId)}/notes`, {
    token,
    signal,
  });
}

export function saveConsultationNotes(
  token: string,
  consultationId: string,
  input: SaveConsultationNoteRequest,
  signal?: AbortSignal,
) {
  return apiFetch<ConsultationNote>(`/api/consultations/${encodeURIComponent(consultationId)}/notes`, {
    method: "PUT",
    body: input,
    token,
    signal,
  });
}

// ─── Medical history (dossier médical) ────────────────────────────────────────
// Production-only endpoints (not in repo server.js — see PR description).

export function getMedicalHistory(token: string, patientId: string, signal?: AbortSignal) {
  return apiFetch<MedicalHistory>(`/api/medical-history/${encodeURIComponent(patientId)}`, {
    token,
    signal,
  });
}

export function getMedicalHistorySnapshot(token: string, patientId: string, signal?: AbortSignal) {
  return apiFetch<MedicalHistorySnapshot>(`/api/medical-history/${encodeURIComponent(patientId)}/snapshot`, {
    token,
    signal,
  });
}

export function updateMedicalHistory(
  token: string,
  patientId: string,
  input: UpdateMedicalHistoryRequest,
  signal?: AbortSignal,
) {
  return apiFetch<MedicalHistory>(`/api/medical-history/${encodeURIComponent(patientId)}`, {
    method: "PUT",
    body: input,
    token,
    signal,
  });
}

// ─── Support tickets ──────────────────────────────────────────────────────────
// Production-only endpoints (not in repo server.js — see PR description).

export function getTickets(token: string, signal?: AbortSignal) {
  return apiFetch<Ticket[]>("/api/tickets", { token, signal });
}

export function createTicket(
  token: string,
  input: { subject: string; message?: string; priority?: string },
  signal?: AbortSignal,
) {
  return apiFetch<Ticket>("/api/tickets", { method: "POST", body: input, token, signal });
}

export function getTicket(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<Ticket>(`/api/tickets/${encodeURIComponent(id)}`, { token, signal });
}

export function sendTicketMessage(token: string, id: string, message: string, signal?: AbortSignal) {
  return apiFetch<TicketMessage>(`/api/tickets/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: { message },
    token,
    signal,
  });
}

export function getTicketMessages(token: string, id: string, signal?: AbortSignal): Promise<TicketMessage[]> {
  // The Android client receives messages embedded in GET /api/tickets/{id};
  // use the ticket detail endpoint and read the thread defensively.
  return getTicket(token, id, signal).then((ticket) => {
    const msgs = (ticket as { messages?: unknown }).messages;
    return Array.isArray(msgs) ? (msgs as TicketMessage[]) : [];
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────

export function health(signal?: AbortSignal) {
  return apiFetch<{ status: string; time: string }>("/api/health", { signal, timeoutMs: 8_000 });
}
