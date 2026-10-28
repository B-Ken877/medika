/**
 * Consult-flow draft (issue #40) — shared by the consult page and the doctor
 * profile page.
 *
 * When the patient leaves the consult flow to view a doctor's FULL profile
 * (doctor selection now opens the profile immediately), the intake they
 * already typed is preserved in sessionStorage and restored on return, so no
 * step is repeated. sessionStorage (per tab): survives navigation/back, is
 * never persisted server-side, and contains only what the patient typed into
 * the intake form themselves.
 */

const DRAFT_KEY = "medika_consult_draft";
const DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

export interface ConsultDraft {
  symptoms: string;
  urgency: string;
  specialty: string;
  savedAt: number;
}

export function saveConsultDraft(draft: ConsultDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* private mode / quota — the flow simply starts fresh */
  }
}

/** The draft, or null when absent/stale/malformed. */
export function readConsultDraft(): ConsultDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsultDraft;
    if (!parsed || typeof parsed.symptoms !== "string") return null;
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearConsultDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the patient arrived from the consult flow with a live draft. */
export function hasConsultDraft(): boolean {
  return readConsultDraft() !== null;
}
