"use client";

/**
 * Doctor-only modal to write the prescription and close the consultation
 * (PUT /api/consultations/:id/prescription — doctor only, per server.js).
 */
import { useState, type FormEvent } from "react";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { writePrescription } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

export function PrescriptionModal({
  consultation,
  onClose,
  onSaved,
}: {
  consultation: Consultation;
  onClose: () => void;
  onSaved: (c: Consultation) => void;
}) {
  const { token } = useAuth();
  const [text, setText] = useState(consultation.prescription ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return; // anti double-submit
    const value = text.trim();
    if (!value) {
      setError(new ApiError("validation", 0, "L'ordonnance ne peut pas être vide."));
      return;
    }
    setSubmitting(true);
    try {
      const updated = await writePrescription(token, consultation.id, value);
      onSaved(updated);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rx-title" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title" id="rx-title">
          Ordonnance
        </h2>
        <p className="modal-body">
          Rédigez l&apos;ordonnance pour {consultation.patient_name}. Enregistrer l&apos;ordonnance clôture la
          consultation — cette action est irréversible.
        </p>
        <ErrorAlert error={error} />
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="rx-text">Contenu de l&apos;ordonnance</label>
            <textarea
              id="rx-text"
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Ex :\n— Paracétamol 500 mg : 1 comprimé 3×/jour pendant 5 jours\n— Repos et hydratation abondante"}
              maxLength={4000}
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden /> Enregistrement…
                </>
              ) : (
                <>
                  <ClipboardList size={15} aria-hidden /> Enregistrer et clôturer
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
