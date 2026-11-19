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
  CreateMedicationOrderRequest,
  DeliveryZone,
  DoctorWallet,
  IssuePrescriptionRequest,
  MedicalHistory,
  MedicalHistorySnapshot,
  MedicationOrder,
  PrescriptionDocument,
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
  /** Uploaded avatar URL (from /api/upload) — validated server-side to be an
   *  absolute http(s) URL or a site-relative /uploads/ path. */
  avatarUrl?: string;
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

/** Public doctor detail for the profile page (issue #30). Same redaction
 *  contract as the list (no email/phone); carries the explicit
 *  verification_status (issue #32). */
export function getDoctor(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<User>(`/api/doctors/${encodeURIComponent(id)}`, { token, signal });
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

/**
 * Express call-center request: the patient supplies NOTHING (no body). The
 * backend creates the consultation on the Medecine Generale defaults with
 * channel='CALL_CENTER' and routes it to the on-duty agent; the caller then
 * opens /app/consultations/<id>/call?mode=voice and waits for the agent to
 * pick up. A 409 means the patient already has an active consultation
 * (existing_id points at it).
 */
export function createCallCenterConsultation(token: string, signal?: AbortSignal) {
  return apiFetch<Consultation>("/api/consultations/call-center", {
    method: "POST",
    body: {},
    token,
    signal,
    timeoutMs: 25_000,
  });
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
 *  PERSISTED message; only its arrival proves the message was stored.
 *  `clientMsgId` makes retries idempotent server-side ((sender, client_msg_id)
 *  is unique): a retry after a lost-but-persisted WS frame returns the
 *  ORIGINAL row instead of duplicating it. */
export function sendConsultationMessage(
  token: string,
  consultationId: string,
  input: {
    text?: string;
    messageType?: string;
    fileUrl?: string | null;
    duration?: number | null;
    fileSize?: number | null;
    clientMsgId?: string;
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

// ─── Prescription document (issue #82) ───────────────────────────────────────

/** Structured, immutable prescription issuance (replaces the free-text-only
 *  composer). The server validates, allowlist-filters the item fields and
 *  completes the consultation atomically; a duplicate submit answers 409
 *  PRESCRIPTION_ALREADY_ISSUED. */
export function issuePrescription(token: string, id: string, payload: IssuePrescriptionRequest, signal?: AbortSignal) {
  return apiFetch<Consultation>(`/api/consultations/${encodeURIComponent(id)}/prescription`, {
    method: "PUT",
    body: payload,
    token,
    signal,
  });
}

/** The active prescription document (patient owner, issuing doctor, admin).
 *  404 when the consultation has none — legacy free-text prescriptions stay
 *  readable through Consultation.prescription. */
export function getPrescriptionDocument(token: string, id: string, signal?: AbortSignal) {
  return apiFetch<PrescriptionDocument>(`/api/consultations/${encodeURIComponent(id)}/prescription`, {
    token,
    signal,
  });
}

// ─── Medication orders + pharmacy quotes (issue #83) ─────────────────────────

/** The exact, currently ACTIVE delivery zone records (issue #82 §7).
 *  An empty list means Medika delivery is not configured yet — the order
 *  form must then stay closed (fail closed) and the patient keeps the
 *  independent-purchase path (download/print the ordonnance). */
export function getDeliveryZones(token: string, signal?: AbortSignal) {
  return apiFetch<{ zones: DeliveryZone[] }>(
    "/api/delivery-zones",
    { token, signal },
  );
}

// Patient delivery tracking + receipt confirmation: getDeliveryTracking /
// confirmDeliveryReceipt (issue #82 §7 block below).

/** Ask Medika to source the medications of this consultation's issued
 *  prescription (« Demander le prix et la livraison avec Medika »). The
 *  payload is REQUIRED and fully typed: address, city, Haitian phone and
 *  the selected coverage-zone record id — there is no empty default (this
 *  replaces the reverted coordinator change 7ac67aa with a real contract:
 *  a call site missing a field is a compile error, and the server
 *  re-validates everything anyway). 409 PRESCRIPTION_NOT_ISSUED for legacy
 *  free-text prescriptions; 409 MEDICATION_ORDER_ALREADY_EXISTS when one is
 *  already active; 422 DELIVERY_ZONE_NOT_SUPPORTED outside active zones. */
export function createMedicationOrder(
  token: string,
  consultationId: string,
  payload: CreateMedicationOrderRequest,
  signal?: AbortSignal,
) {
  return apiFetch<MedicationOrder>(
    `/api/consultations/${encodeURIComponent(consultationId)}/medication-order`,
    { method: "POST", body: payload, token, signal },
  );
}

/** The patient's medication order for this consultation (order + active
 *  quote + derived next step). 404 when no order exists yet. */
export function getMedicationOrderByConsultation(token: string, consultationId: string, signal?: AbortSignal) {
  return apiFetch<MedicationOrder>(
    `/api/consultations/${encodeURIComponent(consultationId)}/medication-order`,
    { token, signal },
  );
}

/** Accept the active, unexpired quote (patient only; 409 QUOTE_EXPIRED once
 *  the validity passed — revalidated server-side at the transition). */
export function acceptMedicationQuote(token: string, orderId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; status: string }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/accept`,
    { method: "POST", token, signal },
  );
}

/** Decline the quote (terminal; a new request can be created afterwards). */
export function declineMedicationQuote(token: string, orderId: string, reason?: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; status: string }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/decline`,
    { method: "POST", body: { reason: reason ?? "" }, token, signal },
  );
}

/** Cancel the request BEFORE any quote (REQUESTED / ESCALATED only). */
export function cancelMedicationOrder(token: string, orderId: string, reason?: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; status: string }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST", body: { reason: reason ?? "" }, token, signal },
  );
}

