"use client";

/**
 * Doctor-only structured prescription composer (issue #82).
 *
 * Replaces the free-text-only modal with a structured document: one card per
 * medication (name required; strength/form/dose/route/frequency/duration/
 * quantity/refills/instructions optional) plus general instructions.
 *
 * Issuance is final: the server persists an immutable prescription document
 * and completes the consultation atomically; a duplicate submit answers
 * 409 PRESCRIPTION_ALREADY_ISSUED (surfaced through ErrorAlert).
 * All feature copy is French (issue #82); no clinical value is auto-filled —
 * every field starts empty, placeholders are examples only.
 */
import { useState, type FormEvent } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { issuePrescription } from "@/lib/api/endpoints";
import type { Consultation, PrescriptionDocItem } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

const MAX_ITEMS = 20; // mirrors the server-side limit

const EMPTY_ITEM: PrescriptionDocItem = { name: "" };

/** Labeled text input with consistent spacing (mobile-first). */
function ItemInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={id}
        className="input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={300}
        required={required}
      />
    </div>
  );
}

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
  const [items, setItems] = useState<PrescriptionDocItem[]>([{ ...EMPTY_ITEM }]);
  const [generalInstructions, setGeneralInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setItem = (index: number, patch: Partial<PrescriptionDocItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    if (items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return; // anti double-submit
    if (items.length === 0 || items.some((it) => !it.name.trim())) {
      setError(new ApiError("validation", 0, "Le nom du médicament est obligatoire pour chaque ligne de l’ordonnance."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await issuePrescription(token, consultation.id, {
        items: items.map((it) => ({ ...it, name: it.name.trim() })),
        general_instructions: generalInstructions.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rx-title" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <h2 className="modal-title" id="rx-title">
          Ordonnance médicale
        </h2>
        <p className="modal-body">
          Rédigez l’ordonnance structurée de {consultation.patient_name}. L’enregistrement établit le document définitif
          et clôt la consultation — cette action est irréversible.
        </p>
        <ErrorAlert error={error} />
        <form onSubmit={onSubmit}>
          {items.map((item, index) => (
            <fieldset
              key={index}
              style={{
                border: "1px solid var(--gray-200)",
                borderRadius: 10,
                padding: "10px 12px 12px",
                marginBottom: 12,
                background: "var(--gray-50, #f5f8f7)",
              }}
            >
              <legend className="tiny" style={{ padding: "0 6px", color: "var(--green-800)" }}>
                Médicament {index + 1}
              </legend>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <ItemInput
                    id={`rx-item-${index}-name`}
                    label="Médicament"
                    required
                    value={item.name}
                    onChange={(v) => setItem(index, { name: v })}
                    placeholder="ex. Paracétamol"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => removeItem(index)}
                  disabled={submitting}
                  aria-label={`Retirer le médicament ${index + 1}`}
                  title="Retirer ce médicament"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <ItemInput
                  id={`rx-item-${index}-strength`}
                  label="Dosage"
                  value={item.strength ?? ""}
                  onChange={(v) => setItem(index, { strength: v })}
                  placeholder="ex. 500 mg"
                />
                <ItemInput
                  id={`rx-item-${index}-form`}
                  label="Forme"
                  value={item.form ?? ""}
                  onChange={(v) => setItem(index, { form: v })}
                  placeholder="ex. comprimé"
                />
                <ItemInput
                  id={`rx-item-${index}-dose`}
                  label="Prise"
                  value={item.dose ?? ""}
                  onChange={(v) => setItem(index, { dose: v })}
                  placeholder="ex. 1 comprimé"
                />
                <ItemInput
                  id={`rx-item-${index}-route`}
                  label="Voie"
                  value={item.route ?? ""}
                  onChange={(v) => setItem(index, { route: v })}
                  placeholder="ex. orale"
                />
                <ItemInput
                  id={`rx-item-${index}-frequency`}
                  label="Fréquence"
                  value={item.frequency ?? ""}
                  onChange={(v) => setItem(index, { frequency: v })}
                  placeholder="ex. 3 fois par jour"
                />
                <ItemInput
                  id={`rx-item-${index}-duration`}
                  label="Durée"
                  value={item.duration ?? ""}
                  onChange={(v) => setItem(index, { duration: v })}
                  placeholder="ex. 5 jours"
                />
                <ItemInput
                  id={`rx-item-${index}-quantity`}
                  label="Quantité"
                  value={item.quantity ?? ""}
                  onChange={(v) => setItem(index, { quantity: v })}
                  placeholder="ex. 15 comprimés"
                />
                <ItemInput
                  id={`rx-item-${index}-refills`}
                  label="Renouvellements"
                  value={item.refills ?? ""}
                  onChange={(v) => setItem(index, { refills: v })}
                  placeholder="ex. 0"
                />
              </div>
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label htmlFor={`rx-item-${index}-instructions`}>Instructions particulières</label>
                <textarea
                  id={`rx-item-${index}-instructions`}
                  className="textarea"
                  rows={2}
                  value={item.instructions ?? ""}
                  onChange={(e) => setItem(index, { instructions: e.target.value })}
                  placeholder="ex. À prendre pendant les repas"
                  maxLength={300}
                />
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={addItem}
            disabled={submitting || items.length >= MAX_ITEMS}
          >
            <Plus size={15} aria-hidden /> Ajouter un médicament
          </button>

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="rx-general">Instructions générales</label>
            <textarea
              id="rx-general"
              className="textarea"
              rows={3}
              value={generalInstructions}
              onChange={(e) => setGeneralInstructions(e.target.value)}
              placeholder="ex. Repos, hydratation abondante, contrôle en cas de fièvre persistante"
              maxLength={2000}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden /> Enregistrement en cours…
                </>
              ) : (
                <>
                  <ClipboardList size={15} aria-hidden /> Établir l’ordonnance et clôturer
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
