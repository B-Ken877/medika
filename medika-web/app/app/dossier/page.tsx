"use client";

/**
 * Patient medical record ("Mon dossier médical") — port of MedicalHistoryScreen.kt.
 * GET /api/medical-history/:patientId (production endpoint — see PR notes).
 * Read-only view; the patient can update allergies / chronic conditions /
 * medications through the same endpoint (PUT) via the edit modal.
 * No persistence/caching: data is fetched live on every visit.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  HeartPulse,
  History,
  Pill,
  Plus,
  Shield,
  Syringe,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { getMedicalHistory, updateMedicalHistory } from "@/lib/api/endpoints";
import type { AllergyItem, ChronicConditionItem, MedicationItem, MedicalHistory } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { EmptyState, ErrorAlert, Spinner } from "@/components/ui/primitives";

export default function DossierPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [history, setHistory] = useState<MedicalHistory | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<null | "allergies" | "conditions" | "medications">(null);
  const [draftAllergies, setDraftAllergies] = useState<AllergyItem[]>([]);
  const [draftConditions, setDraftConditions] = useState<ChronicConditionItem[]>([]);
  const [draftMedications, setDraftMedications] = useState<MedicationItem[]>([]);
  const [saving, setSaving] = useState(false);

  const isDoctor = user?.role === "doctor";

  const load = useCallback(() => {
    if (!token || !user) return;
    const controller = new AbortController();
    getMedicalHistory(token, user.id, controller.signal)
      .then((h) => {
        setHistory(h);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [token, user]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  const openEditor = (section: "allergies" | "conditions" | "medications") => {
    if (!history) return;
    setDraftAllergies(history.allergies ?? []);
    setDraftConditions(history.chronic_conditions ?? []);
    setDraftMedications(history.current_medications ?? []);
    setEditing(section);
  };

  const saveEditor = async () => {
    if (!token || !user || saving) return;
    setSaving(true);
    try {
      const updated = await updateMedicalHistory(token, user.id, {
        allergies: draftAllergies,
        chronicConditions: draftConditions,
        currentMedications: draftMedications,
      });
      setHistory(updated);
      setEditing(null);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  if (isDoctor) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <ErrorAlert error={new ApiError("forbidden", 403, "Le dossier médical est réservé au patient concerné.")} />
        <Link href="/app" className="btn btn-secondary btn-block">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  if (!loaded) return <Spinner label="Chargement de votre dossier…" />;

  if (error && !history) {
    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/app")}>
          <ArrowLeft size={16} aria-hidden /> Retour
        </button>
        <ErrorAlert error={error} onRetry={load} />
      </div>
    );
  }

  const allergies = history?.allergies ?? [];
  const conditions = history?.chronic_conditions ?? [];
  const medications = history?.current_medications ?? [];
  const vaccinations = history?.vaccinations ?? [];
  const timeline = history?.consultation_timeline ?? [];
  const emergency = history?.emergency_contact;

  return (
    <div className="stack" style={{ maxWidth: 760, margin: "0 auto" }}>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/app")}>
        <ArrowLeft size={16} aria-hidden /> Retour
      </button>

      <div>
        <h1 className="page-title">Mon dossier médical</h1>
        <p className="muted small">
          {history?.patient_name ?? user?.name}
          {history?.last_updated ? ` · Mis à jour le ${formatDateTime(history.last_updated)}` : ""}
        </p>
      </div>

      <ErrorAlert error={error} onRetry={load} />

      {allergies.length > 0 && (
        <div className="alert alert-error" role="alert">
          <AlertTriangle size={17} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Allergies signalées :</strong>{" "}
            {allergies.map((a) => [a.name, a.severity].filter(Boolean).join(" (") + (a.severity ? ")" : "")).join(", ")}
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* Basic info */}
        <section className="card" aria-label="Informations de base">
          <h2 className="section-title flex" style={{ gap: 8 }}>
            <UserRound size={17} color="var(--green-700)" aria-hidden /> Informations de base
          </h2>
          {history?.basic_info?.bloodType || history?.basic_info?.weight || history?.basic_info?.height ? (
            <div className="stack" style={{ gap: 6 }}>
              {history?.basic_info?.bloodType && (
                <p className="small">
                  <strong>Groupe sanguin :</strong> {history.basic_info.bloodType}
                </p>
              )}
              {history?.basic_info?.weight != null && (
                <p className="small">
                  <strong>Poids :</strong> {history.basic_info.weight} kg
                </p>
              )}
              {history?.basic_info?.height != null && (
                <p className="small">
                  <strong>Taille :</strong> {history.basic_info.height} cm
                </p>
              )}
            </div>
          ) : (
            <p className="muted small">Aucune information de base enregistrée.</p>
          )}
        </section>

        {/* Emergency contact */}
        <section className="card" aria-label="Contact d'urgence">
          <h2 className="section-title flex" style={{ gap: 8 }}>
            <Shield size={17} color="var(--green-700)" aria-hidden /> Contact d&apos;urgence
          </h2>
          {emergency?.name ? (
            <div className="stack" style={{ gap: 6 }}>
              <p className="small">
                <strong>{emergency.name}</strong>
                {emergency.relationship ? ` (${emergency.relationship})` : ""}
              </p>
              {emergency.phone && <p className="small muted">{emergency.phone}</p>}
            </div>
          ) : (
            <p className="muted small">Aucun contact d&apos;urgence enregistré.</p>
          )}
        </section>
      </div>

      {/* Allergies */}
      <section className="card" aria-label="Allergies">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <AlertTriangle size={17} color="var(--danger)" aria-hidden /> Allergies ({allergies.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("allergies")}>
            <Plus size={13} aria-hidden /> Gérer
          </button>
        </div>
        {allergies.length === 0 ? (
          <p className="muted small">Aucune allergie connue.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {allergies.map((a, i) => (
              <li key={i}>
                <strong>{a.name || "—"}</strong>
                {a.severity ? ` · Gravité : ${a.severity}` : ""}
                {a.reaction ? ` · Réaction : ${a.reaction}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Chronic conditions */}
      <section className="card" aria-label="Conditions chroniques">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <HeartPulse size={17} color="var(--danger)" aria-hidden /> Conditions chroniques ({conditions.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("conditions")}>
            <Plus size={13} aria-hidden /> Gérer
          </button>
        </div>
        {conditions.length === 0 ? (
          <p className="muted small">Aucune condition chronique enregistrée.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {conditions.map((c, i) => (
              <li key={i}>
                <strong>{c.name || "—"}</strong>
                {c.status ? ` · ${c.status}` : ""}
                {c.diagnosed_at ? ` · Diagnostiqué : ${c.diagnosed_at}` : ""}
                {c.source === "doctor_notes" ? " · (issue des notes du médecin)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Medications */}
      <section className="card" aria-label="Médications actuelles">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <Pill size={17} color="var(--green-700)" aria-hidden /> Médications actuelles ({medications.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("medications")}>
            <Plus size={13} aria-hidden /> Gérer
          </button>
        </div>
        {medications.length === 0 ? (
          <p className="muted small">Aucune médication en cours.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {medications.map((m, i) => (
              <li key={i}>
                <strong>{m.name || "—"}</strong>
                {m.dosage ? ` · ${m.dosage}` : ""}
                {m.since ? ` · Depuis ${m.since}` : ""}
                {m.source === "doctor_notes" ? " · (prescrite par votre médecin)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Vaccinations */}
      <section className="card" aria-label="Vaccinations">
        <h2 className="section-title flex" style={{ gap: 8 }}>
          <Syringe size={17} color="var(--info)" aria-hidden /> Vaccinations ({vaccinations.length})
        </h2>
        {vaccinations.length === 0 ? (
          <p className="muted small">Aucune vaccination enregistrée.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {vaccinations.map((v, i) => (
              <li key={i}>
                <strong>{v.name || "—"}</strong>
                {v.date ? ` · ${v.date}` : ""}
                {v.doseNumber != null ? ` · Dose n° ${v.doseNumber}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Consultation timeline */}
      <section className="card" aria-label="Historique des consultations">
        <h2 className="section-title flex" style={{ gap: 8 }}>
          <History size={17} color="var(--green-700)" aria-hidden /> Historique des consultations
        </h2>
        {timeline.length === 0 ? (
          <EmptyState
            icon={<Activity size={24} />}
            title="Aucun historique"
            description="Votre historique se remplira automatiquement après vos consultations."
          />
        ) : (
          <ol className="stack" style={{ listStyle: "none" }}>
            {timeline.map((t, i) => (
              <li key={i} className="card" style={{ padding: 12, boxShadow: "none" }}>
                <div className="flex-between">
                  <strong className="small">{t.doctor_name || "Médecin"}</strong>
                  <span className="tiny muted">{t.date ?? ""}</span>
                </div>
                <p className="small muted" style={{ marginTop: 2 }}>
                  {t.specialty}
                  {t.diagnosis ? ` · ${t.diagnosis}` : ""}
                </p>
                {t.summary && <p className="small" style={{ marginTop: 4 }}>{t.summary}</p>}
                {t.prescriptions.length > 0 && (
                  <p className="tiny muted mt-1">Prescriptions : {t.prescriptions.join(", ")}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Editor modal */}
      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2 className="modal-title">
              {editing === "allergies" ? "Allergies" : editing === "conditions" ? "Conditions chroniques" : "Médications"}
            </h2>
            <p className="modal-body">
              Ajoutez ou retirez des entrées. Les entrées issues des notes de vos médecins sont marquées
              « prescrite par votre médecin ».
            </p>

            <div className="stack">
              {editing === "allergies" &&
                draftAllergies.map((a, i) => (
                  <EditableRow key={i}>
                    <input
                      className="input"
                      value={a.name}
                      onChange={(e) =>
                        setDraftAllergies(draftAllergies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                      placeholder="Allergène (ex : Pénicilline)"
                      aria-label={`Allergène ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={a.severity}
                      onChange={(e) =>
                        setDraftAllergies(draftAllergies.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))
                      }
                      placeholder="Gravité (ex : sévère)"
                      aria-label={`Gravité ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={a.reaction}
                      onChange={(e) =>
                        setDraftAllergies(draftAllergies.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)))
                      }
                      placeholder="Réaction (ex : urticaire)"
                      aria-label={`Réaction ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftAllergies(draftAllergies.filter((_, j) => j !== i))} label={`Retirer l'allergie ${i + 1}`} />
                  </EditableRow>
                ))}
              {editing === "allergies" && (
                <AddBtn
                  onAdd={() =>
                    setDraftAllergies([...draftAllergies, { name: "", severity: "", reaction: "", notedAt: null }])
                  }
                  label="Ajouter une allergie"
                />
              )}

              {editing === "conditions" &&
                draftConditions.map((c, i) => (
                  <EditableRow key={i}>
                    <input
                      className="input"
                      value={c.name}
                      onChange={(e) =>
                        setDraftConditions(draftConditions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                      placeholder="Condition (ex : Hypertension)"
                      aria-label={`Condition ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={c.status}
                      onChange={(e) =>
                        setDraftConditions(draftConditions.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))
                      }
                      placeholder="Statut (ex : contrôlée)"
                      aria-label={`Statut ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftConditions(draftConditions.filter((_, j) => j !== i))} label={`Retirer la condition ${i + 1}`} />
                  </EditableRow>
                ))}
              {editing === "conditions" && (
                <AddBtn
                  onAdd={() =>
                    setDraftConditions([
                      ...draftConditions,
                      { name: "", status: "", notes: "", diagnosed_at: null, source: "patient" },
                    ])
                  }
                  label="Ajouter une condition"
                />
              )}

              {editing === "medications" &&
                draftMedications.map((m, i) => (
                  <EditableRow key={i}>
                    <input
                      className="input"
                      value={m.name}
                      onChange={(e) =>
                        setDraftMedications(draftMedications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                      placeholder="Médicament (ex : Paracétamol)"
                      aria-label={`Médicament ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={m.dosage}
                      onChange={(e) =>
                        setDraftMedications(draftMedications.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))
                      }
                      placeholder="Dosage (ex : 500 mg)"
                      aria-label={`Dosage ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftMedications(draftMedications.filter((_, j) => j !== i))} label={`Retirer la médication ${i + 1}`} />
                  </EditableRow>
                ))}
              {editing === "medications" && (
                <AddBtn
                  onAdd={() =>
                    setDraftMedications([
                      ...draftMedications,
                      { name: "", dosage: "", since: null, prescribed_by: null, source: "patient" },
                    ])
                  }
                  label="Ajouter une médication"
                />
              )}
            </div>

            <div className="modal-actions mt-2">
              <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={saveEditor} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditableRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 8, padding: 12, border: "1px solid var(--gray-200)", borderRadius: 10 }}>
      {children}
    </div>
  );
}

function AddBtn({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={onAdd}>
      <Plus size={14} aria-hidden /> {label}
    </button>
  );
}

function RemoveBtn({ onRemove, label }: { onRemove: () => void; label: string }) {
  return (
    <button type="button" className="btn btn-outline-danger btn-sm" style={{ alignSelf: "flex-start" }} onClick={onRemove} aria-label={label}>
      <Trash2 size={13} aria-hidden /> Retirer
    </button>
  );
}