/** Create or resume the server-priced MonCash payment for an accepted quote. */
export function createMedicationPayment(token: string, orderId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; paid?: boolean; simulated?: boolean; payment?: import('./types').MedicationPayment; redirectUrl?: string }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/payment/create`,
    { method: 'POST', body: {}, token, signal },
  );
}

/** Verify a medication payment with MonCash; never trusts client status or amount. */
export function verifyMedicationPayment(token: string, orderId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; payment?: import('./types').MedicationPayment }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/payment/verify`,
    { method: 'POST', body: {}, token, signal },
  );
}

// ─── Delivery tracking (issue #82 §7) ────────────────────────────────────────

/** The patient's delivery tracking for this order (status history included).
 *  404 when no delivery exists (not assigned yet). */
export function getDeliveryTracking(token: string, orderId: string, signal?: AbortSignal) {
  return apiFetch<import('./types').DeliveryTracking>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/delivery`,
    { token, signal },
  );
}

/** The patient confirms receipt — the ONLY way a delivery becomes DELIVERED
 *  (a courier's button click is never proof). Server-enforced stages. */
export function confirmDeliveryReceipt(token: string, orderId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; status: string }>(
    `/api/medication-orders/${encodeURIComponent(orderId)}/delivery/confirm`,
    { method: 'POST', body: {}, token, signal },
  );
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

// ─── Doctor wallet (issue #24: read-only — doctors never request payouts) ────

export function getDoctorWallet(token: string, signal?: AbortSignal) {
  return apiFetch<DoctorWallet>("/api/doctor/wallet", { token, signal });
}

// ─── Calls (ZEGOCLOUD token generation) ────────────────────────────────────

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

// ─── Notifications (issue #36) ───────────────────────────────────────────────

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export interface AppNotification {
  id: number;
  category: "consultations" | "messages" | "calls" | "wallet" | string;
  event_type: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  created_at: number | null;
}

export interface NotificationPreferences {
  consultations: boolean;
  messages: boolean;
  calls: boolean;
  wallet: boolean;
}

/** Register a Web Push subscription for the authenticated user (multi-device). */
export function registerPushSubscription(token: string, sub: PushSubscriptionInput, signal?: AbortSignal) {
  return apiFetch<{ success: boolean }>("/api/notifications/subscriptions", {
    method: "POST",
    body: sub,
    token,
    signal,
  });
}

/** Revoke own subscription(s) — by endpoint, or all (logout). */
export function revokePushSubscription(token: string, endpoint?: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean }>("/api/notifications/subscriptions", {
    method: "DELETE",
    body: endpoint ? { endpoint } : {},
    token,
    signal,
  });
}

/** Persisted in-app history (paginated, own only). */
export function getNotifications(
  token: string,
  opts: { limit?: number; before?: number; signal?: AbortSignal } = {},
) {
  return apiFetch<{ notifications: AppNotification[]; unread: number; hasMore: boolean }>(
    "/api/notifications",
    {
      token,
      params: { limit: opts.limit, before: opts.before },
      signal: opts.signal,
    },
  );
}

/** Lightweight unread count for the header bell (issue #72) — server truth. */
export function getUnreadNotificationCount(token: string, signal?: AbortSignal) {
  return apiFetch<{ unread: number }>("/api/notifications/unread", { token, signal });
}

export function markNotificationsRead(token: string, ids: number[], signal?: AbortSignal) {
  return apiFetch<{ success: boolean; updated: number }>("/api/notifications/read", {
    method: "POST",
    body: { ids },
    token,
    signal,
  });
}

export function markAllNotificationsRead(token: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; updated: number }>("/api/notifications/read-all", {
    method: "POST",
    token,
    signal,
  });
}

export function getNotificationPreferences(token: string, signal?: AbortSignal) {
  return apiFetch<NotificationPreferences>("/api/notifications/preferences", { token, signal });
}

export function updateNotificationPreferences(
  token: string,
  prefs: Partial<NotificationPreferences>,
  signal?: AbortSignal,
) {
  return apiFetch<NotificationPreferences>("/api/notifications/preferences", {
    method: "PUT",
    body: prefs,
    token,
    signal,
  });
}

/** VAPID public key for subscribing (null when push is server-disabled). */
export function getVapidPublicKey(token: string, signal?: AbortSignal) {
  return apiFetch<{ publicKey: string | null; configured: boolean }>(
    "/api/notifications/vapid-public-key",
    { token, signal },
  );
}

// ─── Health ───────────────────────────────────────────────────────────────────

export function health(signal?: AbortSignal) {
  return apiFetch<{ status: string; time: string }>("/api/health", { signal, timeoutMs: 8_000 });
}

// ─── Agent operations (human contact center) ─────────────────────────────────

export interface AssistStatus {
  sessionId?: string;
  status: "none" | "waiting" | "connecting" | "connected" | "wrap_up";
  position?: number | null;
  agentName?: string | null;
  agentsAvailable?: number;
  existing?: boolean;
  createdAt?: string;
}

export interface AssistCallback {
  callbackId: string;
  status: string;
  phoneNumber: string;
  phoneVerified?: boolean;
  retryCount?: number;
  maxRetries?: number;
  nextAttemptAt?: string | null;
  attempts?: { result: string; at: string }[];
  createdAt?: string;
}

export interface AgentOffer {
  assignmentId: string;
  sessionId: string;
  offeredAt: string;
  expiresAt: string;
  language?: string;
  specialty?: string | null;
  reason?: string;
}

export interface AgentDashboard {
  presence: string;
  shift: { id: string; status: string; scheduledEnd?: string | null } | null;
  offers: AgentOffer[];
  queueWaiting: number;
  callbacksPending: AssistCallbackView[];
  activeSession: { sessionId: string; status: string } | null;
  today: { callsHandled: number; consultRequests: number; callbackOutcomes: number; unresolved: number; avgSessionSeconds: number | null };
}

export interface AssistCallbackView {
  callbackId: string;
  patientName: string;
  patientId: string;
  phoneNumber: string;
  phoneVerified: boolean;
  status: string;
  reason?: string;
  language?: string;
  retryCount?: number;
  maxRetries?: number;
  nextAttemptAt?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export interface AgentSessionDetail {
  session: {
    sessionId: string; status: string; source: string; language: string;
    reason: string; specialty: string | null; chosenDoctorId: string | null;
    consultationId: string | null; consultState: string;
    consultation: { id: string; status: string; doctorId: string | null; specialty: string; createdAt: number } | null;
    startedAt: string | null; callStartedAt: string | null; callEndedAt: string | null;
    outcome: string | null; outcomeNote: string; createdAt: string; queuePosition: number | null;
  };
  patient: { id: string; name: string; phone: string | null; language?: string } | null;
  events: { type: string; at: string; actor: string | null }[];
  notes: { id: string; content: string; agent: string; at: string }[];
  calls: { id: string; channel: string; state: string; startedAt: string; endedAt: string | null; failureReason: string }[];
}

export function requestAssistance(token: string, language = "ht") {
  return apiFetch<AssistStatus>("/api/assist/requests", { method: "POST", body: { language }, token });
}

export function getAssistStatus(token: string, signal?: AbortSignal) {
  return apiFetch<AssistStatus>("/api/assist/requests/current", { token, signal });
}

export function cancelAssistance(token: string) {
  return apiFetch<{ status: string }>("/api/assist/requests/current/cancel", { method: "POST", token });
}

export function requestCallback(token: string, input: { phoneNumber: string; reason?: string; windowStart?: string; windowEnd?: string }) {
  return apiFetch<AssistCallback>("/api/assist/callbacks", { method: "POST", body: input, token });
}

export function getCurrentCallback(token: string, signal?: AbortSignal) {
  return apiFetch<AssistCallback | { status: "none" }>("/api/assist/callbacks/current", { token, signal });
}

export function linkAssistConsultation(token: string, sessionId: string, consultationId: string) {
  return apiFetch<{ linked: boolean }>(`/api/assist/sessions/${encodeURIComponent(sessionId)}/link-consultation`, {
    method: "POST", body: { consultationId }, token,
  });
}

export function getAssistCallToken(token: string, sessionId: string) {
  return apiFetch<CallTokenResponse & { audioOnly?: boolean }>(`/api/assist/sessions/${encodeURIComponent(sessionId)}/call-token`, { token });
}

export function endAssistCall(token: string, sessionId: string, failureReason = "") {
  return apiFetch<{ status: string }>(`/api/assist/sessions/${encodeURIComponent(sessionId)}/call-end`, {
    method: "POST", body: { failureReason }, token,
  });
}

export function getAgentMe(token: string, signal?: AbortSignal) {
  return apiFetch<{ role: string; agent: { employeeRef: string | null; status: string } | null; presence: { availability: string; lastHeartbeat?: string; connectionState?: string }; shift: { id: string; status: string; startedAt?: string; scheduledEnd?: string | null } | null; activeSession: { sessionId: string; status: string } | null }>(
    "/api/agent/me", { token, signal },
  );
}

export function agentShiftStart(token: string) {
  return apiFetch<{ shift: { id: string; status: string; scheduledEnd?: string | null }; existing: boolean }>("/api/agent/shift/start", { method: "POST", token });
}

export function agentShiftEnd(token: string) {
  return apiFetch<{ shift: { id: string; status: string } }>("/api/agent/shift/end", { method: "POST", token });
}

export function agentBreakStart(token: string) {
  return apiFetch<{ availability: string }>("/api/agent/shift/break/start", { method: "POST", token });
}

export function agentBreakEnd(token: string) {
  return apiFetch<{ availability: string }>("/api/agent/shift/break/end", { method: "POST", token });
}

export function agentPresence(token: string, availability: string) {
  return apiFetch<{ availability: string }>("/api/agent/presence", { method: "POST", body: { availability }, token });
}

export function agentHeartbeat(token: string, connectionState = "connected") {
  return apiFetch<{ heartbeat: string }>("/api/agent/presence/heartbeat", { method: "POST", body: { connectionState }, token, timeoutMs: 8_000 });
}

export function agentAcceptOffer(token: string, assignmentId: string) {
  return apiFetch<{ sessionId: string; status: string }>(`/api/agent/assignments/${encodeURIComponent(assignmentId)}/accept`, { method: "POST", token });
}

export function agentDeclineOffer(token: string, assignmentId: string) {
  return apiFetch<{ declined: boolean; rerouted: boolean }>(`/api/agent/assignments/${encodeURIComponent(assignmentId)}/decline`, { method: "POST", token });
}

export function agentDashboard(token: string, signal?: AbortSignal) {
  return apiFetch<AgentDashboard>("/api/agent/dashboard", { token, signal });
}

export function agentSession(token: string, sessionId: string, signal?: AbortSignal) {
  return apiFetch<AgentSessionDetail>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { token, signal });
}

export function agentSessionSpecialty(token: string, sessionId: string, specialty: string) {
  return apiFetch<{ specialty: string; price: number }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/specialty`, { method: "POST", body: { specialty }, token });
}

