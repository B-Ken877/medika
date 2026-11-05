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
 *    prices in integer HTG, medication total only, and quote expiry;
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
import type { Consultation, DeliveryZone, MedicationOrder, MedicationQuoteItem } from "@/lib/api/types";
import {
  acceptMedicationQuote,
  cancelMedicationOrder,
  createMedicationOrder,
  declineMedicationQuote,
  getDeliveryZones,
  getMedicationOrderByConsultation,
  getPrescriptionDocument,
  createMedicationPayment,
  verifyMedicationPayment,
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
        <p className="tiny" style={{ marginTop: 6, color: "var(--gray-700, #3f4f4b)" }}>
          Livraison offerte par Medika dans les zones desservies.
        </p>
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
 *  only — legacy free-text prescriptions cannot be sourced).
 *
 *  Coverage is record-based (issue #82 §7): the patient picks an exact zone
 *  from GET /api/delivery-zones; with no active zone the form stays closed
 *  and only the independent-purchase alternative is offered. Delivery is
 *  FREE for the patient — no delivery fee line ever appears anywhere. */
export function MedicationOrderCta({
  busy,
  deliveryAddress,
  deliveryPhone,
  deliveryZoneId,
  zones,
  zonesLoading,
  onDeliveryAddressChange,
  onDeliveryPhoneChange,
  onDeliveryZoneChange,
  onCreate,
}: {
  busy: boolean;
  deliveryAddress: string;
  deliveryPhone: string;
  deliveryZoneId: string;
  zones: DeliveryZone[];
  zonesLoading: boolean;
  onDeliveryAddressChange: (value: string) => void;
  onDeliveryPhoneChange: (value: string) => void;
  onDeliveryZoneChange: (zoneId: string) => void;
  onCreate: () => void;
}) {
  const selectedZone = zones.find((z) => z.id === deliveryZoneId) ?? null;
  const coverageClosed = !zonesLoading && zones.length === 0;
  return (
    <section className="card" style={{ margin: 12 }} aria-label="Demander un devis de médicaments">
      <h3 style={{ margin: 0, marginBottom: 6, fontSize: "1.05rem", color: "var(--green-800)", display: "flex", alignItems: "center", gap: 8 }}>
        <Pill size={18} aria-hidden style={{ color: "var(--green-700)" }} />
        Acheter vos médicaments avec Medika
      </h3>
      <p className="small" style={{ margin: "4px 0 10px", color: "var(--gray-700, #3f4f4b)" }}>
        Notre équipe contacte une pharmacie partenaire, confirme les prix et la disponibilité de chaque
        médicament, puis vous envoie un devis à accepter ou refuser. La livraison est offerte par Medika
        dans les zones desservies. Vous restez libre d’acheter vos médicaments vous-même : téléchargez ou
        imprimez simplement l’ordonnance ci-dessus.
      </p>
      {coverageClosed ? (
        <p className="small" style={{ margin: "4px 0 10px", color: "var(--gray-700, #3f4f4b)", fontWeight: 600 }}>
          La livraison Medika n’est pas encore disponible dans votre zone. Vous pouvez télécharger votre
          ordonnance ci-dessus et acheter vos médicaments en pharmacie.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="small" htmlFor="med-order-address" style={{ color: "var(--gray-700, #3f4f4b)" }}>
            Adresse de livraison (obligatoire)
            <input
              id="med-order-address"
              className="input"
              type="text"
              maxLength={500}
              required
              value={deliveryAddress}
              onChange={(e) => onDeliveryAddressChange(e.target.value)}
              placeholder="Ex. : 12, rue Ka o, Port-au-Prince"
              disabled={busy}
              style={{ marginTop: 4 }}
            />
          </label>
          <label className="small" htmlFor="med-order-zone" style={{ color: "var(--gray-700, #3f4f4b)" }}>
            Zone de livraison Medika (obligatoire)
            <select
              id="med-order-zone"
              className="input"
              required
              value={deliveryZoneId}
              onChange={(e) => onDeliveryZoneChange(e.target.value)}
              disabled={busy || zonesLoading}
              style={{ marginTop: 4 }}
            >
              <option value="">{zonesLoading ? "Chargement des zones desservies…" : "— Sélectionnez votre zone —"}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.zone_name} — {z.city}
                </option>
              ))}
            </select>
          </label>
          <label className="small" htmlFor="med-order-phone" style={{ color: "var(--gray-700, #3f4f4b)" }}>
            Téléphone pour la livraison (obligatoire)
            <input
              id="med-order-phone"
              className="input"
              type="tel"
              maxLength={20}
              required
              value={deliveryPhone}
              onChange={(e) => onDeliveryPhoneChange(e.target.value)}
              placeholder="+509 …"
              disabled={busy}
              style={{ marginTop: 4 }}
            />
          </label>
        </div>
      )}
      <p className="tiny" style={{ marginTop: 8, color: "var(--gray-700, #3f4f4b)" }}>
        {selectedZone
          ? `Zone sélectionnée : ${selectedZone.zone_name} (${selectedZone.city}). La disponibilité est vérifiée au moment de la demande.`
          : "La disponibilité est vérifiée selon les zones actuellement desservies. Si votre adresse n’est pas couverte, vous pourrez toujours utiliser l’ordonnance pour acheter vos médicaments en pharmacie."}
      </p>
      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        onClick={onCreate}
        disabled={busy || coverageClosed || !deliveryZoneId}
      >
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
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

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

  useEffect(() => {
    let alive = true;
    // Active coverage zones for the order form (issue #82 §7 — explicit
    // records, fail closed when none is configured).
    if (token) {
      getDeliveryZones(token)
        .then((r) => {
          if (alive) setZones(r.zones ?? []);
        })
        .catch(() => {
          if (alive) setZones([]);
        })
        .finally(() => {
          if (alive) setZonesLoading(false);
        });
    } else if (alive) {
      setZonesLoading(false);
    }
    return () => {
      alive = false;
    };
  }, [token]);

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
      const zone = zones.find((z) => z.id === deliveryZoneId);
      if (!zone) {
        // Fail closed client-side too: no zone record selected → no request.
        throw new ApiError("network", 0, "Veuillez sélectionner une zone de livraison Medika dans la liste.");
      }
      const created = await createMedicationOrder(token ?? "", consultation.id, {
        delivery_address: deliveryAddress.trim(),
        delivery_city: zone.city,
        delivery_phone: deliveryPhone.trim(),
        delivery_zone_id: zone.id,
      });
      setOrder(created);
      setDeliveryAddress("");
      setDeliveryPhone("");
      setDeliveryZoneId("");
    });

  const onAccept = () =>
    run(async () => {
      if (order) await acceptMedicationQuote(token ?? "", order.id);
      setPaymentUrl(null);
      setPaymentMessage(null);
    });

  const onStartPayment = () =>
    run(async () => {
      if (!order) return;
      const result = await createMedicationPayment(token ?? "", order.id);
      if (result.paid) {
        setPaymentMessage("Votre paiement est déjà confirmé.");
        setPaymentUrl(null);
      } else if (result.redirectUrl) {
        setPaymentUrl(result.redirectUrl);
        setPaymentMessage("Après avoir terminé le paiement MonCash, revenez ici et vérifiez son statut.");
      }
    });

  const onVerifyPayment = () =>
    run(async () => {
      if (!order) return;
      const result = await verifyMedicationPayment(token ?? "", order.id);
      if (result.success) {
        setPaymentMessage("Paiement confirmé par MonCash. Votre demande est transmise à l’équipe de préparation.");
        setPaymentUrl(null);
      } else {
        setPaymentMessage("Le paiement n’est pas encore confirmé. Si vous venez de payer, patientez quelques instants puis réessayez.");
      }
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
        {order.status === "ACCEPTED" && (
          <section className="card" style={{ margin: 12 }} aria-label="Paiement MonCash">
            <h3 style={{ marginTop: 0, color: "var(--green-800)" }}>Paiement du devis</h3>
            <p className="small">Le montant est calculé à partir du devis confirmé. Aucun frais de livraison ne vous est facturé.</p>
            {order.payment?.status !== "REVIEW" && (
              <button type="button" className="btn btn-primary" onClick={onStartPayment} disabled={busy}>
                {order.payment?.status === "FAILED" ? "Réessayer avec MonCash" : "Payer avec MonCash"}
              </button>
            )}
            {paymentUrl && (
              <p style={{ marginTop: 10 }}>
                <a className="btn btn-secondary" href={paymentUrl} target="_blank" rel="noopener noreferrer">Ouvrir MonCash</a>
              </p>
            )}
            {order.payment?.status === "PENDING" && (
              <button type="button" className="btn btn-primary" onClick={onVerifyPayment} disabled={busy}>
                Vérifier mon paiement
              </button>
            )}
            {order.payment?.status === "REVIEW" && (
              <div className="alert alert-warning" role="alert" style={{ marginTop: 10 }}>
                Votre paiement a été reçu, mais nécessite une vérification par notre équipe. Ne procédez pas à un deuxième paiement.
              </div>
            )}
            {order.payment?.status === "FAILED" && (
              <p className="small" role="alert">Le paiement précédent a échoué. Vous pouvez réessayer.</p>
            )}
            {order.payment?.payment_reference && <p className="tiny">Référence : {order.payment.payment_reference}</p>}
            {paymentMessage && <p className="small" role="status" style={{ marginTop: 8 }}>{paymentMessage}</p>}
          </section>
        )}
        {order.status === "PAID" && (
          <section className="card" style={{ margin: 12 }} role="status">
            <strong style={{ color: "var(--green-800)" }}>Paiement confirmé</strong>
            <p className="small">Votre paiement MonCash a été vérifié. L’équipe Medika peut maintenant préparer votre commande.</p>
          </section>
        )}
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
        deliveryZoneId={deliveryZoneId}
        zones={zones}
        zonesLoading={zonesLoading}
        onDeliveryAddressChange={setDeliveryAddress}
        onDeliveryPhoneChange={setDeliveryPhone}
        onDeliveryZoneChange={setDeliveryZoneId}
        onCreate={onCreate}
      />
    </div>
  );
}
