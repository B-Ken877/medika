'use client';
/**
 * Agents — the contact-center workforce (owner brief).
 *  - Create NEW agent accounts (username + name + password, role
 *    agent/agent_supervisor, optional phone + employee ref) — the accounts
 *    can log in on medika-web and work in the agent console immediately.
 *  - Live board: who is available, who is ON A CALL right now (with which
 *    member, since when), who is on break / offline. Refreshes every 15s.
 *
 * Live data comes from GET /api/admin/agents (presence + shift + the agent's
 * active session joined server-side) — nothing is fabricated client-side.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../lib/api';
import { UserPlus, X, PhoneCall } from 'lucide-react';

const EMPTY_FORM = { username: '', name: '', password: '', phone: '', role: 'agent', employeeRef: '' };

const AVAILABILITY = {
  available: { label: 'Disponible', cls: 'badge-green' },
  busy: { label: 'Au téléphone', cls: 'badge-red' },
  on_break: { label: 'En pause', cls: 'badge-yellow' },
  wrapping_up: { label: 'Clôture en cours', cls: 'badge-blue' },
  technical_issue: { label: 'Incident technique', cls: 'badge-red' },
  offline: { label: 'Hors ligne', cls: 'badge-gray' },
};

export default function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try { setAgents(await apiFetch('/admin/agents')); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // The live board: 15s poll mirrors the agents' own heartbeat cadence.
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setFormError(null);
    try {
      const res = await apiFetch('/admin/agents', { method: 'POST', body: JSON.stringify(form) });
      showToast(`Compte agent créé : ${res.username} (${res.role})`);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally { setCreating(false); }
  };

  const online = agents.filter(a => a.availability !== 'offline').length;
  const onCalls = agents.filter(a => a.onCall).length;
  const available = agents.filter(a => a.availability === 'available').length;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Centre d&apos;appels — Agents</h1>
          <p style={{ fontSize: 13, color: 'var(--mk-text-secondary)', margin: '4px 0 0' }}>
            Créer les comptes agents et voir en direct qui travaille et qui est en appel.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <UserPlus size={16} /> Nouveau compte agent
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>En ligne</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{online}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>En appel maintenant</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: onCalls > 0 ? 'var(--mk-danger)' : 'inherit' }}>{onCalls}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Disponibles</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--mk-success)' }}>{available}</div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Statut</th>
                <th>Appel en cours</th>
                <th>Poste de travail</th>
                <th style={{ textAlign: 'right' }}>Sessions aujourd&apos;hui</th>
                <th>Dernier signal</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">Aucun agent — créez le premier compte</td></tr>
              ) : agents.map(a => {
                const st = AVAILABILITY[a.availability] || AVAILABILITY.offline;
                return (
                  <tr key={a.agentId} style={a.onCall ? { background: 'var(--mk-danger-bg)' } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>@{a.username}{a.employeeRef ? ` · ${a.employeeRef}` : ''}</div>
                    </td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td>
                      {a.onCall ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--mk-danger)', fontWeight: 600 }}>
                          <PhoneCall size={14} />
                          <span>
                            {a.liveSession?.patientName || 'Membre'} — depuis{' '}
                            {a.liveSession?.startedAt ? new Date(a.liveSession.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '?'}
                          </span>
                        </div>
                      ) : <span style={{ color: 'var(--mk-text-secondary)' }}>—</span>}
                    </td>
                    <td>
                      {a.shift ? (
                        <span className="badge badge-gray">{a.shift.status === 'on_break' ? 'En pause' : 'Poste actif'}</span>
                      ) : <span style={{ color: 'var(--mk-text-secondary)' }}>Pas de poste</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.todayCompleted}</td>
                    <td style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                      {a.lastHeartbeat ? new Date(a.lastHeartbeat).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                      {a.connectionState === 'reconnecting' ? ' (reconnexion)' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal-content" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Nouveau compte agent</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <form className="modal-body" onSubmit={handleCreate} style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Nom d&apos;utilisateur *
                <input className="form-input" required minLength={3} maxLength={40} value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })} placeholder="ex. jean.agent" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Nom complet *
                <input className="form-input" required value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ex. Jean Baptiste" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Mot de passe * (minimum 8 caractères)
                <input className="form-input" type="password" required minLength={8} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Téléphone (optionnel)
                <input className="form-input" value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+509 ..." />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Référence employé (optionnel)
                <input className="form-input" value={form.employeeRef}
                  onChange={e => setForm({ ...form, employeeRef: e.target.value })} placeholder="ex. EMP-12" />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                Rôle
                <select className="form-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="agent">Agent</option>
                  <option value="agent_supervisor">Superviseur</option>
                </select>
              </label>
              {formError && <div style={{ fontSize: 13, color: 'var(--mk-danger)' }}>{formError}</div>}
              <div className="modal-footer" style={{ padding: 0 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Création…' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
