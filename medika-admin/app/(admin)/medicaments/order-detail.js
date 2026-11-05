'use client';

/**
 * Order detail modal — « Médicaments et pharmacies » operations (issue #83).
 *
 * Shows the READ-ONLY prescription snapshot (the clinical document is never
 * editable from here — quote entry cannot touch it), the WhatsApp handoff
 * for the selected partner pharmacy, the quote recording form (itemized
 * availability + integer HTG prices recomputed server-side), the
 * « pharmacie injoignable » recording, the quote history and the audit
 * events. All copy is French.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, PhoneOff, Save } from 'lucide-react';
import { apiFetch, formatDate, formatCurrency } from '../../../lib/api';

const AVAILABILITY_OPTIONS = [
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'PARTIAL', label: 'Stock partiel' },
  { value: 'UNAVAILABLE', label: 'Indisponible' },
];

function defaultExpiryLocalValue() {
  // +48 h, local time, for <input type="datetime-local">.
  const d = new Date(Date.now() + 48 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One form row per prescribed item (1:1 mapping — no substitution). */
function QuoteItemRow({ item, index, value, onChange }) {
  const unavailable = value.availability === 'UNAVAILABLE';
  return (
    <div style={{ border: '1px solid var(--mk-border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>
          {index + 1}. {[item.name, item.strength, item.form ? `(${item.form})` : null].filter(Boolean).join(' ')}
        </strong>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 160, padding: '6px 8px' }}
          value={value.availability}
          onChange={(e) => onChange({ ...value, availability: e.target.value })}
          aria-label={`Disponibilité de ${item.name}`}
        >
          {AVAILABILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {item.quantity_prescribed && (
        <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', marginTop: 2 }}>
          Prescrit : {item.quantity_prescribed}
        </div>
      )}
      {!unavailable ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12 }}>
            Prix unitaire (HTG)
            <input
              className="form-input"
              type="number"
              min="1"
              step="1"
              value={value.unit_price_htg}
              onChange={(e) => onChange({ ...value, unit_price_htg: e.target.value })}
              style={{ width: 120, display: 'block', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Quantité confirmée
            <input
              className="form-input"
              type="number"
              min="1"
              step="1"
              value={value.quantity}
              onChange={(e) => onChange({ ...value, quantity: e.target.value })}
              style={{ width: 120, display: 'block', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 12, flex: 1, minWidth: 180 }}>
            Précision sur le stock (optionnelle)
            <input
              className="form-input"
              type="text"
              maxLength={120}
              placeholder="ex. : 8 comprimés sur 15"
              value={value.offered_quantity}
              onChange={(e) => onChange({ ...value, offered_quantity: e.target.value })}
              style={{ display: 'block', marginTop: 2 }}
            />
          </label>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', marginTop: 6 }}>
          Aucun prix n&apos;est saisi pour un médicament indisponible — aucune substitution n&apos;est
          enregistrée ici (l&apos;accord du prescripteur est requis).
        </div>
      )}
    </div>
  );
}

