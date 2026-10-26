/**
 * Haitian Creole display labels for backend-driven values.
 *
 * DATA-INTEGRITY CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 * The backend (see specialties.json, db/migrations/001_init.sql and
 * src/routes/consultations.js) stores French-derived raw values such as
 * "Cardiologie" (specialty), "Moyenne" (urgency) or "EN_COURS" (status).
 * Those raw values are equality-compared for filtering, price lookup and
 * API payloads, so they must NEVER be translated in place.
 *
 * These helpers translate a raw value to its Haitian Creole DISPLAY label
 * only. Unknown values fall back to the original value — we never invent a
 * medical specialty, an urgency level or a status.
 */

/** Raw specialty values come from GET /api/specialties/prices and user.specialty. */
const SPECIALTY_LABELS: Record<string, string> = {
  "Medecine Generale": "Medsin Jeneral",
  Cardiologie: "Kadyoloji",
  Dermatologie: "Dermatoloji",
  Endocrinologie: "Endokrinoloji",
  "Gastro-enterologie": "Gastroanteroloji",
  Gynecologie: "Jinekoloji",
  Neurologie: "Nyoroloji",
  Ophtalmologie: "Oftalmoloji",
  ORL: "ORL (zòrèy, ne, gòj)",
  Pediatrie: "Pedyatri",
  Psychiatrie: "Psikiatri",
  Pneumologie: "Pnémonoloji",
  Orthopedie: "Ortopedi",
  Odontologie: "Odontoloji",
  Nutrition: "Nitrisyon",
  "Medecine Interne": "Medsin Entèn",
};

/** Internal urgency values sent as `urgencyLevel` (DB default: "Moyenne"). */
const URGENCY_LABELS: Record<string, string> = {
  Faible: "Ba",
  Moyenne: "Modere",
  Haute: "Wo",
  Critique: "Kritik",
};

/** Backend consultation statuses (DB CHECK constraint). */
const STATUS_LABELS: Record<string, string> = {
  RECHERCHE_MEDECIN: "An atant",
  EN_COURS: "Ap dewoule",
  TERMINE: "Fini",
  REFUSE: "Refize",
};

/** Gender values stored by the backend (free TEXT, default "Homme"). */
const GENDER_LABELS: Record<string, string> = {
  Homme: "Gason",
  Femme: "Fi",
};

/** Display label for a raw specialty value (falls back to the raw value). */
export function specialtyLabel(name: string | null | undefined): string {
  if (!name) return "";
  return SPECIALTY_LABELS[name] ?? name;
}

/** Display label for an internal urgency value (falls back to the raw value). */
export function urgencyLabel(value: string | null | undefined): string {
  if (!value) return "";
  return URGENCY_LABELS[value] ?? value;
}

/** Display label for a backend consultation status (falls back to the raw value). */
export function consultationStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS_LABELS[status] ?? status;
}

/** Display label for a stored gender value (falls back to the raw value). */
export function genderDisplayLabel(gender: string | null | undefined): string {
  if (!gender) return "—";
  return GENDER_LABELS[gender] ?? gender;
}

/**
 * Case/diacritic-insensitive query matching used by the specialty picker.
 * Matches against BOTH the Kreyòl display label and the raw backend value,
 * so users can find "Pediatrie" by typing "pedyatri" or "pediatrie".
 */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Filter specialty options for a search query (empty query → all options). */
export function filterSpecialtyOptions<T extends { value: string; label: string }>(
  options: T[],
  query: string,
): T[] {
  const q = normalizeQuery(query);
  if (!q) return options;
  return options.filter(
    (o) => normalizeQuery(o.label).includes(q) || normalizeQuery(o.value).includes(q),
  );
}
