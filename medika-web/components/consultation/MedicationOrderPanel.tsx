"use client";

/**
 * Medication order panel — « Médicaments via Medika » (issue #83).
 *
 * Patient-side flow for sourcing the medications of an issued prescription:
 *  - CTA « Demander le prix et la livraison avec Medika » (a patient who
 *    wants to buy independently simply downloads/prints the prescription —
 *    ordering is never required);
 *  - live status (waiting / escalated / quoted / accepted / declined /
 *    cancelled / expired) with the pharmacy quote: itemized availability and
 *    prices in integer HTG, total, delivery fee when recorded, quote expiry;
 *  - decision path: accept the quote, decline it, or cancel the request
 *    before any quote. The payment step is the dependent MonCash issue —
 *    shown as an explicit next step, never faked here.
 *
 * All copy is professional French (issue #83). Statuses come from the server
 * (status_label_fr / next_step) — this component never guesses from raw
 * values it cannot know. Actions are guarded against double submission.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Pill, RefreshCw, XCircle } from "lucide-react";
import type { Consultation, MedicationOrder, MedicationQuoteItem } from "@/lib/api/types";
import {
  acceptMedicationQuote,
  cancelMedicationOrder,
  createMedicationOrder,
  declineMedicationQuote,
  getMedicationOrderByConsultation,
  getPrescriptionDocument,
} from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert, Spinner } from "@/components/ui/primitives";

const AVAILABILITY_LABELS_FR: Record<string, string> = {
  AVAILABLE: "Disponible",
  PARTIAL: "Stock partiel",
  UNAVAILABLE: "Indisponible",
};

function formatHtg(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} HTG`;
}

function formatDateTime(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  try {
    return new Date(epochSeconds * 1000).toLocaleString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/** One quoted medication line — availability is always explicit, prices only
 *  when the pharmacy can actually supply the item. */
