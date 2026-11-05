"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { apiFetch } from "@/lib/api/client";

type Delivery = {
  id: string; medication_order_id: string; reference: string; patient_name: string;
  delivery_address: string; delivery_phone: string; delivery_zone: string; city: string;
  pickup_pharmacy_name: string; pickup_reference: string; scheduled_for: string;
  urgent: boolean; status: string;
};
const STATUS_FR: Record<string, string> = { ASSIGNED: "Affectée", PHARMACY_PREPARING: "Préparation en pharmacie", READY_FOR_PICKUP: "Prête au retrait", PICKED_UP: "Récupérée", OUT_FOR_DELIVERY: "En livraison", AWAITING_CONFIRMATION: "En attente de confirmation", DELIVERED: "Livrée", FAILED_ATTEMPT: "Tentative échouée", RETURNED_ESCALATED: "Retournée / escaladée" };
const NEXT: Record<string, { type: string; label: string }[]> = {
  ASSIGNED: [{ type: "PHARMACY_PREPARING", label: "Pharmacie contactée" }],
  PHARMACY_PREPARING: [{ type: "READY_FOR_PICKUP", label: "Médicaments prêts" }],
  READY_FOR_PICKUP: [{ type: "PICKED_UP", label: "Médicaments récupérés" }],
  PICKED_UP: [{ type: "OUT_FOR_DELIVERY", label: "Départ en livraison" }],
  OUT_FOR_DELIVERY: [{ type: "AWAITING_CONFIRMATION", label: "Remise au patient" }, { type: "FAILED_ATTEMPT", label: "Échec de livraison" }],
  FAILED_ATTEMPT: [{ type: "OUT_FOR_DELIVERY", label: "Nouvelle tentative" }, { type: "RETURNED_ESCALATED", label: "Retour / escalade" }],
};

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
    try { setDeliveries(await apiFetch<Delivery[]>("/api/delivery/my", { token })); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Impossible de charger les livraisons."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    if (status === "anonymous") router.replace("/login?next=%2Flivreur");
    if (status === "authenticated" && user?.role !== "delivery") router.replace("/app");
    if (status === "authenticated" && user?.role === "delivery") void load();
  }, [status, user?.role, router, load]);
  const update = async (d: Delivery, eventType: string) => {
    if (!token || busy) return;
    const reason = reasons[d.id] || "";
    if (eventType === "FAILED_ATTEMPT" && reason.trim().length < 5) {
      setError("Veuillez préciser la raison de l’échec (5 caractères minimum)."); return;
    }
    setBusy(d.id); setError(null);
    try {
      await apiFetch("/api/delivery/" + encodeURIComponent(d.id) + "/events", {
        method: "POST", token, body: { event_type: eventType, reason },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "La mise à jour a échoué."); }
    finally { setBusy(null); }
  };
  if (status !== "authenticated" || user?.role !== "delivery") {
    return <main className="container" style={{ padding: 24 }}>Chargement de votre espace de livraison…</main>;
  }
  return (
    <main className="container" style={{ maxWidth: 900, padding: "24px 16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><p className="tiny" style={{ color: "var(--green-700)" }}>MEDIKA · LOGISTIQUE</p><h1 style={{ color: "var(--green-900)" }}>Mes livraisons</h1><p className="small">Bonjour {user.name}. Vous voyez uniquement les commandes qui vous sont affectées.</p></div>
        <button className="btn btn-secondary" onClick={() => { logout(); router.replace("/login"); }}>Déconnexion</button>
      </header>
      {error && <div className="alert alert-error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
      {loading ? <p style={{ padding: 24 }}>Chargement…</p> : deliveries.length === 0 ? (
        <section className="card" style={{ marginTop: 20, padding: 24 }}>Aucune livraison ne vous est affectée pour le moment.</section>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
          {deliveries.map((d) => (
            <article className="card" key={d.id} style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><strong>{d.reference}</strong><p className="small">{d.urgent ? "Livraison urgente" : "Livraison planifiée"} · {new Date(d.scheduled_for).toLocaleDateString("fr-FR")}</p></div>
                <span className="badge badge-green">{STATUS_FR[d.status] || d.status}</span>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                <div><strong>Pharmacie de retrait :</strong> {d.pickup_pharmacy_name}</div>
                <div><strong>Référence de retrait :</strong> {d.pickup_reference}</div>
                <div><strong>Destinataire :</strong> {d.patient_name}</div>
                <div><strong>Téléphone :</strong> <a href={"tel:" + d.delivery_phone}>{d.delivery_phone}</a></div>
                <div><strong>Adresse :</strong> {d.delivery_address}</div>
                <div><strong>Zone :</strong> {d.delivery_zone}, {d.city}</div>
              </div>
              {d.status === "OUT_FOR_DELIVERY" && <label className="small" style={{ display: "block", marginTop: 14 }}>Motif en cas d’échec<input className="input" value={reasons[d.id] || ""} onChange={(e) => setReasons((v) => ({ ...v, [d.id]: e.target.value }))} placeholder="Ex. : destinataire absent" /></label>}
              {d.status === "AWAITING_CONFIRMATION" && <p className="alert alert-info" style={{ marginTop: 12 }}>En attente de la confirmation du patient. Ne marquez pas la commande comme livrée vous-même.</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {(NEXT[d.status] || []).map((action) => <button key={action.type} className="btn btn-primary" disabled={busy === d.id} onClick={() => void update(d, action.type)}>{busy === d.id ? "Mise à jour…" : action.label}</button>)}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
