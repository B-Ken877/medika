'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, formatCurrency } from '../../../lib/api';

function localDate(value) {
  return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
}

function nextFriday() {
  const d = new Date();
  const delta = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return localDate(d);
}

export default function LivraisonsPage() {
  const [employees, setEmployees] = useState([]);
  const [zones, setZones] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [employee, setEmployee] = useState({ name: '', username: '', password: '', phone: '' });
  const [zone, setZone] = useState({ city: 'Port-au-Prince', zone_name: 'Port-au-Prince', active: true });
  const [assignment, setAssignment] = useState({ medication_order_id: '', employee_id: '', zone_id: '', scheduled_for: nextFriday(), delivery_window: 'MATIN', urgent: false, urgent_reason: '' });
  const [expense, setExpense] = useState({ delivery_id: '', amount_htg: '', notes: '' });
  const [urgentUnavailable, setUrgentUnavailable] = useState({ medication_order_id: '', reason: '' });
  const [period, setPeriod] = useState({ from: localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: localDate(new Date()) });
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
      setAssignment((v) => ({ ...v, employee_id: v.employee_id || e.find((x) => x.is_available)?.id || '', zone_id: v.zone_id || z.find((x) => x.active)?.id || '' }));
    } catch (e) { setError(e.message || 'Impossible de charger les opérations de livraison.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (fn) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e.message || 'Une erreur est survenue.'); }
    finally { setBusy(false); }
  };

  const createEmployee = () => submit(async () => {
    await apiFetch('/admin/delivery-employees', { method: 'POST', body: employee });
    setEmployee({ name: '', username: '', password: '', phone: '' });
  });
  const saveZone = () => submit(async () => {
    await apiFetch('/admin/delivery-zones', { method: 'POST', body: zone });
    setZone({ city: 'Port-au-Prince', zone_name: '', active: true });
  });
  const assign = () => submit(async () => {
    await apiFetch('/admin/deliveries/assign', { method: 'POST', body: assignment });
    setAssignment((v) => ({ ...v, medication_order_id: '', urgent: false, urgent_reason: '', scheduled_for: nextFriday() }));
  });
  const notifyUrgentUnavailable = () => submit(async () => {
    await apiFetch('/admin/deliveries/urgent-unavailable', {
      method: 'POST',
      body: urgentUnavailable,
    });
    setUrgentUnavailable({ medication_order_id: '', reason: '' });
  });
  const saveExpense = () => submit(async () => {
    await apiFetch('/admin/deliveries/' + encodeURIComponent(expense.delivery_id) + '/expenses', {
      method: 'POST', body: { amount_htg: Number(expense.amount_htg), notes: expense.notes },
    });
    setExpense({ delivery_id: '', amount_htg: '', notes: '' });
  });
  const loadReport = () => submit(async () => {
    setReport(await apiFetch('/admin/delivery-reports?from=' + period.from + '&to=' + period.to));
  });
  const saveBudget = () => submit(async () => {
    await apiFetch('/admin/delivery-budget', { method: 'PUT', body: { monthly_budget_htg: Number(budget.monthly_budget_htg), alert_threshold_percent: Number(budget.alert_threshold_percent) } });
  });
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
        <p style={{ color: 'var(--mk-text-secondary)', fontSize: 13 }}>Affectation des livreurs Medika, zones de service, suivi des opérations et dépenses internes. La livraison reste gratuite pour le patient.</p>
      </header>
      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Créer un compte livreur</h2>
        <p className="small">Les comptes sont créés exclusivement par un administrateur. Aucun formulaire d’inscription publique n’est disponible.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <input className="form-input" placeholder="Nom complet" value={employee.name} onChange={(e) => setEmployee({ ...employee, name: e.target.value })} />
          <input className="form-input" placeholder="Identifiant" value={employee.username} onChange={(e) => setEmployee({ ...employee, username: e.target.value })} />
          <input className="form-input" placeholder="Téléphone" value={employee.phone} onChange={(e) => setEmployee({ ...employee, phone: e.target.value })} />
          <input className="form-input" type="password" placeholder="Mot de passe (12 caractères minimum)" value={employee.password} onChange={(e) => setEmployee({ ...employee, password: e.target.value })} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={createEmployee}>Créer le compte</button>
        <div style={{ marginTop: 14 }}>
          {employees.map((e) => <div key={e.id} className="small" style={{ padding: 6, borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>{e.name} · {e.username} · {e.is_available ? 'Disponible' : 'Indisponible'} <button className="btn btn-sm btn-secondary" onClick={() => toggleEmployee(e)} disabled={busy}>{e.is_available ? 'Désactiver' : 'Réactiver'}</button></div>)}
        </div>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Zones de livraison</h2>
        <p className="small">Seules les zones explicitement activées sont desservies. Port-au-Prince est la seule ville initiale ; ajoutez chaque quartier après validation opérationnelle.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <input className="form-input" placeholder="Ville" value={zone.city} onChange={(e) => setZone({ ...zone, city: e.target.value })} />
          <input className="form-input" placeholder="Quartier / zone exacte" value={zone.zone_name} onChange={(e) => setZone({ ...zone, zone_name: e.target.value })} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={saveZone}>Ajouter / activer la zone</button>
        <div style={{ marginTop: 12 }}>{zones.map((z) => <div key={z.id} className="small" style={{ padding: 6, borderBottom: '1px solid var(--mk-border)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>{z.zone_name}, {z.city} · {z.active ? 'Active' : 'Inactive'} <button className="btn btn-sm btn-secondary" onClick={() => toggleZone(z)} disabled={busy}>{z.active ? 'Désactiver' : 'Activer'}</button></div>)}</div>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Affecter une commande payée</h2>
        <p className="small">Seules les commandes dont le paiement MonCash est vérifié peuvent être affectées. Les livraisons régulières sont planifiées le vendredi ; une exception urgente exige une justification.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <select className="form-input" value={assignment.medication_order_id} onChange={(e) => setAssignment({ ...assignment, medication_order_id: e.target.value })}>
            <option value="">Choisir une commande payée</option>
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
          <select className="form-input" value={assignment.delivery_window} onChange={(e) => setAssignment({ ...assignment, delivery_window: e.target.value })}>
            <option value="MATIN">Matin · 08 h – 12 h</option>
            <option value="APRES_MIDI">Après-midi · 12 h – 17 h</option>
            <option value="SOIR">Soir · 17 h – 20 h</option>
            <option value="JOURNEE">Toute la journée</option>
          </select>
        </div>
        <label className="small" style={{ display: 'block', marginTop: 10 }}><input type="checkbox" checked={assignment.urgent} onChange={(e) => setAssignment({ ...assignment, urgent: e.target.checked })} /> Exception urgente</label>
        {assignment.urgent && <textarea className="form-input" style={{ marginTop: 8 }} placeholder="Justification de l’urgence" value={assignment.urgent_reason} onChange={(e) => setAssignment({ ...assignment, urgent_reason: e.target.value })} />}
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || !assignment.medication_order_id || !assignment.employee_id || !assignment.zone_id} onClick={assign}>Affecter la livraison</button>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Informer d’une urgence non réalisable</h2>
        <p className="small">Si aucune équipe ne peut assurer une livraison urgente, informez le patient. Il pourra acheter lui-même les médicaments avec son ordonnance, sans attendre la livraison régulière.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <select className="form-input" value={urgentUnavailable.medication_order_id} onChange={(e) => setUrgentUnavailable({ ...urgentUnavailable, medication_order_id: e.target.value })}>
            <option value="">Choisir une commande payée</option>
            {paidOrders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {o.patient_name}</option>)}
          </select>
          <input className="form-input" value={urgentUnavailable.reason} onChange={(e) => setUrgentUnavailable({ ...urgentUnavailable, reason: e.target.value })} maxLength={500} placeholder="Motif opérationnel (8 caractères minimum)" />
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 10 }} disabled={busy || !urgentUnavailable.medication_order_id || urgentUnavailable.reason.trim().length < 8} onClick={notifyUrgentUnavailable}>Informer le patient</button>
      </section>

      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h2>Livraisons en cours et dépenses</h2>
        {deliveries.map((d) => <div key={d.id} style={{ padding: 10, borderBottom: '1px solid var(--mk-border)' }}>
          <strong>{d.reference}</strong> · {d.patient_name} · {{ ASSIGNED: 'Affectée', PHARMACY_PREPARING: 'Préparation en pharmacie', READY_FOR_PICKUP: 'Prête au retrait', PICKED_UP: 'Récupérée', OUT_FOR_DELIVERY: 'En livraison', AWAITING_CONFIRMATION: 'En attente de confirmation', DELIVERED: 'Livrée', FAILED_ATTEMPT: 'Tentative échouée', RETURNED_ESCALATED: 'Retournée / escaladée' }[d.status] || d.status} · {d.scheduled_for} · {{ MATIN: 'Matin', APRES_MIDI: 'Après-midi', SOIR: 'Soir', JOURNEE: 'Toute la journée' }[d.delivery_window] || 'Toute la journée'}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 10 }} onClick={() => setExpense({ delivery_id: d.id, amount_htg: '', notes: '' })}>Saisir une dépense</button>
        </div>)}
        {expense.delivery_id && <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="form-input" type="number" min="0" placeholder="Dépense HTG" value={expense.amount_htg} onChange={(e) => setExpense({ ...expense, amount_htg: e.target.value })} />
          <input className="form-input" placeholder="Note / tentative" value={expense.notes} onChange={(e) => setExpense({ ...expense, notes: e.target.value })} />
          <button className="btn btn-primary" disabled={busy} onClick={saveExpense}>Enregistrer la dépense</button>
        </div>}
      </section>

      <section className="card" style={{ padding: 18 }}>
        <h2>Rapport des dépenses</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          <input className="form-input" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          <input className="form-input" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          <button className="btn btn-secondary" onClick={loadReport} disabled={busy}>Calculer</button>
        </div>
        {report && <div className="grid grid-2" style={{ gap: 12 }}>
          <div><strong>{report.deliveries}</strong><div className="small">Livraisons</div></div>
          <div><strong>{report.delivered}</strong><div className="small">Réussies</div></div>
          <div><strong>{report.failed}</strong><div className="small">Échouées / retournées</div></div>
          <div><strong>{formatCurrency(report.expense_htg)}</strong><div className="small">Dépenses internes</div></div>
          <div><strong>{report.cost_per_successful_delivery_htg == null ? '—' : formatCurrency(report.cost_per_successful_delivery_htg)}</strong><div className="small">Coût par livraison réussie</div></div>
          <div><strong>{report.budget_alert ? 'Seuil atteint' : 'Sous le seuil'}</strong><div className="small">Alerte budget</div></div>
          <div><strong>{report.weekly?.length || 0}</strong><div className="small">Semaines dans la période</div></div>
          <div><strong>{report.monthly?.length || 0}</strong><div className="small">Mois dans la période</div></div>
        </div>}
        {report?.weekly?.length > 0 && <div style={{ marginTop: 14 }}><strong>Coûts par semaine</strong>{report.weekly.map((w) => <div key={String(w.period)} className="small" style={{ padding: 5 }}>{String(w.period).slice(0, 10)} · {w.delivered} livrées · {formatCurrency(w.expense_htg)}</div>)}</div>}
        {report?.monthly?.length > 0 && <div style={{ marginTop: 14 }}><strong>Coûts par mois</strong>{report.monthly.map((m) => <div key={String(m.period)} className="small" style={{ padding: 5 }}>{String(m.period).slice(0, 7)} · {m.delivered} livrées · {formatCurrency(m.expense_htg)}</div>)}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <input className="form-input" type="number" min="0" placeholder="Budget mensuel HTG" value={budget.monthly_budget_htg} onChange={(e) => setBudget({ ...budget, monthly_budget_htg: e.target.value })} />
          <input className="form-input" type="number" min="1" max="100" placeholder="Seuil %" value={budget.alert_threshold_percent} onChange={(e) => setBudget({ ...budget, alert_threshold_percent: e.target.value })} />
          <button className="btn btn-primary" disabled={busy || budget.monthly_budget_htg === ''} onClick={saveBudget}>Enregistrer le budget</button>
        </div>
      </section>
    </div>
  );
}