function QuoteLine({ item, index }: { item: MedicationQuoteItem; index: number }) {
  const availability = AVAILABILITY_LABELS_FR[item.availability] ?? item.availability;
  const unavailable = item.availability === "UNAVAILABLE";
  const heading = [item.name, item.strength, item.form ? `(${item.form})` : null].filter(Boolean).join(" ");
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--gray-200)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600 }}>
          {index + 1}. {heading}
        </div>
        <span
          className="tiny"
          style={{
            color: unavailable ? "var(--danger, #b3261e)" : "var(--green-700)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {availability}
        </span>
      </div>
      {item.offered_quantity && !unavailable && (
        <div className="tiny" style={{ color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>
          Quantité confirmée par la pharmacie : {item.offered_quantity}
        </div>
      )}
      {!unavailable && item.unit_price_htg != null && item.quantity != null && (
        <div className="tiny" style={{ color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>
          {formatHtg(item.unit_price_htg)} × {item.quantity} = <strong>{formatHtg(item.subtotal_htg ?? 0)}</strong>
        </div>
      )}
      {unavailable && (
        <div className="tiny" style={{ color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>
          Ce médicament n’est pas disponible dans cette pharmacie — aucune substitution n’est faite sans
          l’accord de votre médecin.
        </div>
      )}
    </div>
  );
}

/** The quote as the patient reviews it: pharmacy, itemized prices, total,
 *  delivery, validity — and the two decisions (accept / decline). */
export function MedicationQuoteView({
  order,
  busy,
  onAccept,
  onDecline,
}: {
  order: MedicationOrder;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const quote = order.quote;
  if (!quote) return null;
  const expiry = formatDateTime(quote.expires_at);
  const expired = Boolean(quote.expired);
  return (
    <div
      className="card"
      style={{ margin: 12, marginTop: 0, borderColor: "var(--green-200)", background: "var(--success-bg, #f0f7f4)" }}
      aria-label="Devis des médicaments"
    >
      <h3 style={{ margin: 0, marginBottom: 8, fontSize: "1.1rem", color: "var(--green-800)", display: "flex", alignItems: "center", gap: 8 }}>
        <Pill size={18} aria-hidden style={{ color: "var(--green-700)" }} />
        Devis de vos médicaments
      </h3>
      <div className="small" style={{ color: "var(--gray-700, #3f4f4b)" }}>
        Pharmacie : <strong>{quote.pharmacy.name}</strong>
        {quote.confirmed_at ? ` — réponse enregistrée le ${formatDateTime(quote.confirmed_at)}` : ""}
      </div>

      <div style={{ marginTop: 10, borderTop: "1px solid var(--gray-200)" }}>
        {quote.items.map((item, i) => (
          <QuoteLine key={`${item.prescription_index}-${i}`} item={item} index={i} />
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: "0.95rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Total des médicaments</span>
          <strong>{formatHtg(quote.total_htg)}</strong>
        </div>
        {quote.delivery_fee_htg != null && quote.delivery_fee_htg > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--gray-700, #3f4f4b)" }}>
            <span>Frais de livraison{quote.delivery_notes ? ` — ${quote.delivery_notes}` : ""}</span>
            <span>{formatHtg(quote.delivery_fee_htg)}</span>
          </div>
        )}
      </div>

      {expiry && (
        <div className="tiny" style={{ marginTop: 8, color: expired ? "var(--danger, #b3261e)" : "var(--gray-700, #3f4f4b)" }}>
          {expired ? "Ce devis a expiré le " : "Devis valable jusqu’au "}
          {expiry}
          {expired ? "." : "."}
        </div>
      )}

      {expired ? (
        <div className="alert alert-error" style={{ marginTop: 10 }} role="alert">
          Ce devis a expiré. Vous pouvez faire une nouvelle demande pour obtenir des prix actualisés.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={onAccept} disabled={busy}>
            <CheckCircle2 size={15} aria-hidden /> Accepter le devis
          </button>
          <button type="button" className="btn btn-secondary" onClick={onDecline} disabled={busy}>
            <XCircle size={15} aria-hidden /> Refuser le devis
          </button>
        </div>
      )}
      <p className="tiny" style={{ marginTop: 10, color: "var(--gray-700, #3f4f4b)" }}>
        Aucun médicament n’est remplacé sans l’accord du médecin qui a rédigé l’ordonnance.
      </p>
    </div>
  );
}

/** The order lifecycle card (everything except the quote review itself). */
export function MedicationOrderView({
  order,
  busy,
  onAccept,
  onDecline,
  onCancel,
  onNewRequest,
}: {
  order: MedicationOrder;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onNewRequest: () => void;
}) {
  const slaDeadline = formatDateTime(order.sla_deadline_at);
  return (
    <div>
      <section
        className="card"
        style={{ margin: 12, marginBottom: order.status === "QUOTED" ? 0 : 12 }}
        aria-label="Médicaments via Medika"
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "var(--green-800)", display: "flex", alignItems: "center", gap: 8 }}>
            <Pill size={18} aria-hidden style={{ color: "var(--green-700)" }} />
            Médicaments via Medika
          </h3>
          <span className="tiny" style={{ color: "var(--gray-700, #3f4f4b)" }}>Réf. : {order.reference}</span>
        </div>

        {order.status === "REQUESTED" && (
          <div className="alert alert-info" style={{ marginTop: 8 }} role="status">
            Demande enregistrée. Notre équipe contacte une pharmacie partenaire pour confirmer les prix
            {slaDeadline ? ` (réponse attendue avant le ${slaDeadline})` : ""}. Vous recevrez une notification
            dès que le devis est prêt.
          </div>
        )}
        {order.status === "ESCALATED" && (
          <div className="alert alert-warning" style={{ marginTop: 8 }} role="status">
            La recherche d’un prix prend plus de temps que prévu. Notre équipe relance les pharmacies
            partenaires — vous n’avez rien à faire. Vous pouvez aussi annuler la demande ci-dessous.
          </div>
        )}
        {order.status === "ACCEPTED" && (
          <div className="alert alert-success" style={{ marginTop: 8 }} role="status">
            Devis accepté. Étape suivante : le paiement du devis sera disponible dans Medika. Notre équipe
            vous guide pour la suite.
          </div>
        )}
        {order.status === "DECLINED" && (
          <div className="alert alert-info" style={{ marginTop: 8 }} role="status">
            Vous avez refusé ce devis. Vous pouvez faire une nouvelle demande à tout moment, ou acheter vos
            médicaments vous-même avec l’ordonnance ci-dessus.
          </div>
        )}
        {order.status === "CANCELLED" && (
          <div className="alert alert-info" style={{ marginTop: 8 }} role="status">
            Demande annulée. Vous pouvez en refaire une nouvelle à tout moment.
          </div>
        )}
        {order.status === "EXPIRED" && (
          <div className="alert alert-warning" style={{ marginTop: 8 }} role="status">
            Le devis a expiré sans décision. Faites une nouvelle demande pour obtenir des prix actualisés.
          </div>
        )}
      </section>

      {order.status === "QUOTED" && (
        <MedicationQuoteView order={order} busy={busy} onAccept={onAccept} onDecline={onDecline} />
      )}

      {(order.status === "REQUESTED" || order.status === "ESCALATED") && (
        <div style={{ margin: "0 12px 12px", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            <XCircle size={15} aria-hidden /> Annuler la demande
          </button>
        </div>
      )}
      {(order.status === "DECLINED" || order.status === "CANCELLED" || order.status === "EXPIRED") && (
        <div style={{ margin: "0 12px 12px", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-primary" onClick={onNewRequest} disabled={busy}>
            <RefreshCw size={15} aria-hidden /> Faire une nouvelle demande
          </button>
        </div>
      )}
    </div>
  );
}

/** The call-to-action shown when no order exists yet (structured prescription
 *  only — legacy free-text prescriptions cannot be sourced). */
export function MedicationOrderCta({
  busy,
  deliveryAddress,
  deliveryPhone,
  onDeliveryAddressChange,
  onDeliveryPhoneChange,
  onCreate,
}: {
  busy: boolean;
  deliveryAddress: string;
  deliveryPhone: string;
  onDeliveryAddressChange: (value: string) => void;
  onDeliveryPhoneChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="card" style={{ margin: 12 }} aria-label="Demander un devis de médicaments">
      <h3 style={{ margin: 0, marginBottom: 6, fontSize: "1.05rem", color: "var(--green-800)", display: "flex", alignItems: "center", gap: 8 }}>
        <Pill size={18} aria-hidden style={{ color: "var(--green-700)" }} />
        Acheter vos médicaments avec Medika
      </h3>
      <p className="small" style={{ margin: "4px 0 10px", color: "var(--gray-700, #3f4f4b)" }}>
        Notre équipe contacte une pharmacie partenaire, confirme les prix et la disponibilité de chaque
        médicament, puis vous envoie un devis à accepter ou refuser. Vous restez libre d’acheter vos
        médicaments vous-même : téléchargez ou imprimez simplement l’ordonnance ci-dessus.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <label className="small" htmlFor="med-order-address" style={{ color: "var(--gray-700, #3f4f4b)" }}>
          Adresse de livraison (optionnelle)
          <input
            id="med-order-address"
            className="input"
            type="text"
            maxLength={500}
            value={deliveryAddress}
            onChange={(e) => onDeliveryAddressChange(e.target.value)}
            placeholder="Ex. : 12, rue Ka o, Port-au-Prince"
            disabled={busy}
            style={{ marginTop: 4 }}
          />
        </label>
        <label className="small" htmlFor="med-order-phone" style={{ color: "var(--gray-700, #3f4f4b)" }}>
          Téléphone pour la livraison (optionnel)
          <input
            id="med-order-phone"
            className="input"
            type="tel"
            maxLength={40}
            value={deliveryPhone}
            onChange={(e) => onDeliveryPhoneChange(e.target.value)}
            placeholder="+509 …"
            disabled={busy}
            style={{ marginTop: 4 }}
          />
        </label>
      </div>
      <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={onCreate} disabled={busy}>
        <Clock size={15} aria-hidden /> {busy ? "Envoi…" : "Demander le prix et la livraison avec Medika"}
      </button>
    </section>
  );
}

/**
 * The stateful panel: loads the patient's order for this consultation
 * (404 → CTA when a structured prescription exists; legacy-only records
 * render nothing). Rendered by the consultation page for the PATIENT viewer
 * of a finished consultation.
 */
export function MedicationOrderPanel({
  consultation,
  token,
}: {
  consultation: Consultation;
  token?: string | null;
}) {
  const [order, setOrder] = useState<MedicationOrder | null>(null);
  const [checked, setChecked] = useState(false); // true once the initial lookups resolved
  const [hasStructured, setHasStructured] = useState(true); // false → legacy-only record, hide panel
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return null;
    try {
      const o = await getMedicationOrderByConsultation(token, consultation.id);
      setOrder(o);
      return o;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setOrder(null);
        return null;
      }
      throw err;
    }
  }, [token, consultation.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setChecked(true);
        return;
      }
      try {
        const o = await getMedicationOrderByConsultation(token, consultation.id);
        if (!alive) return;
        setOrder(o);
        setChecked(true);
        return; // order exists (any status) — render its view
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          if (alive) {
            setError(err);
            setChecked(true);
          }
          return;
        }
      }
      // No order yet: the CTA only makes sense for a STRUCTURED prescription
      // (legacy free-text records cannot be sourced — nothing to quote).
      try {
        await getPrescriptionDocument(token, consultation.id);
      } catch {
        if (alive) setHasStructured(false);
      }
      if (alive) setChecked(true);
    })();
    return () => {
      alive = false;
    };
  }, [token, consultation.id]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return; // anti double-submit
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () =>
    run(async () => {
      const created = await createMedicationOrder(token ?? "", consultation.id, {
        delivery_address: deliveryAddress.trim() || undefined,
        delivery_phone: deliveryPhone.trim() || undefined,
      });
      setOrder(created);
      setDeliveryAddress("");
      setDeliveryPhone("");
    });

  const onAccept = () =>
    run(async () => {
      if (order) await acceptMedicationQuote(token ?? "", order.id);
    });

  const onDecline = () =>
    run(async () => {
      if (order) await declineMedicationQuote(token ?? "", order.id);
    });

  const onCancel = () =>
    run(async () => {
      if (order) await cancelMedicationOrder(token ?? "", order.id);
    });

  const onNewRequest = () => {
    // Show the CTA again for a fresh request (the terminal order stays in
    // history; the create action refreshes whatever the server returns).
    setError(null);
    setOrder(null);
  };

  if (!token || !checked || !hasStructured) {
    if (!token || !hasStructured) return null;
    return (
      <section className="card" style={{ margin: 12 }} aria-label="Médicaments via Medika">
        <Spinner label="Chargement de votre demande…" />
      </section>
    );
  }

  if (order) {
    return (
      <div>
        <ErrorAlert error={error} />
        <MedicationOrderView
          order={order}
          busy={busy}
          onAccept={onAccept}
          onDecline={onDecline}
          onCancel={onCancel}
          onNewRequest={onNewRequest}
        />
      </div>
    );
  }
  return (
    <div>
      <ErrorAlert error={error} />
      <MedicationOrderCta
        busy={busy}
        deliveryAddress={deliveryAddress}
        deliveryPhone={deliveryPhone}
        onDeliveryAddressChange={setDeliveryAddress}
        onDeliveryPhoneChange={setDeliveryPhone}
        onCreate={onCreate}
      />
    </div>
  );
}
