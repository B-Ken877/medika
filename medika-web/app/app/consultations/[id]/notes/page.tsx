"use client";

/**
 * Doctor consultation notes — port of DoctorNoteScreen.kt.
 * GET/PUT /api/consultations/:id/notes (production endpoints; see PR notes).
 * The patient snapshot (GET /api/medical-history/:patientId/snapshot) is
 * shown alongside for context when reachable.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  getConsultation,
  getConsultationNotes,
  getMedicalHistorySnapshot,
  saveConsultationNotes,
} from "@/lib/api/endpoints";
import type { Consultation, MedicalHistorySnapshot, PrescriptionItem } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { specialtyLabel } from "@/lib/labels";
import { ErrorAlert, Spinner } from "@/components/ui/primitives";

interface NoteDraft {
  diagnosis: string;
  symptoms: string;
  notes: string;
  followUp: string;
  flagAllergy: boolean;
  prescriptions: PrescriptionItem[];
}

const EMPTY_RX: PrescriptionItem = { medication: "", dosage: "", duration: "" };

export default function DoctorNotesPage() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const { token, user } = useAuth();
  const router = useRouter();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [snapshot, setSnapshot] = useState<MedicalHistorySnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<boolean>(false);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token || !consultationId || user?.role !== "doctor") return;
    const controller = new AbortController();
    getConsultation(token, consultationId, controller.signal)
      .then((c) => {
        setConsultation(c);
        if (c?.patient_id) {
          getMedicalHistorySnapshot(token, c.patient_id, controller.signal)
            .then(setSnapshot)
            .catch(() => setSnapshotError(true));
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err);
      });
    getConsultationNotes(token, consultationId, controller.signal)
      .then((note) => {
        setDraft(
          note
            ? {
                diagnosis: note.diagnosis ?? "",
                symptoms: note.symptoms ?? "",
                notes: note.notes ?? "",
                followUp: note.follow_up ?? "",
                flagAllergy: Boolean(note.flag_allergy),
                prescriptions: Array.isArray(note.prescriptions) ? note.prescriptions : [],
              }
            : { diagnosis: "", symptoms: "", notes: "", followUp: "", flagAllergy: false, prescriptions: [] },
        );
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setDraft({ diagnosis: "", symptoms: "", notes: "", followUp: "", flagAllergy: false, prescriptions: [] });
      });
    return () => controller.abort();
  }, [token, consultationId, user?.role]);

  const setField = (patch: Partial<NoteDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const setRx = (index: number, patch: Partial<PrescriptionItem>) => {
    setDraft((d) => {
      if (!d) return d;
      const prescriptions = d.prescriptions.map((p, i) => (i === index ? { ...p, ...patch } : p));
      return { ...d, prescriptions };
    });
  };

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!token || !draft || submitting) return;
      setSubmitting(true);
      setError(null);
      setSaved(false);
      try {
        await saveConsultationNotes(token, consultationId, {
          diagnosis: draft.diagnosis.trim(),
          symptoms: draft.symptoms.trim(),
          notes: draft.notes.trim(),
          prescriptions: draft.prescriptions
            .map((p) => ({
              medication: p.medication.trim(),
              dosage: p.dosage.trim(),
              duration: p.duration.trim(),
            }))
            .filter((p) => p.medication || p.dosage || p.duration),
          followUp: draft.followUp.trim(),
          flagAllergy: draft.flagAllergy,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 4000);
      } catch (err) {
        setError(err);
      } finally {
        setSubmitting(false);
      }
    },
    [token, draft, submitting, consultationId],
  );

  if (user?.role !== "doctor") {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <ErrorAlert error={new ApiError("forbidden", 403, "Paj sa a rezève pou doktè yo.")} />
        <Link href="/app" className="btn btn-secondary btn-block">
          Retounen sou tablo travay la
        </Link>
      </div>
    );
  }

  if (!consultation || !draft) {
    return <Spinner label="N ap chaje nòt yo..." />;
  }

  return (
    <div className="stack" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="flex-between">
        <button className="btn btn-ghost btn-sm" onClick={() => router.back()}>
          <ArrowLeft size={16} aria-hidden /> Retounen
        </button>
        {saved && (
          <span className="badge badge-green" role="status">
            Nòt yo anrejistre
          </span>
        )}
      </div>

      <div>
        <h1 className="page-title">Nòt medikal</h1>
        <p className="muted small">
          Pasyan: {consultation.patient_name} · {specialtyLabel(consultation.specialty_needed)}
        </p>
      </div>

      {/* Patient medical snapshot (context) */}
      {snapshot && (
        <div className="card" aria-label="Aperçu dosisye pasyan an">
          <h2 className="section-title">Aperçu dosisye pasyan an</h2>
          {snapshot.has_allergies && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Alèji:</strong>{" "}
                {snapshot.allergies.map((a) => a.name).filter(Boolean).join(", ") || "wi"}
              </div>
            </div>
          )}
          {snapshot.chronic_conditions.length > 0 && (
            <p className="small mb-1">
              <strong>Maladi kwonik:</strong>{" "}
              {snapshot.chronic_conditions.map((c) => c.name).filter(Boolean).join(", ")}
            </p>
          )}
          {snapshot.current_medications.length > 0 && (
            <p className="small mb-1">
              <strong>Medikaman k ap pran kounye a:</strong>{" "}
              {snapshot.current_medications.map((m) => [m.name, m.dosage].filter(Boolean).join(" ")).join(", ")}
            </p>
          )}
          <p className="tiny muted">{snapshot.recent_consultations} konsiltasyon ki pase resamman</p>
        </div>
      )}
      {snapshotError && (
        <div className="alert alert-warning">
          Dosisye medikal pasyan an pa disponib pou kounye a.
        </div>
      )}

      <ErrorAlert error={error} />

      <form onSubmit={onSubmit} className="card stack">
        <div className="field">
          <label htmlFor="note-diagnosis">Dyagnostik</label>
          <input
            id="note-diagnosis"
            className="input"
            value={draft.diagnosis}
            onChange={(e) => setField({ diagnosis: e.target.value })}
            placeholder="Egzanp: Paludis senp"
            maxLength={500}
          />
        </div>
        <div className="field">
          <label htmlFor="note-symptoms">Sa pasyan an ap santi</label>
          <input
            id="note-symptoms"
            className="input"
            value={draft.symptoms}
            onChange={(e) => setField({ symptoms: e.target.value })}
            placeholder="Egzanp: Lafyèv, tèt fè mal, frison"
            maxLength={500}
          />
        </div>
        <div className="field">
          <label htmlFor="note-notes">Nòt klinik</label>
          <textarea
            id="note-notes"
            className="textarea"
            value={draft.notes}
            onChange={(e) => setField({ notes: e.target.value })}
            placeholder="Obsèvasyon, egzamen fizik, sa yo dwe fè..."
            maxLength={4000}
          />
        </div>

        <fieldset style={{ border: "none" }}>
          <legend style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray-700)", marginBottom: 6 }}>
            Òrdònans
          </legend>
          <div className="stack">
            {draft.prescriptions.map((rx, i) => (
              <div key={i} className="grid-2" style={{ position: "relative", gap: 8 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input
                    className="input"
                    value={rx.medication}
                    onChange={(e) => setRx(i, { medication: e.target.value })}
                    placeholder="Medikaman"
                    aria-label={`Medikaman ${i + 1}`}
                    maxLength={200}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input
                    className="input"
                    value={rx.dosage}
                    onChange={(e) => setRx(i, { dosage: e.target.value })}
                    placeholder="Dòz (egzanp: 500 mg)"
                    aria-label={`Dòz ${i + 1}`}
                    maxLength={200}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <input
                    className="input"
                    value={rx.duration}
                    onChange={(e) => setRx(i, { duration: e.target.value })}
                    placeholder="Dire (egzanp: 5 jou)"
                    aria-label={`Dire ${i + 1}`}
                    maxLength={200}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() =>
                      setField({ prescriptions: draft.prescriptions.filter((_, j) => j !== i) })
                    }
                    aria-label={`Retire òrdònans ${i + 1}`}
                  >
                    <Trash2 size={14} aria-hidden /> Retire
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setField({ prescriptions: [...draft.prescriptions, { ...EMPTY_RX }] })}
            >
              <Plus size={14} aria-hidden /> Ajoute yon òrdònans
            </button>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="note-followup">Swivan ki rekomande</label>
          <input
            id="note-followup"
            className="input"
            value={draft.followUp}
            onChange={(e) => setField({ followUp: e.target.value })}
            placeholder="Egzanp: Kontwòl nan 7 jou"
            maxLength={300}
          />
        </div>

        <label className="flex" style={{ gap: 8, alignItems: "center", fontWeight: 600, fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={draft.flagAllergy}
            onChange={(e) => setField({ flagAllergy: e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          Siyale yon alèji ki te detekte pandan konsiltasyon sa a
        </label>

        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spin" aria-hidden /> N ap anrejistre...
            </>
          ) : (
            <>
              <Save size={16} aria-hidden /> Anrejistre nòt yo
            </>
          )}
        </button>
        <p className="tiny muted">
          Òrdònans ki anrejistre yo ale otomatikman nan dosisye medikal pasyan an.
        </p>
      </form>
    </div>
  );
}
