/**
 * Medika API data models.
 *
 * These mirror the backend JSON shapes exactly (see server.js and the
 * Android client `app/src/main/java/com/example/data/api/GeminiApi.kt`).
 * Field names use the backend's snake_case for responses and the Android
 * client's camelCase for request bodies where the Android client already
 * established that convention (e.g. CreateConsultationRequest).
 */

export type Role = "patient" | "doctor" | "admin";

export type ConsultationStatus =
  | "RECHERCHE_MEDECIN"
  | "EN_COURS"
  | "REFUSE"
  | "TERMINE"
  | "EXPIRE";

export type UrgencyLevel = "Faible" | "Moyenne" | "Haute" | "Critique";

export interface User {
  id: string;
  username: string;
  role: Role;
  name: string;
  email?: string | null;
  phone?: string | null;
  age?: number | string | null;
  gender?: string | null;
  /** Doctor-only fields */
  specialty?: string | null;
  license_number?: string | null;
  location?: string | null;
  hospital?: string | null;
  biography?: string | null;
  avatar_url?: string | null;
  rating?: number | null;
  is_available?: number;
  /** Server-owned doctor credential status; null/absent is NOT verified. */
  verification_status?: "pending" | "verified" | "rejected" | null;
  verified_at?: number | null;
}

export interface AuthResponse {
  /** NOTE: in the current backend the token is the user id. */
  token: string;
  user: User;
}

export interface Consultation {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_age?: number | string | null;
  doctor_id?: string | null;
  description: string;
  specialty_needed: string;
  urgency_level: UrgencyLevel | string;
  ai_summary: string;
  ai_explanation: string;
  status: ConsultationStatus | string;
  prescription?: string | null;
  created_at: number;
  updated_at: number;
  /** Optional MonCash metadata (accepted by the backend, not required). */
  transactionId?: string | null;
  paymentAmount?: number | null;
  orderId?: string | null;
  /** Issue #25 lifecycle deadlines (server-persisted epoch seconds). */
  offer_deadline?: number | null;
  accepted_at?: number | null;
  expires_at?: number | null;
  /** Issue #60: why a consultation left the active set without a normal
   * completion — 'duplicate_open_consultation' (legacy reconciliation) or
   * 'pending_timeout' (bounded unanswered-request expiry). Absent/null for
   * normal transitions. */
  close_reason?: string | null;
}

// ─── Doctor wallet (issue #24) ─────────────────────────────────────────────

/** One payout cycle window (backend computes dates in America/Port-au-Prince). */
export interface PayoutCycleInfo {
  startDate: string;
  endDate: string;
  label: string;
  labelLong?: string;
  due?: boolean;
}

export interface WalletEarning {
  id: number;
  consultation_id: string | null;
  gross_amount: number;
  platform_fee: number;
  net_amount: number;
  status: "AVAILABLE" | "PAID";
  available_at: number | null;
  payout_id: number | null;
  patient_name?: string | null;
  specialty?: string | null;
}

export interface WalletPayout {
  id: number;
  doctor_name: string;
  cycle_start: string;
  cycle_end: string;
  amount: number;
  earning_count: number;
  status: string;
  moncash_reference: string | null;
  paid_at: number | null;
  paid_by_admin_name: string;
}

export interface UnpaidCycle extends PayoutCycleInfo {
  amount: number;
  count: number;
  due: boolean;
}

export interface DoctorWallet {
  currency: string;
  available: { amount: number; count: number };
  pendingPayment: { amount: number; count: number };
  paidOut: { amount: number; count: number };
  currentCycle: PayoutCycleInfo;
  unpaidCycles: UnpaidCycle[];
  earnings: WalletEarning[];
  payouts: WalletPayout[];
}

export type MessageType = "text" | "voice" | "image" | "video" | "file";

