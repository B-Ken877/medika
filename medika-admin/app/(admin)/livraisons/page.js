'use client';

/**
 * « Livraisons » — Medika-owned delivery operations (consolidated issue #82
 * §7). Admin-only area:
 *
 *  - Livraisons: every delivery with its custody history and internal
 *    expenses (delivery is FREE to the patient — expenses are Medika's own
 *    cost ledger, never a patient charge).
 *  - Affectation: assign a server-verified PAID medication order to an
 *    active employee in the order's validated active zone. Regular
 *    scheduling is Friday; another date requires the urgent exception with
 *    a written reason (server-enforced).
 *  - Zones desservies: explicit coverage records — nothing is serviceable
 *    until activated here (fail-closed by construction).
 *  - Livreurs: employee accounts are provisioned and disabled HERE only
 *    (public registration stays patient-only).
 *  - Rapports: weekly/monthly counts, delivered/failed, internal cost,
 *    cost per successful delivery, monthly budget + threshold alert
 *    (explicit Haiti-local boundaries handled server-side).
 *
 * All copy is French; the page reuses the admin design system.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Truck, MapPin, Users, BarChart3 } from 'lucide-react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';

const STATUS_BADGES = {
  ASSIGNED: { cls: 'badge-blue', label: 'Affectée' },
  PHARMACY_PREPARING: { cls: 'badge-blue', label: 'Préparation en pharmacie' },
  READY_FOR_PICKUP: { cls: 'badge-yellow', label: 'Prête au retrait' },
  PICKED_UP: { cls: 'badge-yellow', label: 'Récupérée' },
  OUT_FOR_DELIVERY: { cls: 'badge-green', label: 'En livraison' },
  AWAITING_CONFIRMATION: { cls: 'badge-yellow', label: 'Confirmation patient en attente' },
  DELIVERED: { cls: 'badge-green', label: 'Livrée' },
  FAILED_ATTEMPT: { cls: 'badge-red', label: 'Tentative échouée' },
  RETURNED_ESCALATED: { cls: 'badge-red', label: 'Retournée / escaladée' },
};

const EVENT_LABELS = {
  ASSIGNED: 'Affectée', PHARMACY_PREPARING: 'Préparation en pharmacie',
  READY_FOR_PICKUP: 'Prête au retrait', PICKED_UP: 'Récupérée',
  OUT_FOR_DELIVERY: 'En livraison', AWAITING_CONFIRMATION: 'Remise au patient — en attente',
  DELIVERED: 'Livrée (confirmée par le patient)', FAILED_ATTEMPT: 'Tentative échouée',
  RETURNED_ESCALATED: 'Retournée / escaladée',
};

const TABS = [
  { key: 'deliveries', label: 'Livraisons', icon: Truck },
  { key: 'assign', label: 'Affecter une commande', icon: RefreshCw },
  { key: 'zones', label: 'Zones desservies', icon: MapPin },
  { key: 'employees', label: 'Livreurs', icon: Users },
  { key: 'reports', label: 'Rapports & budget', icon: BarChart3 },
];

/** Next Friday (Haiti-local) — the default regular delivery date. */
function nextFriday() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = fmt.formatToParts(new Date());
  const d = new Date(p.find((x) => x.type === 'year').value + '-' + p.find((x) => x.type === 'month').value + '-' + p.find((x) => x.type === 'day').value + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 5);
  return d.toISOString().slice(0, 10);
}

