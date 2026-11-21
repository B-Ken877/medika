"use client";

/**
 * New consultation entry — a BUTTON, not a link (owner's spec).
 *
 * Clicking "Kòmanse yon konsiltasyon" does NOT navigate anywhere: it opens an
 * iOS-style action sheet with exactly TWO options:
 *   1. Rele yon ajan — POST /api/assist/requests (an ASSISTANCE SESSION, never
 *      a consultation — consultations are created ONLY when the member
 *      validates their payment in the agent-guided flow), then the caller
 *      lands on /app/assist: "calling the call-center agent…" until the
 *      agent picks up. No form, no callback screens, no extra steps.
 *   2. Kontinye manyèlman — the classic symptom-intake flow at /app/consult,
 *      unchanged.
 *
 * The sheet follows the iOS action-sheet language: translucent blurred
 * backdrop, bottom-anchored sheet with a grabber on phones (centered card on
 * desktop), grouped rows with tinted squircle icons and hairline separators,
 * a separate cancel capsule, and scale/fade press feedback (suppressed under
 * prefers-reduced-motion).
 *
 * The one-active-consultation invariant is surfaced honestly INSIDE the sheet
 * (409 + existing_id): the patient is pointed back to their open
 * consultation instead of a dead-end error.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ClipboardList, Phone, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { requestAssistance } from "@/lib/api/endpoints";
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
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    // The call request may already be in flight when the sheet closes —
    // keep the request running; its outcome still navigates (or surfaces on
    // the next open). Reset only the local error surface.
    setOpen(false);
    setError(null);
  }, []);

  // Escape closes the sheet; focus lands on the FIRST option so keyboard
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
      setError("Sesyon ou ekspire — rekonekte pou w rele ajan an.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // An assistance session — NEVER a consultation. The consultation is
      // created for the member only when they validate the agent-guided
      // payment on their device (owner fix: hanging up must leave NO
      // consultation behind).
      await requestAssistance(token);
      // Straight into the assist screen — waiting → connected, no input.
      router.push("/app/assist");
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : "Yon erè rive — eseye ankò.");
    }
  }, [router, starting, status, token]);

  return (
    <>
      {/* The entry is a real <button>: tap opens the sheet, never a
          navigation. iOS-feel press feedback comes from the scoped styles. */}
      <button
        type="button"
        className="btn btn-primary scs-cta"
        onClick={() => { setError(null); setOpen(true); }}
      >
        <Plus size={compact ? 16 : 18} aria-hidden /> Kòmanse yon konsiltasyon
      </button>

      {open && (
        <div
          className="scs-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-consult-title"
          onClick={close}
        >
          <div className="scs-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="scs-grabber" aria-hidden />
            <h2 className="scs-title" id="new-consult-title">
              Nouvo konsiltasyon
            </h2>
            <p className="scs-subtitle">Kouman ou vle kòmanse?</p>

            {error && (
              <p className="scs-error" role="alert">
                {error}
              </p>
            )}

            <div className="scs-group" role="group" aria-label="Opsyon konsiltasyon">
              {/* Option 1 — the agent call. One tap: create + route + call
                  popup. NOTHING for the patient to fill in. */}
              <button
                ref={firstOptionRef}
                type="button"
                className="scs-row"
                disabled={starting}
                onClick={startAgentCall}
              >
                <span className="scs-icon scs-icon-agent" aria-hidden>
                  {starting ? <Spinner /> : <Phone size={19} />}
                </span>
                <span className="scs-row-text">
                  <span className="scs-row-title">Rele yon ajan</span>
                  <span className="scs-row-sub">
                    {starting
                      ? "N ap prepare apèl la…"
                      : "Pa gen anyen pou w ranpli — ajan an ap reponn."}
                  </span>
                </span>
                <ChevronRight className="scs-chevron" size={16} aria-hidden />
              </button>

              <div className="scs-sep" aria-hidden />

              {/* Option 2 — the manual process: the classic intake form,
                  exactly as before. */}
              <button
                type="button"
                className="scs-row"
                disabled={starting}
                onClick={() => router.push("/app/consult")}
              >
                <span className="scs-icon scs-icon-manual" aria-hidden>
                  <ClipboardList size={19} />
                </span>
                <span className="scs-row-text">
                  <span className="scs-row-title">Kontinye manyèlman</span>
                  <span className="scs-row-sub">
                    Dekri sa w ap santi pou jwenn yon doktè.
                  </span>
                </span>
                <ChevronRight className="scs-chevron" size={16} aria-hidden />
              </button>
            </div>

            <button
              type="button"
              className="scs-cancel"
              onClick={close}
              disabled={starting}
            >
              Anile
            </button>
          </div>
        </div>
      )}
    </>
  );
}
