/**
 * Formatting helpers — Haitian Creole display, mirroring the web app's
 * Kreyòl copy. Statuses/urgency raw values stay backend-owned (see
 * lib/labels.ts for the display-label contract).
 */
import type { Consultation, ConsultationStatus } from "./api/types";
import { consultationStatusLabel, genderDisplayLabel } from "./labels";

export function statusLabel(status: string): string {
  return consultationStatusLabel(status);
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    RECHERCHE_MEDECIN: "badge-yellow",
    EN_COURS: "badge-green",
    TERMINE: "badge-green",
    REFUSE: "badge-red",
  };
  return map[status] ?? "badge-gray";
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return (
    new Intl.NumberFormat("fr-HT", {
      style: "decimal",
      minimumFractionDigits: 0,
    }).format(amount) + " HTG"
  );
}

/** Backend timestamps are Unix seconds. */
export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "N/A";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateShort(ts: number | null | undefined): string {
  if (!ts) return "N/A";
  const d = new Date(ts * 1000);
  return `${String(d.getDate()).padStart(2, "0")} ${KREYOL_MONTHS_SHORT[d.getMonth()]}`;
}

/** Chat-style day separators — Haitian Creole. */
export function formatDaySeparator(ts: number | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(date, today)) return "Jodi a";
  if (sameDay(date, yesterday)) return "Yè";
  return `${date.getDate()} ${KREYOL_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Haitian Creole month names (long form). */
const KREYOL_MONTHS = [
  "janvye", "fevriye", "mas", "avril", "me", "jen",
  "jiyè", "out", "septanm", "oktòb", "novanm", "desanm",
];

/** Haitian Creole month names (short form). */
const KREYOL_MONTHS_SHORT = [
  "jan", "fev", "mas", "avr", "me", "jen",
  "jiy", "out", "sep", "okt", "nov", "des",
];

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** "Kounye a" / "X min" / "X è" / "X jou" — relative timestamps in Kreyòl. */
export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "N/A";
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 60) return "Kounye a";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} è`;
  const days = Math.floor(hours / 24);
  return `${days} jou`;
}

export function isConsultationActive(c: Consultation): boolean {
  return c.status === "EN_COURS" || c.status === "RECHERCHE_MEDECIN";
}

export function isActiveStatus(status: string): boolean {
  return status === "EN_COURS" || status === "RECHERCHE_MEDECIN";
}

export type { ConsultationStatus };

/** Build an absolute avatar URL from the backend's relative paths. */
export function avatarUrl(avatar: string | null | undefined, apiBase = ""): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("http://") || avatar.startsWith("https://")) return avatar;
  return `${apiBase}${avatar.startsWith("/") ? "" : "/"}${avatar}`;
}

/** Initials for avatar fallbacks. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function genderLabel(gender: string | null | undefined): string {
  return genderDisplayLabel(gender);
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
