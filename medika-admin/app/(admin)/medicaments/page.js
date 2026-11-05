'use client';

/**
 * « Médicaments et pharmacies » — internal operations area (issue #83).
 *
 * Operations queue for medication requests: new requests, overdue requests
 * (30-minute SLA target measured from the REQUEST timestamp), quotes
 * awaiting patient review, and exceptions (escalated orders, expired quotes,
 * quotes with unavailable items). Plus the partner pharmacy directory —
 * pharmacies are contacted MANUALLY via WhatsApp; there is no pharmacy
 * login, no portal and no stored credential.
 *
 * All copy is French (issue #83). Totals are server-recomputed; the agent
 * never types a total.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pill, RefreshCw, Store } from 'lucide-react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';
import OrderDetailModal from './order-detail';

const TABS = [
  { key: 'new', label: 'Nouvelles demandes' },
  { key: 'overdue', label: 'En retard' },
  { key: 'quotes', label: 'Devis en attente' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'pharmacies', label: 'Annuaire des pharmacies' },
];

const STATUS_BADGES = {
  REQUESTED: { cls: 'badge-blue', label: 'Nouvelle demande' },
  ESCALATED: { cls: 'badge-red', label: 'En retard' },
  QUOTED: { cls: 'badge-yellow', label: 'Devis à consulter' },
  ACCEPTED: { cls: 'badge-green', label: 'Devis accepté' },
  DECLINED: { cls: 'badge-gray', label: 'Devis refusé' },
  CANCELLED: { cls: 'badge-gray', label: 'Annulée' },
  EXPIRED: { cls: 'badge-red', label: 'Devis expiré' },
};

/** Remaining / overdue time vs the 30-minute SLA target (server deadline). */
function slaDisplay(order) {
  if (!order.sla_deadline_at) return null;
  const diffMin = Math.round((order.sla_deadline_at * 1000 - Date.now()) / 60000);
  if (order.status === 'REQUESTED') {
    return diffMin >= 0 ? `SLA : ${diffMin} min restantes` : `SLA dépassé de ${Math.abs(diffMin)} min`;
  }
  if (order.status === 'ESCALATED') {
    return `En retard de ${Math.max(1, Math.abs(diffMin))} min`;
  }
  return `Échéance : ${formatDate(order.sla_deadline_at)}`;
}

