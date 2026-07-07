'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';
import { Search, Trash2, X, Users, AlertTriangle, Check, Calendar, Phone, Mail } from 'lucide-react';

function PatientAvatar({ patient, size = 36 }) {
  const initials = patient.name?.split(' ').map(w => w[0]).slice(0, 2).join('') || '?';
  const colors = [
    ['#DBEAFE', '#1D4ED8'], ['#EDE9FE', '#6D28D9'], ['#CFFAFE', '#0E7490'],
    ['#FCE7F3', '#BE185D'], ['#FEF3C7', '#B45309']
  ];
  const idx = patient.name?.charCodeAt(0) % colors.length || 0;
  const [bg, fg] = colors[idx];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${bg}, ${bg}CC)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: fg, fontWeight: 800, fontSize: size * 0.35, flexShrink: 0,
      border: `2px solid ${bg}`,
    }}>
      {initials}
    </div>
  );
}

export default function PatientsPage() {
  const [patients, setPatients] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/patients');
      setPatients(data);
      setFiltered(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!search) { setFiltered(patients); return; }
    const s = search.toLowerCase();
    setFiltered(patients.filter(p =>
      p.name?.toLowerCase().includes(s) || p.username?.toLowerCase().includes(s) ||
      p.email?.toLowerCase().includes(s) || p.phone?.includes(s)
    ));
  }, [patients, search]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleDelete = async (p) => {
    try {
      await apiFetch(`/admin/patients/${p.id}`, { method: 'DELETE' });
      showToast(`${p.name} supprimé`);
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Base de données
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
          Patients
        </h1>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1, maxWidth: 360 }}>
          <Search size={15} className="search-icon" />
          <input
            className="form-input"
            placeholder="Nom, email, téléphone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!loading && (
        <div className="count-label">
          <span className="count-pill">{filtered.length}</span>
          patient{filtered.length !== 1 ? 's' : ''} trouvé{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Genre</th>
                  <th>Âge</th>
                  <th>Contact</th>
                  <th style={{ textAlign: 'right' }}>Consultations</th>
                  <th>Inscrit le</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <div className="empty-state-icon"><Users size={22} /></div>
                        <p>Aucun patient trouvé</p>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <PatientAvatar patient={p} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>{p.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'monospace' }}>@{p.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${p.gender === 'Femme' ? 'badge-purple' : 'badge-blue'}`}>
                        {p.gender || '—'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {p.age ? `${p.age} ans` : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {p.email && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
                            <Mail size={11} color="var(--text-muted)" />
                            <span>{p.email}</span>
                          </div>
                        )}
                        {p.phone && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)' }}>
                            <Phone size={11} color="var(--text-muted)" />
                            <span>{p.phone}</span>
                          </div>
                        )}
                        {!p.email && !p.phone && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--bg-sunken)', borderRadius: 8,
                        padding: '4px 10px', fontWeight: 700, fontSize: 14, minWidth: 36,
                      }}>
                        {p.consultationCount || 0}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)' }}>
                        <Calendar size={12} />
                        {formatDate(p.created_at)}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(p)} title="Supprimer">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} color="#DC2626" />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>Confirmer la suppression</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Action irréversible</p>
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setConfirmDelete(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Supprimer le compte de <strong style={{ color: 'var(--text-primary)' }}>{confirmDelete.name}</strong> ?
                Toutes ses consultations seront également effacées.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn btn-danger" style={{ background: '#DC2626', color: '#fff', border: 'none' }} onClick={() => handleDelete(confirmDelete)}>
                <Trash2 size={14} /> Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
