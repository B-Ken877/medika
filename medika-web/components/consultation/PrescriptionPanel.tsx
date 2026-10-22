"use client";

/** Patient-side read-only prescription panel for finished consultations. */
import { ClipboardList } from "lucide-react";
import type { Consultation } from "@/lib/api/types";

export function PrescriptionPanel({ consultation }: { consultation: Consultation }) {
  if (!consultation.prescription) return null;
  return (
    <section
      className="card"
      style={{ margin: 12, background: "var(--success-bg)", borderColor: "var(--green-200)" }}
      aria-label="Ordonnance"
    >
      <div className="flex" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <ClipboardList size={18} color="var(--green-700)" aria-hidden />
        <strong style={{ color: "var(--green-800)" }}>Ordonnance</strong>
      </div>
      <div style={{ whiteSpace: "pre-wrap", color: "var(--green-900)", fontSize: "0.92rem" }}>
        {consultation.prescription}
      </div>
    </section>
  );
}
