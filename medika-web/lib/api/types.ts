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
  [key: string]: unknown;
}

export interface WsNewMessageEvent {
  type: "message:new";
  message: unknown;
  consultationId: string;
}

export interface WsConsultationUpdatedEvent {
  type: "consultation:updated";
  consultationId: string;
  status?: ConsultationStatus | string;
}

export interface WsNewConsultationEvent {
  type: "consultation:new";
  consultationId: string;
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
  messageIds?: number[];
}

export interface WsPresenceEvent {
  type: "presence";
  userId: string;
  isOnline: boolean;
}

export interface WsIncomingCallEvent {
  type: "call:incoming";
  from: string;
  consultationId: string;
  mediaType: "audio" | "video";
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