export function agentSessionDoctor(token: string, sessionId: string, doctorId: string) {
  return apiFetch<{ doctorId: string; doctorName: string }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/doctor`, { method: "POST", body: { doctorId }, token });
}

export function agentSessionNote(token: string, sessionId: string, content: string) {
  return apiFetch<{ id: string }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/notes`, { method: "POST", body: { content }, token });
}

export function agentCallStart(token: string, sessionId: string) {
  return apiFetch<CallTokenResponse & { attemptId?: string; audioOnly?: boolean }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/call/start`, { method: "POST", token });
}

export function agentCallEnd(token: string, sessionId: string, failureReason = "") {
  return apiFetch<{ status: string }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/call/end`, { method: "POST", body: { failureReason }, token });
}

export function agentSessionComplete(token: string, sessionId: string, outcome: string, outcomeNote = "") {
  return apiFetch<{ sessionId: string; status: string; outcome: string }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST", body: { outcome, outcomeNote }, token,
  });
}

export function agentSpecialties(token: string, signal?: AbortSignal) {
  return apiFetch<SpecialtyPrice[]>("/api/agent/specialties", { token, signal });
}

export function agentCallbacks(token: string, signal?: AbortSignal) {
  return apiFetch<{ mine: AssistCallbackView[]; pool: AssistCallbackView[] }>("/api/agent/callbacks", { token, signal });
}

