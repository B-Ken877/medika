'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';
import { Search, Trash2, X } from 'lucide-react';

function PatientAvatar({ patient }) {
  const [imgError, setImgError] = useState(false);
  const avatarUrl = patient.avatar_url;

  if (!avatarUrl || imgError) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: '#dbeafe',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#2563eb', fontWeight: 700, fontSize: 14, flexShrink: 0
      }}>
        {patient.name?.charAt(0)?.toUpperCase() || '?'}
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={patient.name}
      onError={() => setImgError(true)}
      style={{
        width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
        flexShrink: 0, background: '#dbeafe'
      }}
    />
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
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (p) => {
    try {
      await apiFetch(`/admin/patients/${p.id}`, { method: 'DELETE' });
      showToast(`${p.name} supprime`);
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="search-box" style={{ maxWidth: 400 }}>
          <Search size={16} className="search-icon" />
          <input className="form-input" placeholder="Rechercher un patient..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>{filtered.length} patient(s) trouve(s)</div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Genre</th>
                <th>Age</th>
                <th>Contact</th>
                <th style={{ textAlign: 'right' }}>Consultations</th>
                <th>Inscrit le</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">Aucun patient trouve</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <PatientAvatar patient={p} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>@{p.username}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="badge badge-gray">{p.gender || '-'}</span></td>
                  <td>{p.age || '-'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{p.email || '-'}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{p.phone || '-'}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.consultationCount || 0}</td>
                  <td style={{ fontSize: 13 }}>{formatDate(p.created_at)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(p)} title="Supprimer">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>Confirmer la suppression</h2>
              <button onClick={() => setConfirmDelete(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>Supprimer <strong>{confirmDelete.name}</strong> ? Cette action est irreversible.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn btn-danger" style={{ background: '#dc2626', color: '#fff' }} onClick={() => handleDelete(confirmDelete)}>
                <Trash2 size={16} /> Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
