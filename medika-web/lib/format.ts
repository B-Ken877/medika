/**
 * Formatting helpers — Haitian Creole display, mirroring the web app's
 * Kreyòl copy. Statuses/urgency raw values stay backend-owned (see
 * lib/labels.ts for the display-label contract).
 *
 * TIMEZONE POLICY (canonical): every chat timestamp, day separator, receipt
 * time and last-seen label is rendered in Medika's canonical IANA timezone
 * America/Port-au-Prince — never the device's local timezone, never a
 * hardcoded UTC offset (the IANA database supplies DST/historical rules).
 * Backend timestamps are Unix SECONDS; WS envelopes are milliseconds of the
 * SAME persisted instant (converted exactly once in wsEventToServerMessage).
 */
import type { Consultation, ConsultationStatus } from "./api/types";
import { consultationStatusLabel, genderDisplayLabel } from "./labels";

/** Medika's canonical display timezone (Haiti, EST year-round per IANA db). */
export const MEDIKA_TIMEZONE = "America/Port-au-Prince";

const KREYOL_MONTHS = [
  "janvye", "fevriye", "mas", "avril", "me", "jen",
  "jiyè", "out", "septanm", "oktòb", "novanm", "desanm",
];

/** Haitian Creole month names (short form). */
const KREYOL_MONTHS_SHORT = [
  "jan", "fev", "mas", "avr", "me", "jen",
  "jiy", "out", "sep", "okt", "nov", "des",
];

/** True for a usable epoch-seconds value (rejects null/0/NaN/negative). */
function isValidTs(ts: number | null | undefined): ts is number {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0;
}

// Cached formatters — Intl construction is expensive per call. The timezone
// is explicit in the options, so no accidental server/device fallback.
const TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: MEDIKA_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DATETIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: MEDIKA_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
// en-CA yields the sortable "YYYY-MM-DD" shape directly.
const DATE_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: MEDIKA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day of an epoch value in the canonical timezone ("YYYY-MM-DD"). */
export function haitiDateKey(tsMs: number): string {
  return DATE_KEY_FMT.format(tsMs);
}

function dateKeyToParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

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

/** Backend timestamps are Unix seconds; displayed in the canonical timezone. */
export function formatDateTime(ts: number | null | undefined): string {
  if (!isValidTs(ts)) return "N/A";
  return DATETIME_FMT.format(ts * 1000);
}

export function formatDateShort(ts: number | null | undefined): string {
  if (!isValidTs(ts)) return "N/A";
  const { m, d } = dateKeyToParts(haitiDateKey(ts * 1000));
  return `${String(d).padStart(2, "0")} ${KREYOL_MONTHS_SHORT[m - 1]}`;
}

/**
 * Chat-style day separators — Haitian Creole, calendar days compared in the
 * CANONICAL timezone (never the device's local getters). `now` is injectable
 * for deterministic tests; default is the current time.
 */
export function formatDaySeparator(ts: number | null | undefined, now: number = Date.now()): string {
  if (!isValidTs(ts)) return "";
  const dayKey = haitiDateKey(ts * 1000);
  const todayKey = haitiDateKey(now);
  if (dayKey === todayKey) return "Jodi a";
  // Yesterday = today's Haiti wall-clock date minus one calendar day (pure
  // calendar arithmetic on UTC-constructed parts — DST/rule safe).
  const { y, m, d } = dateKeyToParts(todayKey);
  const yst = new Date(Date.UTC(y, m - 1, d - 1));
  const yesterdayKey = `${yst.getUTCFullYear()}-${String(yst.getUTCMonth() + 1).padStart(2, "0")}-${String(yst.getUTCDate()).padStart(2, "0")}`;
  if (dayKey === yesterdayKey) return "Yè";
  const p = dateKeyToParts(dayKey);
  return `${p.d} ${KREYOL_MONTHS[p.m - 1]} ${p.y}`;
}

/** Time of day in the canonical timezone (24-hour, HH:MM). */
export function formatTime(ts: number | null | undefined): string {
  if (!isValidTs(ts)) return "";
  return TIME_FMT.format(ts * 1000);
}

/** "Kounye a" / "X min" / "X è" / "X jou" — relative timestamps in Kreyòl. */
export function relativeTime(ts: number | null | undefined): string {
  if (!isValidTs(ts)) return "N/A";
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