export function agentClaimCallback(token: string, callbackId: string) {
  return apiFetch<{ callbackId: string; status: string }>(`/api/agent/callbacks/${encodeURIComponent(callbackId)}/claim`, { method: "POST", token });
}

export function agentCallbackResult(token: string, callbackId: string, result: string, note = "") {
  return apiFetch<{ connected: boolean; sessionId?: string; retryCount?: number }>(`/api/agent/callbacks/${encodeURIComponent(callbackId)}/result`, {
    method: "POST", body: { result, note }, token,
  });
}

export function agentOpsOverview(token: string, signal?: AbortSignal) {
  return apiFetch<{ metrics: Record<string, number>; agents: { agentId: string; name: string; availability: string; shiftStatus: string | null; lastHeartbeat: string; connectionState: string }[] }>(
    "/api/agent/ops/overview", { token, signal },
  );
}

export function agentOpsSessions(token: string, signal?: AbortSignal) {
  return apiFetch<{ sessionId: string; status: string; source: string; outcome: string | null; specialty: string | null; consultationId: string | null; patientName: string; agentName: string | null; createdAt: string; startedAt: string | null; endedAt: string | null }[]>(
    "/api/agent/ops/sessions", { token, signal },
  );
}

export function agentOpsReports(token: string, signal?: AbortSignal) {
  return apiFetch<{ since: string; metrics: Record<string, number>; perAgent: { agentId: string; name: string; employeeRef: string | null; completed: number; consultRequests: number; unresolved: number; avgSessionSeconds: number | null }[] }>(
    "/api/agent/ops/reports", { token, signal },
  );
}
