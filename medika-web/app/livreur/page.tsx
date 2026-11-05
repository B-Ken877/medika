"use client";

/**
 * Portail livreur — Medika delivery-employee portal (issue #82, delivery
 * scope).
 *
 * Employees see ONLY the deliveries assigned to their own account (the
 * server enforces isolation in every query — this page merely renders the
 * authorized payload). Minimum fulfilment data only: recipient, phone,
 * address, schedule, pickup pharmacy/reference. Never any diagnosis, notes,
 * medical history or prescription content.
 *
 * Custody transitions (French labels, safe errors):
 *   ASSIGNED → PHARMACY_PREPARING → READY_FOR_PICKUP → PICKED_UP →
 *   OUT_FOR_DELIVERY → AWAITING_CONFIRMATION | FAILED_ATTEMPT
 *   FAILED_ATTEMPT → OUT_FOR_DELIVERY (retry) | RETURNED_ESCALATED
 * DELIVERED is intentionally ABSENT: only the patient's own confirmation in
 * the app can complete a delivery — a driver tap is never proof.
 *
 * Every submission carries a unique Idempotency-Key so a retry after a flaky
 * connection can never double-apply a transition.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, MapPin, Phone, Store } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { apiFetch } from "@/lib/api/client";
import { ErrorAlert, Spinner } from "@/components/ui/primitives";

type Delivery = {
  id: string;
  medication_order_id: string;
  reference: string;
  patient_name: string;
  delivery_address: string;
  delivery_phone: string;
  delivery_zone: string;
  city: string;
  pickup_pharmacy_name: string;
  pickup_reference: string;
  scheduled_for: string;
  urgent: boolean;
  status: string;
};

const STATUS_FR: Record<string, string> = {
  ASSIGNED: "Affectée",
  PHARMACY_PREPARING: "Préparation en pharmacie",
  READY_FOR_PICKUP: "Prête au retrait",
  PICKED_UP: "Récupérée",
  OUT_FOR_DELIVERY: "En livraison",
  AWAITING_CONFIRMATION: "En attente de confirmation patient",
  DELIVERED: "Livrée (confirmée par le patient)",
  FAILED_ATTEMPT: "Tentative échouée",
  RETURNED_ESCALATED: "Retournée / escaladée",
};

// The server is the authority on allowed transitions; this map only decides
// which button to offer for the current stage.
const NEXT_ACTIONS: Record<string, { type: string; label: string; needsReason?: boolean }[]> = {
  ASSIGNED: [{ type: "PHARMACY_PREPARING", label: "Pharmacie en préparation" }],
  PHARMACY_PREPARING: [{ type: "READY_FOR_PICKUP", label: "Médicaments prêts au retrait" }],
  READY_FOR_PICKUP: [{ type: "PICKED_UP", label: "Médicaments récupérés" }],
  PICKED_UP: [{ type: "OUT_FOR_DELIVERY", label: "Départ en livraison" }],
  OUT_FOR_DELIVERY: [
    { type: "AWAITING_CONFIRMATION", label: "Colis remis au patient" },
    { type: "FAILED_ATTEMPT", label: "Tentative échouée", needsReason: true },
  ],
  FAILED_ATTEMPT: [
    { type: "OUT_FOR_DELIVERY", label: "Nouvelle tentative" },
    { type: "RETURNED_ESCALATED", label: "Retour / escalade", needsReason: true },
  ],
};

function telHref(phone: string): string {
  return `tel:${String(phone || "").trim()}`;
}

function DeliveryCard({
  delivery,
  busy,
  reason,
  onReasonChange,
  onUpdate,
}: {
  delivery: Delivery;
  busy: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onUpdate: (eventType: string, needsReason: boolean) => void;
}) {
  const actions = NEXT_ACTIONS[delivery.status] ?? [];
  const scheduled = /^\d{4}-\d{2}-\d{2}$/.test(delivery.scheduled_for)
    ? new Date(delivery.scheduled_for + "T12:00:00Z").toLocaleDateString("fr-FR", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      })
    : delivery.scheduled_for;

  return (
    <article className="card" style={{ padding: 16 }} aria-label={`Livraison ${delivery.reference}`}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ color: "var(--green-800)" }}>{delivery.reference}</strong>
        <span className="tiny" style={{ fontWeight: 600 }}>
          {STATUS_FR[delivery.status] ?? delivery.status}
          {delivery.urgent ? " · Prioritaire" : ""}
        </span>
      </header>
      <p className="small" style={{ margin: "6px 0 2px" }}>
        <MapPin size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {delivery.patient_name} — {delivery.delivery_address} ({delivery.city}, zone {delivery.delivery_zone})
      </p>
      <p className="small" style={{ margin: "2px 0" }}>
        <Phone size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        <a href={telHref(delivery.delivery_phone)}>{delivery.delivery_phone}</a>
      </p>
      <p className="small" style={{ margin: "2px 0 8px" }}>
        <Store size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Retrait : {delivery.pickup_pharmacy_name} — réf. {delivery.pickup_reference}
      </p>
      <p className="small" style={{ margin: "2px 0 8px" }}>
        <PackageCheck size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Prévue : {scheduled}
      </p>
      {actions.map((action) => (
        <div key={action.type} style={{ marginTop: 8 }}>
          {action.needsReason && (
            <input
              className="input"
              type="text"
              maxLength={200}
              placeholder="Motif (obligatoire, 5 caractères minimum)"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              disabled={busy}
              aria-label={`Motif pour ${action.label}`}
              style={{ marginBottom: 6 }}
            />
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onUpdate(action.type, Boolean(action.needsReason))}
          >
            {busy ? "Mise à jour…" : action.label}
          </button>
        </div>
      ))}
      {actions.length === 0 && (
        <p className="tiny" style={{ marginTop: 8, color: "var(--gray-700, #3f4f4b)" }}>
          {delivery.status === "AWAITING_CONFIRMATION"
            ? "Le patient doit confirmer la réception dans Medika."
            : "Aucune action disponible à cette étape."}
        </p>
      )}
    </article>
  );
}

export default function DeliveryEmployeePortal() {
  const { user, token, status, logout } = useAuth();
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setDeliveries(await apiFetch<Delivery[]>("/api/delivery/my", { token }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les livraisons.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login?next=%2Flivreur");
    if (status === "authenticated" && user?.role !== "delivery") router.replace("/app");
    if (status === "authenticated" && user?.role === "delivery") void load();
  }, [status, user?.role, router, load]);

  const update = async (delivery: Delivery, eventType: string, needsReason: boolean) => {
    if (!token || busy) return;
    const reason = (reasons[delivery.id] || "").trim();
    if (needsReason && reason.length < 5) {
      setError("Veuillez préciser le motif (5 caractères minimum).");
      return;
    }
    setBusy(delivery.id);
    setError(null);
    try {
      await apiFetch(`/api/delivery/${encodeURIComponent(delivery.id)}/events`, {
        method: "POST",
        token,
        body: { event_type: eventType, reason },
        headers: { "Idempotency-Key": `livreur-${delivery.id}-${eventType}-${crypto.randomUUID()}` },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La mise à jour a échoué. Réessayez.");
    } finally {
      setBusy(null);
    }
  };

  if (status !== "authenticated" || user?.role !== "delivery") {
    return (
      <main className="container" style={{ padding: 24 }}>
        <Spinner label="Chargement de votre espace de livraison…" />
      </main>
    );
  }

  const active = deliveries.filter((d) => !["DELIVERED", "RETURNED_ESCALATED"].includes(d.status));
  const done = deliveries.filter((d) => ["DELIVERED", "RETURNED_ESCALATED"].includes(d.status));

  return (
    <main className="container" style={{ padding: "16px 12px 48px", maxWidth: 720 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: "1.3rem", color: "var(--green-800)" }}>Mes livraisons</h1>
        <button type="button" className="btn btn-secondary" onClick={logout}>Déconnexion</button>
      </header>
      {error && <ErrorAlert error={error} />}
      {loading ? (
        <Spinner label="Chargement de vos livraisons…" />
      ) : (
        <>
          <p className="tiny" style={{ marginBottom: 10, color: "var(--gray-700, #3f4f4b)" }}>
            Vous ne voyez que les livraisons qui vous sont assignées. La remise au patient doit être
            confirmée par le patient dans Medika.
          </p>
          {active.length === 0 && done.length === 0 && (
            <div className="alert alert-info" role="status">Aucune livraison ne vous est actuellement assignée.</div>
          )}
          {active.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              busy={busy === d.id}
              reason={reasons[d.id] || ""}
              onReasonChange={(value) => setReasons((r) => ({ ...r, [d.id]: value }))}
              onUpdate={(type, needsReason) => void update(d, type, needsReason)}
            />
          ))}
          {done.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small" style={{ cursor: "pointer", color: "var(--green-800)" }}>
                Livraisons terminées ({done.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                {done.map((d) => (
                  <DeliveryCard
                    key={d.id}
                    delivery={d}
                    busy={false}
                    reason=""
                    onReasonChange={() => {}}
                    onUpdate={() => {}}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}