export default function OrderDetailModal({ orderId, pharmacies, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [pharmacyId, setPharmacyId] = useState('');
  const [rows, setRows] = useState({});
  const [expiresAt, setExpiresAt] = useState(defaultExpiryLocalValue);
  const [notes, setNotes] = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async (targetPharmacyId) => {
    setLoading(true);
    try {
      const qs = targetPharmacyId ? `?pharmacy_id=${encodeURIComponent(targetPharmacyId)}` : '';
      const d = await apiFetch(`/admin/medication-orders/${encodeURIComponent(orderId)}${qs}`);
      setDetail(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  // Initial load: preselect the active quote's pharmacy or the first active one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await load('');
      if (!d || !alive) return;
      const quotedPharmacy = d.quotes && d.quotes.length > 0 ? d.quotes[0].pharmacy.id : null;
      const firstActive = (pharmacies || []).find((p) => p.active);
      const preselect = quotedPharmacy || firstActive?.id || '';
      setPharmacyId(preselect);
      if (preselect) await load(preselect);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, load]);

  // Keep the quote rows in sync with the prescription items.
  useEffect(() => {
    if (!detail?.prescription) return;
    setRows((prev) => {
      const next = {};
      detail.prescription.items.forEach((item, i) => {
        next[i] = prev[i] || { availability: 'AVAILABLE', unit_price_htg: '', quantity: '', offered_quantity: '' };
      });
      return next;
    });
  }, [detail]);

  const selectPharmacy = async (id) => {
    setPharmacyId(id);
    if (id) await load(id);
  };

  const buildPayload = () => {
    const items = detail.prescription.items.map((item, i) => {
      const row = rows[i] || { availability: 'AVAILABLE' };
      const base = { prescription_index: i, availability: row.availability };
      if (row.availability !== 'UNAVAILABLE') {
        base.unit_price_htg = Number.parseInt(row.unit_price_htg, 10);
        base.quantity = Number.parseInt(row.quantity, 10);
        if (row.offered_quantity && row.offered_quantity.trim()) {
          base.offered_quantity = row.offered_quantity.trim();
        }
      }
      return base;
    });
    const payload = {
      pharmacy_id: pharmacyId,
      items,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    };
    if (notes.trim()) payload.notes = notes.trim();
    return payload;
  };

  const validate = () => {
    if (!pharmacyId) return 'Sélectionnez la pharmacie contactée.';
    if (!expiresAt) return "L'expiration du devis est requise.";
    for (let i = 0; i < detail.prescription.items.length; i += 1) {
      const row = rows[i] || {};
      if (row.availability === 'UNAVAILABLE') continue;
      const price = Number.parseInt(row.unit_price_htg, 10);
      const qty = Number.parseInt(row.quantity, 10);
      if (!Number.isInteger(price) || price <= 0) {
        return `Prix unitaire (entier HTG) requis pour « ${detail.prescription.items[i].name} ».`;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return `Quantité confirmée requise pour « ${detail.prescription.items[i].name} ».`;
      }
    }
    return null;
  };

  const saveQuote = async () => {
    if (saving) return;
    const problem = validate();
    if (problem) {
      showToast(problem, 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch(`/admin/medication-orders/${encodeURIComponent(orderId)}/quotes`, {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      showToast(`Devis enregistré : ${formatCurrency(saved.total_htg)} — le patient est notifié.`);
      await load(pharmacyId);
      if (onSaved) onSaved();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const recordUnreachable = async () => {
    if (saving) return;
    if (!pharmacyId) {
      showToast('Sélectionnez la pharmacie tentée.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/admin/medication-orders/${encodeURIComponent(orderId)}/unreachable`, {
        method: 'POST',
        body: JSON.stringify({ pharmacy_id: pharmacyId, notes: 'Pharmacie injoignable (enregistré depuis la file).' }),
      });
      showToast('Tentative enregistrée dans l’historique — le délai SLA continue de courir.', 'error');
      await load(pharmacyId);
      if (onSaved) onSaved();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: 860, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--mk-brand)' }}>
            {loading || !detail ? 'Demande…' : `Demande ${detail.reference}`}
          </h2>
        </div>
        <div className="modal-body">
          {error && <div className="empty-state"><p>Impossible de charger : {error}</p></div>}
          {loading && !detail && <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>}

          {detail && (
            <>
              {/* ── Order summary ── */}
              <div style={{ fontSize: 13, marginBottom: 14, display: 'grid', gap: 4 }}>
                <div><strong>Patient :</strong> {detail.patient_name || '—'}</div>
                <div><strong>Adresse de livraison :</strong> {detail.delivery_address || '—'}</div>
                <div><strong>Téléphone :</strong> {detail.delivery_phone || '—'}</div>
                <div><strong>Quartier / zone :</strong> {detail.delivery_zone || '—'}</div>
                <div><strong>Statut :</strong> {detail.status_label_fr || detail.status}</div>
                {detail.payment && <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--mk-border)', borderRadius: 8 }}><strong>Paiement MonCash :</strong> {detail.payment.status === 'PAID' ? 'Confirmé' : detail.payment.status === 'PENDING' ? 'En attente' : detail.payment.status === 'REVIEW' ? 'À vérifier manuellement' : 'Échoué'}<div>Montant vérifié : {detail.payment.verified_amount_htg ?? detail.payment.amount_htg} HTG</div><div>Référence : {detail.payment.payment_reference}</div>{detail.payment.transaction_id && <div>Transaction : {detail.payment.transaction_id}</div>}</div>}
                <div><strong>Demande créée :</strong> {formatDate(detail.requested_at)}</div>
                <div>
                  <strong>Échéance opérationnelle (SLA 30 min) :</strong> {formatDate(detail.sla_deadline_at)}
                  {detail.sla_state === 'ESCALATED' && (
                    <span className="badge badge-red" style={{ marginLeft: 8 }}>En retard</span>
                  )}
                </div>
              </div>

              {/* ── Read-only prescription snapshot ── */}
              <div style={{ border: '1px solid var(--mk-border)', borderRadius: 8, padding: 12, marginBottom: 16, background: 'var(--mk-bg-soft, #fafafa)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Ordonnance à sourcer (lecture seule)</h3>
                  <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                    {detail.prescription?.reference} — {detail.prescription?.doctor_name || ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--mk-text-secondary)', margin: '6px 0 8px' }}>
                  Le document clinique n&apos;est jamais modifiable depuis les opérations.
                </p>
                {(detail.prescription?.items || []).map((item, i) => (
                  <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px dashed var(--mk-border)' }}>
                    <strong>{i + 1}. {[item.name, item.strength, item.form ? `(${item.form})` : null].filter(Boolean).join(' ')}</strong>
                    {item.quantity ? (
                      <span style={{ color: 'var(--mk-text-secondary)' }}> — quantité : {item.quantity}</span>
                    ) : null}
                    {item.dose ? <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Prise : {item.dose}{item.frequency ? ` · ${item.frequency}` : ''}{item.duration ? ` · ${item.duration}` : ''}</div> : null}
                  </div>
                ))}
                {detail.prescription?.general_instructions ? (
                  <div style={{ fontSize: 12, marginTop: 8, color: 'var(--mk-text-secondary)' }}>
                    Instructions générales : {detail.prescription.general_instructions}
                  </div>
                ) : null}
              </div>

              {/* ── WhatsApp handoff ── */}
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Contact pharmacie (WhatsApp)</h3>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, flex: 1, minWidth: 220 }}>
                    Pharmacie partenaire
                    <select
                      className="form-input"
                      value={pharmacyId}
                      onChange={(e) => selectPharmacy(e.target.value)}
                      style={{ display: 'block', marginTop: 2 }}
                    >
                      <option value="">— Sélectionner —</option>
                      {(pharmacies || []).map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.active}>
                          {p.name}{p.active ? '' : ' (archivée)'}
                        </option>
                      ))}
                    </select>
                  </label>
                  {detail.whatsapp?.url ? (
                    <a className="btn btn-primary" href={detail.whatsapp.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} /> Ouvrir WhatsApp
                    </a>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                      Sélectionnez une pharmacie pour préparer le message WhatsApp.
                    </span>
                  )}
                  <button className="btn btn-danger-soft btn-sm" onClick={recordUnreachable} disabled={saving}>
                    <PhoneOff size={14} /> Pharmacie injoignable
                  </button>
                </div>
                {detail.whatsapp?.message && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--mk-text-secondary)' }}>
                      Aperçu du message envoyé (sans donnée du patient)
                    </summary>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'var(--mk-bg-soft, #fafafa)', padding: 10, borderRadius: 8, marginTop: 6 }}>
                      {detail.whatsapp.message}
                    </pre>
                  </details>
                )}
              </div>

              {/* ── Quote recording ── */}
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                {detail.quotes && detail.quotes.length > 0 ? 'Nouveau devis (remplace le précédent)' : 'Enregistrer la réponse de la pharmacie'}
              </h3>
              {(detail.prescription?.items || []).map((item, i) => (
                <QuoteItemRow
                  key={i}
                  item={item}
                  index={i}
                  value={rows[i] || { availability: 'AVAILABLE', unit_price_htg: '', quantity: '', offered_quantity: '' }}
                  onChange={(v) => setRows((prev) => ({ ...prev, [i]: v }))}
                />
              ))}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                <label style={{ fontSize: 12 }}>
                  Expiration du devis
                  <input
                    className="form-input"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    style={{ display: 'block', marginTop: 2 }}
                  />
                </label>
              </div>
              <label style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                Notes internes (optionnelles)
                <textarea
                  className="form-input"
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ display: 'block', marginTop: 2, width: '100%' }}
                />
              </label>
              <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', marginTop: 6 }}>
                Les totaux sont recalculés par le serveur à partir des lignes — aucun total saisi n&apos;est
                pris en compte. Chaque médicament prescrit doit apparaître exactement une fois.
              </div>

              {/* ── Quote history ── */}
              {detail.quotes && detail.quotes.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>Historique des devis</h3>
                  {detail.quotes.map((q) => (
                    <div key={q.id} style={{ border: '1px solid var(--mk-border)', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                        <strong>{q.pharmacy.name}</strong>
                        <span>{formatCurrency(q.total_htg)}{q.superseded_at ? ' — remplacé' : ' — actif'}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', marginTop: 2 }}>
                        Enregistré par {q.agent_name || '—'} le {formatDate(q.confirmed_at)} · valable jusqu&apos;au {formatDate(q.expires_at)}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* ── Audit events ── */}
              {detail.events && detail.events.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: '16px 0 6px' }}>Historique des opérations</h3>
                  {detail.events.map((ev) => (
                    <div key={ev.id} style={{ fontSize: 12, padding: '4px 0', color: 'var(--mk-text-secondary)' }}>
                      {formatDate(ev.created_at)} — <strong style={{ color: 'var(--mk-text)' }}>{ev.event_type}</strong>
                      {' '}par {ev.actor?.name || '—'} ({ev.actor?.role || '—'})
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Fermer</button>
          <button className="btn btn-primary" onClick={saveQuote} disabled={saving || loading || !detail}>
            <Save size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer le devis'}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 80 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
