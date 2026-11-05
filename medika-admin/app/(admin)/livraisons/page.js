'use client';
/**
 * Livraisons Medika — admin delivery operations (issue #82, delivery scope).
 *
 * Sections:
 *  1. Delivery-employee accounts (admin-provisioned only; availability toggle).
 *  2. Coverage zones (explicit city + zone records; activation fails closed).
 *  3. Assignment of PAID orders: Friday schedule server-side, reasoned urgent
 *     exceptions, available employee, active matching zone.
 *  4. Live deliveries + internal expense ledger (integer HTG, never billed
 *     to the patient — delivery stays free).
 *  5. Reports: counts, delivered/failed, internal expense, cost per success,
 *     monthly budget + alert threshold (America/Port-au-Prince boundaries).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, formatCurrency } from '../../../lib/api';

const STATUS_FR = {
  ASSIGNED: 'Affectée',
  PHARMACY_PREPARING: 'Préparation en pharmacie',
  READY_FOR_PICKUP: 'Prête au retrait',
  PICKED_UP: 'Récupérée',
  OUT_FOR_DELIVERY: 'En livraison',
  AWAITING_CONFIRMATION: 'En attente de confirmation patient',
  DELIVERED: 'Livrée',
  FAILED_ATTEMPT: 'Tentative échouée',
  RETURNED_ESCALATED: 'Retournée / escaladée',
};

function nextFriday() {
  const d = new Date();
  const delta = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function LivraisonsPage() {
  const [employees, setEmployees] = useState([]);
  const [zones, setZones] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [employee, setEmployee] = useState({ name: '', username: '', password: '', phone: '' });
  const [zone, setZone] = useState({ city: 'Port-au-Prince', zone_name: '', active: true });
  const [assignment, setAssignment] = useState({ medication_order_id: '', employee_id: '', zone_id: '', scheduled_for: nextFriday(), urgent: false, urgent_reason: '' });
  const [expense, setExpense] = useState({ delivery_id: '', amount_htg: '', category: 'TRANSPORT', notes: '' });
  const [period, setPeriod] = useState({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  const [budget, setBudget] = useState({ monthly_budget_htg: '', alert_threshold_percent: 80 });

  const load = useCallback(async () => {
    try {
      const [e, z, d, o, r] = await Promise.all([
        apiFetch('/admin/delivery-employees'),
        apiFetch('/admin/delivery-zones'),
        apiFetch('/admin/deliveries'),
        apiFetch('/admin/medication-orders?bucket=all'),
        apiFetch('/admin/delivery-reports'),
      ]);
      setEmployees(e); setZones(z); setDeliveries(d); setOrders(o); setReport(r); setError('');
      setAssignment((v) => ({
        ...v,
        employee_id: v.employee_id || (e.find((x) => x.is_available) || {}).id || '',
        zone_id: v.zone_id || (z.find((x) => x.active) || {}).id || '',
      }));
      if (r.budget) {
        setBudget((b) => (b.monthly_budget_htg === '' ? { monthly_budget_htg: String(r.budget.monthly_budget_htg), alert_threshold_percent: r.budget.alert_threshold_percent } : b));
      }
    } catch (e) { setError(e.message || 'Impossible de charger les opérations de livraison.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (fn, okMessage = '') => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (okMessage) setNotice(okMessage); await load(); }
    catch (e) { setError(e.message || 'Une erreur est survenue.'); }
    finally { setBusy(false); }
  };

  const createEmployee = () => submit(async () => {
    await apiFetch('/admin/delivery-employees', { method: 'POST', body: employee });
    setEmployee({ name: '', username: '', password: '', phone: '' });
  }, 'Compte livreur créé.');

  const saveZone = () => submit(async () => {
    await apiFetch('/admin/delivery-zones', { method: 'POST', body: zone });
    setZone({ city: zone.city || 'Port-au-Prince', zone_name: '', active: true });
  }, 'Zone enregistrée.');

  const assign = () => submit(async () => {
    await apiFetch('/admin/deliveries/assign', {
      method: 'POST',
      body: {
        ...assignment,
        urgent: assignment.urgent === true,
        urgent_reason: assignment.urgent ? assignment.urgent_reason : '',
      },
    });
    setAssignment((v) => ({ ...v, medication_order_id: '', urgent: false, urgent_reason: '', scheduled_for: nextFriday() }));
  }, 'Livraison affectée — le patient est notifié.');

  const saveExpense = () => submit(async () => {
    await apiFetch('/admin/deliveries/' + encodeURIComponent(expense.delivery_id) + '/expenses', {
      method: 'POST',
      body: { amount_htg: Math.round(Number(expense.amount_htg)), category: expense.category || 'TRANSPORT', notes: expense.notes },
    });
    setExpense({ delivery_id: '', amount_htg: '', category: 'TRANSPORT', notes: '' });
  }, 'Dépense interne enregistrée (sans impact sur le patient).');

  const loadReport = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setReport(await apiFetch('/admin/delivery-reports?from=' + period.from + '&to=' + period.to)); }
    catch (e) { setError(e.message || 'Impossible de calculer le rapport.'); }
    finally { setBusy(false); }
  };

  const saveBudget = () => submit(async () => {
    await apiFetch('/admin/delivery-budget', {
      method: 'PUT',
      body: { monthly_budget_htg: Math.round(Number(budget.monthly_budget_htg)), alert_threshold_percent: Math.round(Number(budget.alert_threshold_percent)) },
    });
  }, 'Budget enregistré.');

  const toggleEmployee = (e) => submit(async () => {
    await apiFetch('/admin/delivery-employees/' + encodeURIComponent(e.id) + '/availability', { method: 'PATCH', body: { is_available: !e.is_available } });
  });

  const toggleZone = (z) => submit(async () => {
    await apiFetch('/admin/delivery-zones', { method: 'POST', body: { id: z.id, city: z.city, zone_name: z.zone_name, active: !z.active } });
  });

  const paidOrders = orders.filter((o) => o.status === 'PAID' && !deliveries.some((d) => d.medication_order_id === o.id));

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Livraisons Medika</h1>
        <p style={{ color: 'var(--mk-text-secondary)', fontSize: 13 }}>
          Affectation des livreurs Medika, zones de service, suivi des opérations et dépenses internes.
          La livraison reste gratuite pour le patient — les dépenses ci-dessous sont des coûts internes Medika.
        </p>
      </header>
      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="alert alert-success" role="status" style={{ marginBottom: 16 }}>{notice}</div>}

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Comptes livreurs</h2>
        <p className="small">Les comptes sont créés exclusivement par un administrateur. Aucune inscription publique n’existe pour les livreurs.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <input className="form-input" placeholder="Nom complet" value={employee.name} onChange={(e) => setEmployee({ ...employee, name: e.target.value })} />
          <input className="form-input" placeholder="Identifiant (ex. livreur.jean)" value={employee.username} onChange={(e) => setEmployee({ ...employee, username: e.target.value })} />
          <input className="form-input" placeholder="Téléphone" value={employee.phone} onChange={(e) => setEmployee({ ...employee, phone: e.target.value })} />
          <input className="form-input" type="password" placeholder="Mot de passe (12 caractères minimum)" value={employee.password} onChange={(e) => setEmployee({ ...employee, password: e.target.value })} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={createEmployee}>Créer le compte</button>
        <div style={{ marginTop: 14 }}>
          {employees.map((e) => (
            <div key={e.id} className="small" style={{ padding: 6, borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{e.name} · {e.username} · <strong>{e.is_available ? 'Disponible' : 'Indisponible'}</strong></span>
              <button className="btn btn-sm btn-secondary" onClick={() => toggleEmployee(e)} disabled={busy}>{e.is_available ? 'Désactiver' : 'Réactiver'}</button>
            </div>
          ))}
          {employees.length === 0 && <p className="small">Aucun livreur pour le moment.</p>}
        </div>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Zones de livraison</h2>
        <p className="small">Seules les zones explicitement activées sont desservies ; sans zone active, la demande de livraison est refusée et le patient est invité à acheter en pharmacie. Port-au-Prince est la seule ville initiale.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <input className="form-input" placeholder="Ville" value={zone.city} onChange={(e) => setZone({ ...zone, city: e.target.value })} />
          <input className="form-input" placeholder="Quartier / zone exacte" value={zone.zone_name} onChange={(e) => setZone({ ...zone, zone_name: e.target.value })} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !zone.zone_name.trim()} onClick={saveZone}>Ajouter / activer la zone</button>
        <div style={{ marginTop: 12 }}>
          {zones.map((z) => (
            <div key={z.id} className="small" style={{ padding: 6, borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{z.zone_name}, {z.city} · <strong>{z.active ? 'Active' : 'Inactive'}</strong></span>
              <button className="btn btn-sm btn-secondary" onClick={() => toggleZone(z)} disabled={busy}>{z.active ? 'Désactiver' : 'Activer'}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Affecter une commande payée</h2>
        <p className="small">Seules les commandes dont le paiement MonCash est vérifié peuvent être affectées. Les livraisons régulières sont planifiées le vendredi ; une exception urgente exige une justification (vérifiée côté serveur).</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <select className="form-input" value={assignment.medication_order_id} onChange={(e) => setAssignment({ ...assignment, medication_order_id: e.target.value })}>
            <option value="">{paidOrders.length === 0 ? 'Aucune commande payée en attente' : 'Choisir une commande payée'}</option>
            {paidOrders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {o.patient_name} · {o.delivery_zone}</option>)}
          </select>
          <select className="form-input" value={assignment.employee_id} onChange={(e) => setAssignment({ ...assignment, employee_id: e.target.value })}>
            <option value="">Choisir un livreur disponible</option>
            {employees.filter((e) => e.is_available).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select className="form-input" value={assignment.zone_id} onChange={(e) => setAssignment({ ...assignment, zone_id: e.target.value })}>
            <option value="">Choisir la zone</option>
            {zones.filter((z) => z.active).map((z) => <option key={z.id} value={z.id}>{z.zone_name}, {z.city}</option>)}
          </select>
          <input className="form-input" type="date" value={assignment.scheduled_for} onChange={(e) => setAssignment({ ...assignment, scheduled_for: e.target.value })} />
        </div>
        <label className="small" style={{ display: 'block', marginTop: 10 }}>
          <input type="checkbox" checked={assignment.urgent} onChange={(e) => setAssignment({ ...assignment, urgent: e.target.checked })} /> Exception urgente (hors vendredi)
        </label>
        {assignment.urgent && (
          <textarea className="form-input" style={{ marginTop: 8 }} placeholder="Justification de l’urgence (obligatoire)" value={assignment.urgent_reason} onChange={(e) => setAssignment({ ...assignment, urgent_reason: e.target.value })} />
        )}
        <button
          className="btn btn-primary"
          style={{ marginTop: 10 }}
          disabled={busy || !assignment.medication_order_id || !assignment.employee_id || !assignment.zone_id || (assignment.urgent && assignment.urgent_reason.trim().length < 8)}
          onClick={assign}
        >
          Affecter la livraison
        </button>
        {paidOrders.length === 0 && <p className="small" style={{ marginTop: 8 }}>Les commandes apparaissent ici après acceptation du devis et paiement MonCash vérifié.</p>}
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Livraisons en cours et dépenses internes</h2>
        {deliveries.length === 0 && <p className="small">Aucune livraison enregistrée.</p>}
        {deliveries.map((d) => (
          <div key={d.id} style={{ padding: 10, borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>
              <strong>{d.reference}</strong> · {d.patient_name} · {STATUS_FR[d.status] || d.status} · prévue {d.scheduled_for}{d.urgent ? ' · prioritaire' : ''}
            </span>
            <button className="btn btn-sm btn-secondary" onClick={() => setExpense({ delivery_id: d.id, amount_htg: '', category: 'TRANSPORT', notes: '' })}>Saisir une dépense</button>
          </div>
        ))}
        {expense.delivery_id && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="form-input" type="number" min="0" step="1" placeholder="Dépense HTG (entier)" value={expense.amount_htg} onChange={(e) => setExpense({ ...expense, amount_htg: e.target.value })} />
            <input className="form-input" placeholder="Catégorie (ex. TRANSPORT)" value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} />
            <input className="form-input" placeholder="Note / tentative" value={expense.notes} onChange={(e) => setExpense({ ...expense, notes: e.target.value })} />
            <button className="btn btn-primary" disabled={busy || expense.amount_htg === ''} onClick={saveExpense}>Enregistrer la dépense</button>
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2>Rapport et budget</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          <input className="form-input" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          <input className="form-input" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          <button className="btn btn-secondary" onClick={loadReport} disabled={busy}>Calculer</button>
        </div>
        {report && (
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div><strong>{report.deliveries}</strong><div className="small">Livraisons</div></div>
            <div><strong>{report.delivered}</strong><div className="small">Réussies</div></div>
            <div><strong>{report.failed}</strong><div className="small">Échouées / retournées</div></div>
            <div><strong>{formatCurrency(report.expense_htg)}</strong><div className="small">Dépenses internes</div></div>
            <div><strong>{report.cost_per_successful_delivery_htg == null ? '—' : formatCurrency(report.cost_per_successful_delivery_htg)}</strong><div className="small">Coût par livraison réussie</div></div>
            <div><strong>{!report.budget ? 'Budget non configuré' : report.budget_alert ? 'Seuil atteint' : 'Sous le seuil'}</strong><div className="small">Alerte budget</div></div>
            <div><strong>{formatCurrency(report.current_month_expense_htg || 0)}</strong><div className="small">Dépenses du mois en cours</div></div>
            <div><strong>{report.weekly?.length || 0}</strong><div className="small">Semaines dans la période</div></div>
            <div><strong>{report.monthly?.length || 0}</strong><div className="small">Mois dans la période</div></div>
          </div>
        )}
        {report?.weekly?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong>Coûts par semaine</strong>
            {report.weekly.map((w) => <div key={String(w.period)} className="small" style={{ padding: 5 }}>{String(w.period).slice(0, 10)} · {w.delivered} livrées · {formatCurrency(w.expense_htg)}</div>)}
          </div>
        )}
        {report?.monthly?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong>Coûts par mois</strong>
            {report.monthly.map((m) => <div key={String(m.period)} className="small" style={{ padding: 5 }}>{String(m.period).slice(0, 7)} · {m.delivered} livrées · {formatCurrency(m.expense_htg)}</div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <input className="form-input" type="number" min="0" step="1" placeholder="Budget mensuel HTG" value={budget.monthly_budget_htg} onChange={(e) => setBudget({ ...budget, monthly_budget_htg: e.target.value })} />
          <input className="form-input" type="number" min="1" max="100" placeholder="Seuil d’alerte %" value={budget.alert_threshold_percent} onChange={(e) => setBudget({ ...budget, alert_threshold_percent: e.target.value })} />
          <button className="btn btn-primary" disabled={busy || budget.monthly_budget_htg === ''} onClick={saveBudget}>Enregistrer le budget</button>
        </div>
      </section>
    </div>
  );
}
