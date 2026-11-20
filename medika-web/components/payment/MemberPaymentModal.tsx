"use client";

/**
 * Member-side payment popup — the agent-raised payment request (migration
 * 017, owner brief). While the member is ON THE CALL with the Medika agent,
 * the agent clicks "Submit Payment" and THIS popup opens on the member's
 * device: the amount to pay, a phone-number field and a 4-digit PIN field —
 * MonCash-style. The payment is a clearly-labeled SIMULATION for now (no
 * MonCash API yet): the server verifies and, on success, creates the
 * consultation for the member and links it to the call session.
 *
 * Deliberately NO redirect on success: the member stays where they are (the
 * call keeps running) and the consultation simply appears on their
 * dashboard. The overlay never touches the audio call underneath it.
 */
import { useState, type FormEvent } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { MemberPaymentRequest } from "@/lib/api/endpoints";
import { specialtyLabel } from "@/lib/labels";

const SIM_NOTE = "Similasyon tès — pa gen vrè lajan k ap deplase.";

export interface MemberPaymentModalProps {
  request: MemberPaymentRequest;
  /** Success state (request already paid — just confirmed or reloaded). */
  done?: boolean;
  submitting?: boolean;
  error?: string | null;
  onConfirm?: (phoneNumber: string, pin: string) => void;
  onDismiss?: () => void;
}

export function MemberPaymentModal({ request, done, submitting, error, onConfirm, onDismiss }: MemberPaymentModalProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    onConfirm?.(phoneNumber.trim(), pin.trim());
  };

  return (
    <div className="payreq-overlay" role="presentation">
      <div className="payreq-modal" role="dialog" aria-modal="true" aria-label="Demann peman">
        <div className="payreq-brand">
          <span className="badge badge-green">MonCash — Medika</span>
          {onDismiss && !done && (
            <button type="button" className="icon-btn" aria-label="Fèmen pop-up la" onClick={onDismiss}>
              <X size={18} aria-hidden />
            </button>
          )}
        </div>

        {done ? (
          <div className="stack" role="status">
            <span className="payreq-check" aria-hidden>
              <ShieldCheck size={34} />
            </span>
            <h2 className="payreq-title">Peman konfime!</h2>
            <p>
              Konsiltasyon ou kreye pou {specialtyLabel(request.specialty)}.
              Ou ka rete nan apèl la — konsiltasyon an parèt nan tablodbò ou,
              ak konvèsasyon an ladan l.
            </p>
            {onDismiss && (
              <button className="btn btn-primary btn-block" onClick={onDismiss}>
                Fèmen
              </button>
            )}
            <p className="tiny muted">{SIM_NOTE}</p>
          </div>
        ) : (
          <>
            <p className="muted small">
              Ajan Medika{request.agentName ? ` ${request.agentName}` : ""} voye w yon demann peman pandan apèl la.
            </p>
            <div>
              <span className="payreq-amount">{request.amount} {request.currency}</span>
              <span className="muted small" style={{ display: "block", marginTop: 2 }}>
                Konsiltasyon — {specialtyLabel(request.specialty)}
                {request.doctorName ? ` · ${request.doctorName}` : ""}
              </span>
            </div>

            <form className="stack" onSubmit={submit}>
              <div className="field">
                <label htmlFor="payreq-phone">Nimewo telefòn ou</label>
                <input
                  id="payreq-phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+509 3712 3456"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                />
              </div>
              <div className="field payreq-pin">
                <label htmlFor="payreq-pin">Kòd sekirite MonCash (4 chif)</label>
                <input
                  id="payreq-pin"
                  className="input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  required
                />
              </div>

              {error && (
                <div className="alert alert-error" role="alert">{error}</div>
              )}

              <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting || pin.length !== 4}>
                {submitting ? "N ap trete peman an…" : `Peye ${request.amount} ${request.currency}`}
              </button>
            </form>

            <p className="tiny muted">{SIM_NOTE} Si ou fèmen fenèt sa a san peye, ajan an ap voye l ankò.</p>
          </>
        )}
      </div>
    </div>
  );
}