export interface ServerMessage {
  id: number;
  consultation_id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at?: number | null;
  message_type?: MessageType | string | null;
  file_url?: string | null;
  duration?: number | null;
  file_size?: number | null;
  /** Persisted read receipt (epoch seconds, NULL = unread). */
  read_at?: number | null;
  /** Client correlation id (migration 003) — present when the sender supplied
   *  one; lets retries reconcile to the canonical persisted row. */
  client_msg_id?: string | null;
}

/** Result of POST /api/consultations/:id/read — persisted receipt state. */
export interface ReadReceiptResult {
  consultationId: string;
  readerId: string;
  messageIds: number[];
  readAt: number | null;
}

/** POST /api/consultations/:id/attachments response — opaque private media. */
export interface AttachmentUploadResponse {
  attachmentId: string;
  /** Opaque API path to reference from the message's file_url. */
  url: string;
  filename: string;
  mimetype: string;
  size: number;
}

/** GET /api/consultations/:id/attachments/:aid/url — short-lived grant. */
export interface AttachmentUrlResponse {
  url: string;
  expiresIn: number;
  filename: string;
  mimetype: string;
  size: number;
}

export interface SpecialtyPrice {
  id: string;
  name: string;
  price: number;
}

export interface CallTokenResponse {
  token: string;
  url: string;
  roomName: string;
  participantIdentity: string;
  /** ZEGOCLOUD is the sole call provider; the backend mints every token. */
  provider: "zego";
  /** Public engine endpoint from the ZEGO console. */
  appId: number;
  /** The single stream this token is allowed to publish. */
  streamId: string;
  /** Token validity in seconds (drives the renew schedule). */
  tokenTtlSeconds: number;
}

export interface UploadResponse {
  url: string;
  filename: string;
  mimetype: string;
  size: number;
}

// ─── Medical history & consultation notes ────────────────────────────────────
// NOTE: these endpoints are called by the production Android app but are not
// present in the repo's server.js (backend/production drift). Models mirror
// the Android data classes exactly.

export interface PrescriptionItem {
  medication: string;
  dosage: string;
  duration: string;
}

export interface ConsultationNote {
  consultation_id: string;
  patient_id: string;
  doctor_id: string;
  doctor_name?: string | null;
  diagnosis: string;
  symptoms: string;
  notes: string;
  prescriptions: PrescriptionItem[];
  follow_up: string;
  flag_allergy: boolean;
  created_at?: number | null;
  updated_at?: number | null;
}

export interface SaveConsultationNoteRequest {
  diagnosis: string;
  symptoms: string;
  notes: string;
  prescriptions: PrescriptionItem[];
  followUp: string;
  flagAllergy: boolean;
}

export interface AllergyItem {
  name: string;
  severity: string;
  reaction: string;
  notedAt?: string | null;
}

export interface ChronicConditionItem {
  name: string;
  diagnosed_at?: string | null;
  status: string;
  notes: string;
  source?: string | null;
}

export interface MedicationItem {
  name: string;
  dosage: string;
  since?: string | null;
  prescribed_by?: string | null;
  source?: string | null;
}

export interface VaccinationItem {
  name: string;
  date?: string | null;
  doseNumber?: number | null;
}

export interface EmergencyContactItem {
  name: string;
  relationship: string;
  phone: string;
}

export interface SurgicalHistoryItem {
  procedure: string;
  date?: string | null;
  hospital: string;
}

export interface ConsultationTimelineItem {
  consultation_id: string;
  date?: string | null;
  doctor_name: string;
  specialty: string;
  diagnosis: string;
  summary: string;
  prescriptions: string[];
}

export interface BasicInfo {
  bloodType?: string | null;
  weight?: number | null;
  height?: number | null;
}

