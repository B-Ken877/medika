/**
 * Endpoint wrappers for the Medika backend API.
 * One function per backend route — no invented endpoints.
 * Contract source: server.js (repo) + GeminiApi.kt (production Android client).
 */
import { apiFetch, ApiError, API_BASE_URL } from "./client";
import type {
  AuthResponse,
  AttachmentUploadResponse,
  AttachmentUrlResponse,
  CallTokenResponse,
  Consultation,
  ConsultationNote,
  MedicalHistory,
  MedicalHistorySnapshot,
  ReadReceiptResult,
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

/** Mark the other participant's unread incoming messages as read (idempotent). */
export function markConsultationRead(token: string, consultationId: string, signal?: AbortSignal) {
  return apiFetch<ReadReceiptResult>(`/api/consultations/${encodeURIComponent(consultationId)}/read`, {
    method: "POST",
    token,
    signal,
  });
}

/** REST message send — the WS-independent fallback path. The response is the
 *  PERSISTED message; only its arrival proves the message was stored. */
export function sendConsultationMessage(
  token: string,
  consultationId: string,
  input: {
    text?: string;
    messageType?: string;
    fileUrl?: string | null;
    duration?: number | null;
    fileSize?: number | null;
  },
  signal?: AbortSignal,
) {
  return apiFetch<ServerMessage>(`/api/consultations/${encodeURIComponent(consultationId)}/messages`, {
    method: "POST",
    body: input,
    token,
    signal,
    timeoutMs: 30_000,
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

// ─── Private consultation attachments ────────────────────────────────────────

/**
 * Upload a file as a PRIVATE consultation attachment (participant-authorized,
 * active consultation only, server-side type/size validation). XHR instead of
 * fetch because progress reporting requires upload events; errors are
 * normalized to the same ApiError vocabulary as apiFetch().
 */
export function uploadConsultationAttachment(
  token: string,
  consultationId: string,
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void; timeoutMs?: number } = {},
): Promise<AttachmentUploadResponse> {
  const { signal, onProgress, timeoutMs = 120_000 } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new ApiError("aborted", 0, "Demand lan anile."));
    }
    const xhr = new XMLHttpRequest();
    const timer = setTimeout(() => xhr.abort(), timeoutMs);
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.open("POST", `${API_BASE_URL}/api/consultations/${encodeURIComponent(consultationId)}/attachments`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as AttachmentUploadResponse);
      } else {
        reject(new ApiError(
          xhr.status === 401 ? "unauthorized"
            : xhr.status === 403 ? "forbidden"
            : xhr.status === 404 ? "not_found"
            : xhr.status === 400 ? "validation"
            : xhr.status === 409 ? "conflict"
            : xhr.status === 413 ? "validation"
            : "server",
          xhr.status,
          xhr.status === 413
            ? "Fichye a twò gwo. Redwi li anvan ou voye l."
            : "Nou pa t kapab voye fichye a. Eseye ankò.",
          body?.error ? String(body.error) : undefined,
        ));
      }
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new ApiError("network", 0, "Pa gen koneksyon entènèt. Verifye koneksyon ou epi eseye ankò."));
    };
    xhr.onabort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new ApiError("aborted", 0, "Demand lan anile."));
    };

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

/**
 * Obtain a short-lived signed URL for a private attachment. Re-authorized on
 * every call; callers must handle expiry by requesting a fresh URL.
 */
export function getAttachmentUrl(
  token: string,
  consultationId: string,
  attachmentId: string,
  signal?: AbortSignal,
) {
  return apiFetch<AttachmentUrlResponse>(
    `/api/consultations/${encodeURIComponent(consultationId)}/attachments/${encodeURIComponent(attachmentId)}/url`,
    { token, signal },
  );
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
