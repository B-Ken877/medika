/**
 * Formatting helpers — French (Haiti) locale, mirroring the admin panel's
 * conventions in medika-admin/lib/api.js so the whole platform formats
 * statuses, currencies and dates identically.
 */
import type { Consultation, ConsultationStatus } from "./api/types";

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    RECHERCHE_MEDECIN: "En attente",
    EN_COURS: "En cours",
    TERMINE: "Terminée",
    REFUSE: "Refusée",
  };
  return map[status] ?? status;
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    RECHERCHE_MEDECIN: "badge-yellow",
    EN_COURS: "badge-blue",
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
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

/** Chat-style day separators, matching the Android ChatScreen. */
export function formatDaySeparator(ts: number | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** "À l'instant" / "Xmin" / "Xh" — matching the Android doctor dashboard. */
export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "N/A";
  const seconds = Math.floor(Date.now() / 1000 - ts);
  if (seconds < 60) return "À l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
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
  if (gender === "Femme") return "Femme";
  if (gender === "Homme") return "Homme";
  return gender ?? "—";
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
