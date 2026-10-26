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
import { specialtyLabel } from "@/lib/labels";
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
        <ErrorAlert error={new ApiError("forbidden", 403, "Dosisye medikal la rezève pou pasyan ki enpe yo.")} />
        <Link href="/app" className="btn btn-secondary btn-block">
          Retounen sou tablo travay la
        </Link>
      </div>
    );
  }

  if (!loaded) return <Spinner label="N ap chaje dosisye ou a..." />;

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
        <h1 className="page-title">Dosisye medikal mwen</h1>
        <p className="muted small">
          {history?.patient_name ?? user?.name}
          {history?.last_updated ? ` · Mete ajou ${formatDateTime(history.last_updated)}` : ""}
        </p>
      </div>

      <ErrorAlert error={error} onRetry={load} />

      {allergies.length > 0 && (
        <div className="alert alert-error" role="alert">
          <AlertTriangle size={17} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Alèji siyale:</strong>{" "}
            {allergies.map((a) => [a.name, a.severity].filter(Boolean).join(" (") + (a.severity ? ")" : "")).join(", ")}
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* Basic info */}
        <section className="card" aria-label="Enfòmasyon de baz">
          <h2 className="section-title flex" style={{ gap: 8 }}>
            <UserRound size={17} color="var(--green-700)" aria-hidden /> Enfòmasyon de baz
          </h2>
          {history?.basic_info?.bloodType || history?.basic_info?.weight || history?.basic_info?.height ? (
            <div className="stack" style={{ gap: 6 }}>
              {history?.basic_info?.bloodType && (
                <p className="small">
                  <strong>Gwoup san:</strong> {history.basic_info.bloodType}
                </p>
              )}
              {history?.basic_info?.weight != null && (
                <p className="small">
                  <strong>Pwa:</strong> {history.basic_info.weight} kg
                </p>
              )}
              {history?.basic_info?.height != null && (
                <p className="small">
                  <strong>Wotè:</strong> {history.basic_info.height} cm
                </p>
              )}
            </div>
          ) : (
            <p className="muted small">Pa gen enfòmasyon de baz ki anrejistre.</p>
          )}
        </section>

        {/* Emergency contact */}
        <section className="card" aria-label="Kontakt ijans">
          <h2 className="section-title flex" style={{ gap: 8 }}>
            <Shield size={17} color="var(--green-700)" aria-hidden /> Kontakt ijans
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
            <p className="muted small">Pa gen kontakt ijans ki anrejistre.</p>
          )}
        </section>
      </div>

      {/* Allergies */}
      <section className="card" aria-label="Alèji">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <AlertTriangle size={17} color="var(--danger)" aria-hidden /> Alèji ({allergies.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("allergies")}>
            <Plus size={13} aria-hidden /> Jere
          </button>
        </div>
        {allergies.length === 0 ? (
          <p className="muted small">Pa gen alèji ki konnen.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {allergies.map((a, i) => (
              <li key={i}>
                <strong>{a.name || "—"}</strong>
                {a.severity ? ` · Degre: ${a.severity}` : ""}
                {a.reaction ? ` · Reaksyon: ${a.reaction}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Chronic conditions */}
      <section className="card" aria-label="Maladi kwonik">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <HeartPulse size={17} color="var(--danger)" aria-hidden /> Maladi kwonik ({conditions.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("conditions")}>
            <Plus size={13} aria-hidden /> Jere
          </button>
        </div>
        {conditions.length === 0 ? (
          <p className="muted small">Pa gen maladi kwonik ki anrejistre.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {conditions.map((c, i) => (
              <li key={i}>
                <strong>{c.name || "—"}</strong>
                {c.status ? ` · ${c.status}` : ""}
                {c.diagnosed_at ? ` · Dyagnostike: ${c.diagnosed_at}` : ""}
                {c.source === "doctor_notes" ? " · (ki soti nan nòt doktè a)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Medications */}
      <section className="card" aria-label="Medikaman k ap pran kounye a">
        <div className="flex-between mb-1">
          <h2 className="section-title flex" style={{ gap: 8, marginBottom: 0 }}>
            <Pill size={17} color="var(--green-700)" aria-hidden /> Medikaman k ap pran kounye a ({medications.length})
          </h2>
          <button className="btn btn-secondary btn-sm" onClick={() => openEditor("medications")}>
            <Plus size={13} aria-hidden /> Jere
          </button>
        </div>
        {medications.length === 0 ? (
          <p className="muted small">Pa gen medikaman k ap pran kounye a.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {medications.map((m, i) => (
              <li key={i}>
                <strong>{m.name || "—"}</strong>
                {m.dosage ? ` · ${m.dosage}` : ""}
                {m.since ? ` · Depi ${m.since}` : ""}
                {m.source === "doctor_notes" ? " · (doktè w la preskri l)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Vaccinations */}
      <section className="card" aria-label="Vaksen">
        <h2 className="section-title flex" style={{ gap: 8 }}>
          <Syringe size={17} color="var(--info)" aria-hidden /> Vaksen ({vaccinations.length})
        </h2>
        {vaccinations.length === 0 ? (
          <p className="muted small">Pa gen vaksen ki anrejistre.</p>
        ) : (
          <ul className="stack small" style={{ listStyle: "none", gap: 6 }}>
            {vaccinations.map((v, i) => (
              <li key={i}>
                <strong>{v.name || "—"}</strong>
                {v.date ? ` · ${v.date}` : ""}
                {v.doseNumber != null ? ` · Dòz nimewo ${v.doseNumber}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Consultation timeline */}
      <section className="card" aria-label="Istwa konsiltasyon yo">
        <h2 className="section-title flex" style={{ gap: 8 }}>
          <History size={17} color="var(--green-700)" aria-hidden /> Istwa konsiltasyon
        </h2>
        {timeline.length === 0 ? (
          <EmptyState
            icon={<Activity size={24} />}
            title="Pa gen istwa"
            description="Istwa ou a ap ranpli otomatikman apre konsiltasyon ou yo."
          />
        ) : (
          <ol className="stack" style={{ listStyle: "none" }}>
            {timeline.map((t, i) => (
              <li key={i} className="card" style={{ padding: 12, boxShadow: "none" }}>
                <div className="flex-between">
                  <strong className="small">{t.doctor_name || "Doktè"}</strong>
                  <span className="tiny muted">{t.date ?? ""}</span>
                </div>
                <p className="small muted" style={{ marginTop: 2 }}>
                  {specialtyLabel(t.specialty)}
                  {t.diagnosis ? ` · ${t.diagnosis}` : ""}
                </p>
                {t.summary && <p className="small" style={{ marginTop: 4 }}>{t.summary}</p>}
                {t.prescriptions.length > 0 && (
                  <p className="tiny muted mt-1">Òrdònans: {t.prescriptions.join(", ")}</p>
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
              {editing === "allergies" ? "Alèji" : editing === "conditions" ? "Maladi kwonik" : "Medikaman"}
            </h2>
            <p className="modal-body">
              Ajoute oswa retire antre yo. Antre ki soti nan nòt doktè ou yo make “doktè w la preskri l”.
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
                      placeholder="Sa w alèjik ak li (egzanp: Penisilin)"
                      aria-label={`Sa w alèjik ak li ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={a.severity}
                      onChange={(e) =>
                        setDraftAllergies(draftAllergies.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))
                      }
                      placeholder="Degre (egzanp: grav)"
                      aria-label={`Degre ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={a.reaction}
                      onChange={(e) =>
                        setDraftAllergies(draftAllergies.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)))
                      }
                      placeholder="Reaksyon (egzanp: blotè sou po)"
                      aria-label={`Reaksyon ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftAllergies(draftAllergies.filter((_, j) => j !== i))} label={`Retire alèji ${i + 1}`} />
                  </EditableRow>
                ))}
              {editing === "allergies" && (
                <AddBtn
                  onAdd={() =>
                    setDraftAllergies([...draftAllergies, { name: "", severity: "", reaction: "", notedAt: null }])
                  }
                  label="Ajoute yon alèji"
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
                      placeholder="Maladi (egzanp: Tansyon wo)"
                      aria-label={`Maladi ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={c.status}
                      onChange={(e) =>
                        setDraftConditions(draftConditions.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))
                      }
                      placeholder="Estati (egzanp: kontwole)"
                      aria-label={`Estati ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftConditions(draftConditions.filter((_, j) => j !== i))} label={`Retire maladi a ${i + 1}`} />
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
                  label="Ajoute yon maladi"
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
                      placeholder="Medikaman (egzanp: Parasetamol)"
                      aria-label={`Medikaman ${i + 1}`}
                    />
                    <input
                      className="input"
                      value={m.dosage}
                      onChange={(e) =>
                        setDraftMedications(draftMedications.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))
                      }
                      placeholder="Dòz (egzanp: 500 mg)"
                      aria-label={`Dòz ${i + 1}`}
                    />
                    <RemoveBtn onRemove={() => setDraftMedications(draftMedications.filter((_, j) => j !== i))} label={`Retire medikaman an ${i + 1}`} />
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
                  label="Ajoute yon medikaman"
                />
              )}
            </div>

            <div className="modal-actions mt-2">
              <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
                Anile
              </button>
              <button className="btn btn-primary" onClick={saveEditor} disabled={saving}>
                {saving ? "N ap anrejistre..." : "Anrejistre"}
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
      <Trash2 size={13} aria-hidden /> Retire
    </button>
  );
}
