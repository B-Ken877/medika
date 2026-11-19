"use client";

/**
 * New consultation entry — a BUTTON, not a link (owner's spec).
 *
 * Clicking "Kòmanse yon konsiltasyon" does NOT navigate anywhere: it opens a
 * chooser with exactly TWO options:
 *   1. Rele yon ajant sant apèl — POST /api/consultations/call-center with an
 *      EMPTY body (the patient types nothing, ever), then the caller lands
 *      directly in the voice call screen, which shows "calling the call
 *      center agent…" until the agent picks up. No form, no callback screens,
 *      no extra steps.
 *   2. Manyèl — the classic symptom-intake flow at /app/consult, unchanged.
 *
 * The one-active-consultation invariant is surfaced honestly INSIDE the
 * chooser (409 + existing_id): the patient is pointed back to their open
 * consultation instead of a dead-end error.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Phone, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { createCallCenterConsultation } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { Spinner } from "@/components/ui/primitives";

interface Props {
  compact?: boolean;
}

export default function StartConsultation({ compact = false }: Props) {
  const router = useRouter();
  const { token, status } = useAuth();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #60 convention: a 409 carries the winning consultation's id on
  // ApiError.existingId — link the patient back to their open consultation.
  const [existingId, setExistingId] = useState<string | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    // The call request may already be in flight when the chooser closes —
    // keep the request running; its outcome still navigates (or surfaces on
    // the next open). Reset only the local error surface.
    setOpen(false);
    setError(null);
  }, []);

  // Escape closes the chooser; focus lands on the FIRST option so keyboard
  // and switch-access users reach the agent call in one Enter.
  useEffect(() => {
    if (!open) return;
    firstOptionRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const startAgentCall = useCallback(async () => {
    if (starting) return;
    if (status !== "authenticated" || !token) {
      setError("Sesyon ou ekspire — rekonekte pou w rele ajant la.");
      return;
    }
    setStarting(true);
    setError(null);
    setExistingId(null);
    try {
      const consultation = await createCallCenterConsultation(token);
      // Straight into the call popup — no intermediate screen, no input.
      router.push(`/app/consultations/${encodeURIComponent(consultation.id)}/call?mode=voice`);
    } catch (err) {
      setStarting(false);
      if (err instanceof ApiError && err.status === 409 && err.existingId) {
        // The patient already has an open consultation — honest redirect,
        // never a duplicate request.
        setExistingId(err.existingId);
        return;
      }
      setError(err instanceof Error ? err.message : "Yon erè rive — eseye ankò.");
    }
  }, [router, starting, status, token]);

  const activeHref = existingId ? `/app/consultations/${encodeURIComponent(existingId)}` : null;

  const alreadyActiveNotice =
    existingId && activeHref ? (
      <div
        role="status"
        style={{
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 12,
          fontSize: 13,
          color: "var(--text-secondary, #475569)",
        }}
      >
        Ou gen deja yon konsiltasyon aktif.
        <div style={{ marginTop: 8 }}>
          <Link href={activeHref} className="btn btn-secondary btn-sm">
            Ale nan konsiltasyon ou
          </Link>
        </div>
      </div>
    ) : null;

  return (
    <>
      {/* The entry is a real <button>: click opens the chooser, never a
          navigation. Same premium-mint styling as the previous link. */}
      <button type="button" className="btn btn-primary" onClick={() => { setError(null); setExistingId(null); setOpen(true); }}>
        <Plus size={compact ? 16 : 18} aria-hidden /> Kòmanse yon konsiltasyon
      </button>

      {open && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-consult-title"
          onClick={close}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: "100%" }}>
            <h2 className="modal-title" id="new-consult-title">
              Nouvo konsiltasyon
            </h2>
            <p className="modal-body">Kouman ou vle kòmanse?</p>

            {error && (
              <p role="alert" style={{ color: "var(--danger, #b3261e)", fontSize: 13, marginTop: -6, marginBottom: 12 }}>
                {error}
              </p>
            )}

            {alreadyActiveNotice}

            <div className="stack" style={{ gap: 10, marginBottom: 6 }}>
              {/* Option 1 — the agent call. One click: create + route + call
                  popup. NOTHING for the patient to fill in. */}
              <button
                ref={firstOptionRef}
                type="button"
                className="btn btn-primary"
                disabled={starting}
                onClick={startAgentCall}
                style={{ justifyContent: "flex-start", textAlign: "left", gap: 12, padding: "14px 16px" }}
              >
                {starting ? <Spinner /> : <Phone size={20} aria-hidden />}
                <span>
                  Rele yon ajant sant apèl
                  <span
                    style={{ display: "block", fontWeight: 400, fontSize: 12.5, color: "inherit", opacity: 0.85 }}
                  >
                    {starting
                      ? "N ap prepare apèl la…"
                      : "Pa gen anyen pou w ranpli — ajan an ap reponn imedyatman."}
                  </span>
                </span>
              </button>

              {/* Option 2 — the manual process: the classic intake form,
                  exactly as before. */}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={starting}
                onClick={() => router.push("/app/consult")}
                style={{ justifyContent: "flex-start", textAlign: "left", gap: 12, padding: "14px 16px" }}
              >
                <ClipboardList size={20} aria-hidden />
                <span>
                  Manyèl — ranpi fòm sentòm yo
                  <span
                    style={{ display: "block", fontWeight: 400, fontSize: 12.5, color: "inherit", opacity: 0.85 }}
                  >
                    Dekri sa w ap santi pou jwenn yon doktè.
                  </span>
                </span>
              </button>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={starting}>
                Anile
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