export default function MedicamentsPage() {
  const [tab, setTab] = useState('new');
  const [orders, setOrders] = useState(null);
  const [pharmacies, setPharmacies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openOrder, setOpenOrder] = useState(null); // order id for the modal
  const [pharmacyModal, setPharmacyModal] = useState(null); // {} for create, pharmacy for edit
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async (currentTab) => {
    setLoading(true);
    try {
      if (currentTab === 'pharmacies') {
        const list = await apiFetch('/admin/pharmacies');
        setPharmacies(list);
      } else {
        const list = await apiFetch(`/admin/medication-orders?bucket=${currentTab}`);
        setOrders(list);
      }
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  // Light auto-refresh: the SLA countdown and the buckets are time-sensitive.
  useEffect(() => {
    const id = setInterval(() => load(tab), 30_000);
    return () => clearInterval(id);
  }, [tab, load]);

  const switchTab = (key) => {
    setTab(key);
    if (key === 'pharmacies') setOrders(null);
    else setPharmacies(null);
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Médicaments et pharmacies</h1>
          <p style={{ fontSize: 13, color: 'var(--mk-text-secondary)', marginTop: 4 }}>
            File des demandes de médicaments : contactez une pharmacie partenaire par WhatsApp,
            enregistrez sa réponse confirmée, et le patient consulte le devis. Objectif opérationnel :
            30 minutes à partir de la demande du patient (cible de service, pas une garantie).
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => load(tab)} disabled={loading}>
          <RefreshCw size={16} /> Rafraîchir
        </button>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="empty-state">
          <p>Impossible de charger : {error}</p>
          <button className="btn btn-primary" onClick={() => load(tab)}>Réessayer</button>
        </div>
      )}

      {/* ── Operations queue ── */}
      {tab !== 'pharmacies' && !error && (
        <div className="card">
          {loading && !orders ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>
          ) : (orders || []).length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <Pill size={28} style={{ color: 'var(--mk-text-secondary)', marginBottom: 8 }} aria-hidden />
              <p>Aucune demande dans cette file pour le moment.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Patient</th>
                  <th>Ordonnance</th>
                  <th>Demande</th>
                  <th>Délai opérationnel</th>
                  <th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Devis</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const badge = STATUS_BADGES[o.status] || { cls: 'badge-gray', label: o.status };
                  return (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 600 }}>{o.reference}</td>
                      <td>{o.patient_name || '—'}</td>
                      <td>{o.prescription_reference || '—'}</td>
                      <td>{formatDate(o.requested_at)}</td>
                      <td style={{ fontSize: 12 }}>{slaDisplay(o)}</td>
                      <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        {o.quote ? (
                          <>
                            {formatCurrency(o.quote.total_htg)}
                            {o.quote.has_unavailable_items && (
                              <span className="badge badge-yellow" style={{ marginLeft: 6 }}>rupture</span>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setOpenOrder(o.id)}>
                          Ouvrir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Pharmacy directory ── */}
      {tab === 'pharmacies' && !error && (
        <div className="card">
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Store size={16} /> Pharmacies partenaires
              </h2>
              <p style={{ fontSize: 12, color: 'var(--mk-text-secondary)', marginTop: 4 }}>
                Annuaire interne de contact — aucune pharmacie ne se connecte à Medika ; la communication
                se fait par WhatsApp. Aucune donnée d&apos;identification n&apos;est stockée.
              </p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setPharmacyModal({})}>
              Ajouter une pharmacie
            </button>
          </div>
          {loading && !pharmacies ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>
          ) : (pharmacies || []).length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <p>Aucune pharmacie partenaire enregistrée pour le moment.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Contact</th>
                  <th>WhatsApp</th>
                  <th>Localisation</th>
                  <th>Statut</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pharmacies.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.contact_name || '—'}</td>
                    <td>{p.whatsapp_number}</td>
                    <td>{p.location || '—'}</td>
                    <td>
                      <span className={`badge ${p.active ? 'badge-green' : 'badge-gray'}`}>
                        {p.active ? 'Active' : 'Archivée'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setPharmacyModal(p)}>
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Order detail / quote recording ── */}
      {openOrder && (
        <OrderDetailModal
          orderId={openOrder}
          pharmacies={pharmacies || []}
          onClose={() => setOpenOrder(null)}
          onSaved={() => load(tab)}
        />
      )}

      {/* ── Pharmacy create/edit modal ── */}
      {pharmacyModal && (
        <PharmacyModal
          pharmacy={pharmacyModal.id ? pharmacyModal : null}
          onClose={() => setPharmacyModal(null)}
          onSaved={() => { setPharmacyModal(null); load('pharmacies'); }}
          showToast={showToast}
        />
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/** Pharmacy directory create/edit modal — allowlisted fields only (no
 *  credential can be entered because no such field exists here). */
function PharmacyModal({ pharmacy, onClose, onSaved, showToast }) {
  const [name, setName] = useState(pharmacy?.name || '');
  const [contactName, setContactName] = useState(pharmacy?.contact_name || '');
  const [whatsapp, setWhatsapp] = useState(pharmacy?.whatsapp_number || '');
  const [location, setLocation] = useState(pharmacy?.location || '');
  const [notes, setNotes] = useState(pharmacy?.notes || '');
  const [active, setActive] = useState(pharmacy ? Boolean(pharmacy.active) : true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        contact_name: contactName.trim(),
        whatsapp_number: whatsapp.trim(),
        location: location.trim(),
        notes: notes.trim(),
        active,
      };
      if (pharmacy) {
        await apiFetch(`/admin/pharmacies/${encodeURIComponent(pharmacy.id)}`, { method: 'PUT', body: JSON.stringify(body) });
        showToast('Pharmacie mise à jour.');
      } else {
        await apiFetch('/admin/pharmacies', { method: 'POST', body: JSON.stringify(body) });
        showToast('Pharmacie ajoutée à l’annuaire.');
      }
      onSaved();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--mk-brand)' }}>
            {pharmacy ? 'Modifier la pharmacie' : 'Ajouter une pharmacie partenaire'}
          </h2>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="ph-name">Nom de la pharmacie</label>
            <input id="ph-name" className="form-input" type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ph-contact">Personne de contact (optionnelle)</label>
            <input id="ph-contact" className="form-input" type="text" maxLength={120} value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ph-wa">Numéro WhatsApp (avec indicatif pays)</label>
            <input id="ph-wa" className="form-input" type="text" maxLength={30} placeholder="+509 37 00 00 00" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ph-loc">Localisation (optionnelle)</label>
            <input id="ph-loc" className="form-input" type="text" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} disabled={saving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ph-notes">Notes internes (optionnelles)</label>
            <textarea id="ph-notes" className="form-input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={saving} />
            Pharmacie active (proposée dans la sélection)
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