export interface MedicalHistory {
  patient_id: string;
  patient_name?: string | null;
  created_at?: number | null;
  last_updated?: number | null;
  basic_info?: BasicInfo | null;
  allergies: AllergyItem[];
  chronic_conditions: ChronicConditionItem[];
  current_medications: MedicationItem[];
  vaccinations: VaccinationItem[];
  emergency_contact?: EmergencyContactItem | null;
  surgical_history: SurgicalHistoryItem[];
  consultation_timeline: ConsultationTimelineItem[];
}

export interface MedicalHistorySnapshot {
  patient_id: string;
  patient_name?: string | null;
  has_allergies: boolean;
  allergies: AllergyItem[];
  chronic_conditions: ChronicConditionItem[];
  current_medications: MedicationItem[];
  recent_consultations: number;
}

export interface UpdateMedicalHistoryRequest {
  basicInfo?: BasicInfo;
  allergies?: AllergyItem[];
  chronicConditions?: ChronicConditionItem[];
  currentMedications?: MedicationItem[];
  vaccinations?: VaccinationItem[];
  emergencyContact?: EmergencyContactItem;
  surgicalHistory?: SurgicalHistoryItem[];
}

// ─── Support tickets ─────────────────────────────────────────────────────────

export interface Ticket {
  id: string | number;
  subject?: string;
  title?: string;
  status?: string;
  priority?: string;
  created_at?: number | string;
  updated_at?: number | string;
  last_message?: string | Record<string, unknown>;
  [key: string]: unknown;
}

export interface TicketMessage {
  id: string | number;
  sender_id?: string;
  sender_name?: string;
  sender_role?: string;
  text?: string;
  message?: string;
  created_at?: number | string;
  file_url?: string | null;
  [key: string]: unknown;
}

// ─── WebSocket events (server → client) ──────────────────────────────────────

export interface WsNewMessageEvent {
  type: "message:new";
  id: number;
  consultationId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  messageType: MessageType | string;
  fileUrl?: string | null;
  duration?: number | null;
  fileSize?: number | null;
  /** Additive correlation id echoed back to the sending client. */
  clientMsgId?: string;
}

export interface WsConsultationUpdatedEvent {
  type: "consultation:updated";
  id: string;
  status: ConsultationStatus | string;
  doctor_id?: string | null;
  [key: string]: unknown;
}

export interface WsNewConsultationEvent {
  type: "consultation:new";
  id: string;
  patientName: string;
  description: string;
  specialtyNeeded: string;
  urgencyLevel: string;
}

export interface WsTypingEvent {
  type: "typing";
  consultationId: string;
  senderId: string;
  isTyping: boolean;
}

/** Voice-recording ACTIVITY (issue #26) — ephemeral, never persisted, minimal
 *  payload (activity boolean only: no audio/waveform/duration/filenames). */
export interface WsRecordingEvent {
  type: "recording";
  consultationId: string;
  senderId: string;
  isRecording: boolean;
}

/** Compact read-receipt event (one per mark-read request, not per message). */
export interface WsMessagesReadEvent {
  type: "messages:read";
  consultationId: string;
  readerId: string;
  messageIds: number[];
  /** Epoch seconds — the persisted read instant. */
  readAt: number;
}

/** Participant presence (consultation-scoped delivery only). */
export interface WsPresenceEvent {
  type: "presence:update";
  userId: string;
  online: boolean;
}

export interface WsIncomingCallEvent {
  type: "call:incoming";
  from: string;
  fromName: string;
  consultationId: string;
  callType: "voice" | "video";
  roomName: string;
  timestamp: number;
}

export interface WsCallResponseEvent {
  type: "call:accepted" | "call:rejected" | "call:ended";
  from: string;
  consultationId: string;
  timestamp: number;
}

export type WsServerEvent =
  | WsNewMessageEvent
  | WsConsultationUpdatedEvent
  | WsNewConsultationEvent
  | WsTypingEvent
  | WsRecordingEvent
  | WsMessagesReadEvent
  | WsPresenceEvent
  | WsIncomingCallEvent
  | WsCallResponseEvent
  | { type: string; [key: string]: unknown };