function Badge({ status }) {
  const b = STATUS_BADGES[status] || { cls: 'badge-gray', label: status };
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

export default function LivraisonsPage() {
  const [tab, setTab] = useState('deliveries');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [deliveries, setDeliveries] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState(null);
  const [expenseDraft, setExpenseDraft] = useState({ amount_htg: '', category: 'TRANSPORT', notes: '' });

  const [paidOrders, setPaidOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [zones, setZones] = useState([]);
  const [assignForm, setAssignForm] = useState({ medication_order_id: '', employee_id: '', zone_id: '', scheduled_for: nextFriday(), urgent: false, urgent_reason: '' });

  const [zoneForm, setZoneForm] = useState({ city: 'Port-au-Prince', zone_name: '' });
  const [employeeForm, setEmployeeForm] = useState({ username: '', name: '', phone: '', password: '' });
  const [report, setReport] = useState(null);
  const [budgetForm, setBudgetForm] = useState({ monthly_budget_htg: '', alert_threshold_percent: 80 });

  const flash = (message) => { setNotice(message); setError(null); };

  const loadCore = useCallback(async () => {
    const [dl, em, zo] = await Promise.all([
      apiFetch(`/admin/deliveries${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`),
      apiFetch('/admin/delivery-employees'),
      apiFetch('/admin/delivery-zones'),
    ]);
    setDeliveries(dl); setEmployees(em); setZones(zo);
  }, [statusFilter]);

  const loadAssignables = useCallback(async () => {
    const all = await apiFetch('/admin/medication-orders?bucket=all');
    setPaidOrders(all.filter((o) => o.status === 'PAID'));
  }, []);

  const loadReport = useCallback(async () => {
    const r = await apiFetch('/admin/delivery-reports');
    setReport(r);
    if (r.budget) setBudgetForm({ monthly_budget_htg: String(r.budget.monthly_budget_htg), alert_threshold_percent: r.budget.alert_threshold_percent });
  }, []);

  useEffect(() => {
    if (tab === 'reports') { loadReport().catch((e) => setError(e.message)); return; }
    if (tab === 'assign') { loadCore().catch((e) => setError(e.message)); loadAssignables().catch((e) => setError(e.message)); return; }
    loadCore().catch((e) => setError(e.message));
  }, [tab, loadCore, loadAssignables, loadReport]);

  const run = async (action, okMessage) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await action();
      if (okMessage) flash(okMessage);
    } catch (e) {
      setError(e.message || 'L’opération a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (d) => run(async () => {
    setDetail(await apiFetch(`/admin/deliveries/${encodeURIComponent(d.id)}`));
    setExpenseDraft({ amount_htg: '', category: 'TRANSPORT', notes: '' });
  });

  const assignDelivery = () => run(async () => {
    await apiFetch('/admin/deliveries/assign', {
      method: 'POST',
      body: JSON.stringify({
        medication_order_id: assignForm.medication_order_id,
        employee_id: assignForm.employee_id,
        zone_id: assignForm.zone_id,
        scheduled_for: assignForm.scheduled_for,
        urgent: assignForm.urgent,
        urgent_reason: assignForm.urgent_reason,
      }),
    });
    setAssignForm({ medication_order_id: '', employee_id: '', zone_id: '', scheduled_for: nextFriday(), urgent: false, urgent_reason: '' });
    await Promise.all([loadCore(), loadAssignables()]);
  }, 'Livraison affectée. Le patient a été notifié.');

  const addExpense = () => run(async () => {
    await apiFetch(`/admin/deliveries/${encodeURIComponent(detail.id)}/expenses`, {
      method: 'POST',
      body: JSON.stringify({ amount_htg: parseInt(expenseDraft.amount_htg, 10), category: expenseDraft.category, notes: expenseDraft.notes }),
    });
    setDetail(await apiFetch(`/admin/deliveries/${encodeURIComponent(detail.id)}`));
    setExpenseDraft({ amount_htg: '', category: 'TRANSPORT', notes: '' });
    flash('Dépense interne enregistrée.');
  }, null);

  const saveZone = (active) => run(async () => {
    await apiFetch('/admin/delivery-zones', {
      method: 'POST',
      body: JSON.stringify({ city: zoneForm.city, zone_name: zoneForm.zone_name, active }),
    });
    setZoneForm({ city: 'Port-au-Prince', zone_name: '' });
    await loadCore();
  }, active ? 'Zone activée : elle est maintenant proposée aux patients.' : 'Zone enregistrée (inactive).');

  const toggleZone = (zone) => run(async () => {
    await apiFetch('/admin/delivery-zones', {
      method: 'POST',
      body: JSON.stringify({ id: zone.id, city: zone.city, zone_name: zone.zone_name, active: !zone.active }),
    });
    await loadCore();
  }, null);

  const createEmployee = () => run(async () => {
    await apiFetch('/admin/delivery-employees', {
      method: 'POST',
      body: JSON.stringify(employeeForm),
    });
    setEmployeeForm({ username: '', name: '', phone: '', password: '' });
    await loadCore();
  }, 'Compte livreur créé. Transmettez-lui ses identifiants de façon sécurisée.');

  const toggleEmployee = (employee) => run(async () => {
    await apiFetch(`/admin/delivery-employees/${encodeURIComponent(employee.id)}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ is_available: !employee.is_available }),
    });
    await loadCore();
  }, null);

  const saveBudget = () => run(async () => {
    await apiFetch('/admin/delivery-budget', {
      method: 'PUT',
      body: JSON.stringify({ monthly_budget_htg: parseInt(budgetForm.monthly_budget_htg, 10), alert_threshold_percent: parseInt(budgetForm.alert_threshold_percent, 10) }),
    });
    await loadReport();
  }, 'Budget enregistré.');

  const selectedOrder = useMemo(() => paidOrders.find((o) => o.id === assignForm.medication_order_id) || null, [paidOrders, assignForm.medication_order_id]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Livraisons Medika</h1>
          <p className="small" style={{ color: 'var(--gray-600, #5b7470)' }}>
            Collecte en pharmacie partenaire et livraison par l’équipe Medika. La livraison est offerte au patient :
            les dépenses ci-dessous sont des coûts internes, jamais des frais facturés.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>
            <Icon size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} /> {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {tab === 'deliveries' && (
        <section className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <select className="input" style={{ maxWidth: 280 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS_BADGES).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={() => loadCore().catch((e) => setError(e.message))} disabled={busy}>Actualiser</button>
          </div>
          {deliveries.length === 0 ? (
            <p className="small">Aucune livraison pour ce filtre.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {deliveries.map((d) => (
                <div key={d.id} style={{ border: '1px solid var(--gray-200, #dbe7e3)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <strong>{d.reference}</strong>
                      <span className="tiny" style={{ marginLeft: 8 }}>{d.patient_name} — {d.delivery_zone}, {d.city}</span>
                      <div className="tiny" style={{ color: 'var(--gray-600, #5b7470)' }}>
                        {d.urgent ? 'Urgente — ' : ''}Prévue le {d.scheduled_for} · Pharmacie : {d.pickup_pharmacy_name}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Badge status={d.status} />
                      <button className="btn btn-secondary" onClick={() => openDetail(d)} disabled={busy}>Détail</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'assign' && (
        <section className="card" style={{ padding: 16, maxWidth: 640 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Affecter une commande payée</h2>
          <p className="small" style={{ color: 'var(--gray-600, #5b7470)' }}>
            Seules les commandes avec paiement MonCash vérifié peuvent être affectées. La livraison régulière a lieu
            le vendredi ; pour une autre date, cochez l’exception urgente et justifiez (obligatoire, audité).
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <label className="small">Commande (PAID vérifié)
              <select className="input" value={assignForm.medication_order_id} onChange={(e) => setAssignForm((f) => ({ ...f, medication_order_id: e.target.value, zone_id: '' }))}>
                <option value="">— Sélectionnez une commande payée —</option>
                {paidOrders.map((o) => <option key={o.id} value={o.id}>{o.reference} — {o.patient_name} ({o.delivery_zone}, {o.delivery_city})</option>)}
              </select>
            </label>
            {selectedOrder && (
              <p className="tiny" style={{ color: 'var(--gray-600, #5b7470)' }}>
                Zone validée à la commande : {selectedOrder.delivery_zone}, {selectedOrder.delivery_city}. La zone doit être active.
              </p>
            )}
            <label className="small">Livreur (actif)
              <select className="input" value={assignForm.employee_id} onChange={(e) => setAssignForm((f) => ({ ...f, employee_id: e.target.value }))}>
                <option value="">— Sélectionnez un livreur —</option>
                {employees.filter((e) => e.is_available).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.username})</option>)}
              </select>
            </label>
            <label className="small">Zone de livraison
              <select className="input" value={assignForm.zone_id} onChange={(e) => setAssignForm((f) => ({ ...f, zone_id: e.target.value }))}>
                <option value="">— Sélectionnez la zone de la commande —</option>
                {zones.filter((z) => z.active).map((z) => <option key={z.id} value={z.id}>{z.zone_name} — {z.city}</option>)}
              </select>
            </label>
            <label className="small">Date de livraison
              <input className="input" type="date" value={assignForm.scheduled_for} onChange={(e) => setAssignForm((f) => ({ ...f, scheduled_for: e.target.value }))} />
            </label>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={assignForm.urgent} onChange={(e) => setAssignForm((f) => ({ ...f, urgent: e.target.checked }))} />
              Exception urgente (hors vendredi — justification obligatoire)
            </label>
            {assignForm.urgent && (
              <label className="small">Justification de l’urgence
                <textarea className="input" rows={2} maxLength={500} value={assignForm.urgent_reason} onChange={(e) => setAssignForm((f) => ({ ...f, urgent_reason: e.target.value }))} placeholder="Ex. : patient sous antibiotiques sans médicaments depuis 48h" />
              </label>
            )}
            <button className="btn btn-primary" onClick={assignDelivery} disabled={busy || !assignForm.medication_order_id || !assignForm.employee_id || !assignForm.zone_id || (assignForm.urgent && assignForm.urgent_reason.trim().length < 8)}>
              Affecter la livraison
            </button>
          </div>
        </section>
      )}

      {tab === 'zones' && (
        <section className="card" style={{ padding: 16, maxWidth: 640 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Zones desservies</h2>
          <p className="small" style={{ color: 'var(--gray-600, #5b7470)' }}>
            Une zone inactive n’est jamais proposée aux patients et toute demande y échoue (fermeture par défaut).
            Aucun appariement de texte libre ne peut activer une couverture.
          </p>
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {zones.map((z) => (
              <div key={z.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', border: '1px solid var(--gray-200, #dbe7e3)', borderRadius: 10, padding: 10 }}>
                <div><strong>{z.zone_name}</strong> <span className="tiny">— {z.city}</span></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${z.active ? 'badge-green' : 'badge-gray'}`}>{z.active ? 'Active' : 'Inactive'}</span>
                  <button className="btn btn-secondary" onClick={() => toggleZone(z)} disabled={busy}>{z.active ? 'Désactiver' : 'Activer'}</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--gray-200, #dbe7e3)', paddingTop: 12 }}>
            <label className="small">Ville
              <input className="input" value={zoneForm.city} onChange={(e) => setZoneForm((f) => ({ ...f, city: e.target.value }))} maxLength={100} />
            </label>
            <label className="small">Nom de la zone / quartier
              <input className="input" value={zoneForm.zone_name} onChange={(e) => setZoneForm((f) => ({ ...f, zone_name: e.target.value }))} maxLength={100} placeholder="Ex. : Delmas" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => saveZone(true)} disabled={busy || !zoneForm.zone_name.trim()}>Créer et activer</button>
              <button className="btn btn-secondary" onClick={() => saveZone(false)} disabled={busy || !zoneForm.zone_name.trim()}>Créer inactive</button>
            </div>
          </div>
        </section>
      )}

      {tab === 'employees' && (
        <section className="card" style={{ padding: 16, maxWidth: 640 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Livreurs</h2>
          <p className="small" style={{ color: 'var(--gray-600, #5b7470)' }}>
            Les comptes livreur sont créés ici uniquement. L’inscription publique reste réservée aux patients.
          </p>
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {employees.map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', border: '1px solid var(--gray-200, #dbe7e3)', borderRadius: 10, padding: 10 }}>
                <div><strong>{e.name}</strong> <span className="tiny">— {e.username} {e.phone ? `· ${e.phone}` : ''}</span></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${e.is_available ? 'badge-green' : 'badge-gray'}`}>{e.is_available ? 'Disponible' : 'Désactivé'}</span>
                  <button className="btn btn-secondary" onClick={() => toggleEmployee(e)} disabled={busy}>{e.is_available ? 'Désactiver' : 'Réactiver'}</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--gray-200, #dbe7e3)', paddingTop: 12 }}>
            <label className="small">Nom complet
              <input className="input" value={employeeForm.name} onChange={(e) => setEmployeeForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} />
            </label>
            <label className="small">Identifiant de connexion (3 à 40 caractères)
              <input className="input" value={employeeForm.username} onChange={(e) => setEmployeeForm((f) => ({ ...f, username: e.target.value }))} maxLength={40} placeholder="ex. : livreur3" />
            </label>
            <label className="small">Téléphone
              <input className="input" value={employeeForm.phone} onChange={(e) => setEmployeeForm((f) => ({ ...f, phone: e.target.value }))} maxLength={40} placeholder="+509 …" />
            </label>
            <label className="small">Mot de passe initial (12 caractères minimum)
              <input className="input" type="password" value={employeeForm.password} onChange={(e) => setEmployeeForm((f) => ({ ...f, password: e.target.value }))} maxLength={200} />
            </label>
            <button className="btn btn-primary" onClick={createEmployee} disabled={busy || !employeeForm.username.trim() || employeeForm.name.trim().length < 2 || employeeForm.password.length < 12}>
              Créer le compte livreur
            </button>
          </div>
        </section>
      )}

      {tab === 'reports' && (
        <section className="card" style={{ padding: 16, maxWidth: 720 }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Rapports de livraison</h2>
          {!report ? (
            <p className="small">Chargement…</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  ['Livraisons', report.deliveries],
                  ['Livrées', report.delivered],
                  ['Échecs / retours', report.failed],
                  ['Dépense interne', formatCurrency(report.expense_htg)],
                  ['Coût / livraison réussie', report.cost_per_successful_delivery_htg == null ? '—' : formatCurrency(report.cost_per_successful_delivery_htg)],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid var(--gray-200, #dbe7e3)', borderRadius: 10, padding: '10px 14px', minWidth: 140 }}>
                    <div className="tiny" style={{ color: 'var(--gray-600, #5b7470)' }}>{label}</div>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {report.budget_alert && (
                <div className="alert alert-warning" role="alert">
                  Alerte budget : la dépense interne du mois ({formatCurrency(report.current_month_expense_htg)}) a atteint le seuil configuré.
                </div>
              )}
              <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--gray-200, #dbe7e3)', paddingTop: 12, maxWidth: 420 }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Budget mensuel</h3>
                <label className="small">Budget mensuel (HTG)
                  <input className="input" type="number" min="0" step="1" value={budgetForm.monthly_budget_htg} onChange={(e) => setBudgetForm((f) => ({ ...f, monthly_budget_htg: e.target.value }))} />
                </label>
                <label className="small">Seuil d’alerte (%)
                  <input className="input" type="number" min="1" max="100" step="1" value={budgetForm.alert_threshold_percent} onChange={(e) => setBudgetForm((f) => ({ ...f, alert_threshold_percent: e.target.value }))} />
                </label>
                <button className="btn btn-primary" onClick={saveBudget} disabled={busy || budgetForm.monthly_budget_htg === ''}>Enregistrer le budget</button>
              </div>
            </div>
          )}
        </section>
      )}

      {detail && (
        <div role="dialog" aria-modal="true" aria-label={`Détail livraison ${detail.reference}`} style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,26,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div className="card" style={{ maxWidth: 620, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Livraison {detail.reference}</h2>
              <button className="btn btn-secondary" onClick={() => setDetail(null)}>Fermer</button>
            </div>
            <div style={{ margin: '10px 0' }}>
              <Badge status={detail.status} />
              <span className="tiny" style={{ marginLeft: 8 }}>{detail.urgent ? 'Urgente — ' : ''}Prévue le {detail.scheduled_for}</span>
            </div>
            <div style={{ display: 'grid', gap: 4, fontSize: '0.9rem' }}>
              <div><strong>Destinataire :</strong> {detail.patient_name} · {detail.delivery_phone}</div>
              <div><strong>Adresse :</strong> {detail.delivery_address}</div>
              <div><strong>Zone :</strong> {detail.delivery_zone}, {detail.city}</div>
              <div><strong>Retrait :</strong> {detail.pickup_pharmacy_name} (réf. {detail.pickup_reference})</div>
            </div>
            <h3 style={{ fontSize: '0.95rem', margin: '14px 0 6px' }}>Historique</h3>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {detail.events.map((ev, i) => (
                <li key={i} className="small">
                  <strong>{EVENT_LABELS[ev.event_type] || ev.event_type}</strong> — {formatDate(ev.created_at)}
                  {ev.actor_name ? ` · ${ev.actor_name}` : ''}{ev.reason ? ` · ${ev.reason}` : ''}
                </li>
              ))}
            </ol>
            <h3 style={{ fontSize: '0.95rem', margin: '14px 0 6px' }}>Dépenses internes</h3>
            {detail.expenses.length === 0 ? (
              <p className="small">Aucune dépense enregistrée.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {detail.expenses.map((ex) => (
                  <li key={ex.id} className="small">{formatCurrency(ex.amount_htg)} · {ex.category}{ex.notes ? ` · ${ex.notes}` : ''} · {formatDate(ex.created_at)}</li>
                ))}
              </ul>
            )}
            <div style={{ display: 'grid', gap: 8, marginTop: 12, borderTop: '1px solid var(--gray-200, #dbe7e3)', paddingTop: 12 }}>
              <label className="small">Nouvelle dépense interne (HTG entier, jamais facturée au patient)
                <input className="input" type="number" min="0" step="1" value={expenseDraft.amount_htg} onChange={(e) => setExpenseDraft((f) => ({ ...f, amount_htg: e.target.value }))} />
              </label>
              <label className="small">Catégorie
                <select className="input" value={expenseDraft.category} onChange={(e) => setExpenseDraft((f) => ({ ...f, category: e.target.value }))}>
                  <option value="TRANSPORT">Transport</option>
                  <option value="FUEL">Carburant</option>
                  <option value="PACKAGING">Emballage</option>
                  <option value="DELIVERY">Livraison</option>
                  <option value="OTHER">Autre</option>
                </select>
              </label>
              <label className="small">Notes
                <input className="input" value={expenseDraft.notes} onChange={(e) => setExpenseDraft((f) => ({ ...f, notes: e.target.value }))} maxLength={500} />
              </label>
              <button className="btn btn-primary" onClick={addExpense} disabled={busy || expenseDraft.amount_htg === ''}>Enregistrer la dépense</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
