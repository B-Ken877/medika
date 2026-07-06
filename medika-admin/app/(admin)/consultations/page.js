'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatDate, statusLabel, statusBadge } from '../../../lib/api';
import { Search, Trash2, X, MessageSquare } from 'lucide-react';

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMessages, setViewMessages] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/consultations');
      setConsultations(data);
      setFiltered(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let result = consultations;
    if (filterStatus) result = result.filter(c => c.status === filterStatus);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(c =>
        c.patient_name?.toLowerCase().includes(s) || c.doctor_name?.toLowerCase().includes(s) ||
        c.id?.toLowerCase().includes(s) || c.description?.toLowerCase().includes(s)
      );
    }
    setFiltered(result);
  }, [consultations, search, filterStatus]);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const openMessages = async (cons) => {
    setViewMessages(cons);
    setLoadingMsgs(true);
    try {
      const msgs = await apiFetch('/admin/consultations/' + cons.id + '/messages');
      setMessages(msgs);
    } catch (e) { console.error(e); }
    finally { setLoadingMsgs(false); }
  };

  const handleDelete = async (c) => {
    try {
      await apiFetch('/admin/consultations/' + c.id, { method: 'DELETE' });
      showToast('Consultation supprimee');
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} className="search-icon" />
          <input className="form-input" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-input" style={{ width: 'auto', minWidth: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="RECHERCHE_MEDECIN">En attente</option>
          <option value="EN_COURS">En cours</option>
          <option value="TERMINE">Terminee</option>
          <option value="REFUSE">Refusee</option>
        </select>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>{filtered.length} consultation(s)</div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr>
              <th>ID</th><th>Patient</th><th>Medecin</th><th>Specialite</th>
              <th>Urgence</th><th>Statut</th><th>Date</th>
              <th style={{ textAlign: 'center' }}>Messages</th><th style={{ textAlign: 'center' }}>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="empty-state">Aucune consultation</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{c.id}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.patient_name}</div>
                    {c.patient_phone && <div style={{ fontSize: 12, color: '#6b7280' }}>{c.patient_phone}</div>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.doctor_name || <span style={{ color: '#9ca3af' }}>Non assigne</span>}</div>
                  </td>
                  <td><span className="badge badge-blue">{c.specialty_needed}</span></td>
                  <td>
                    <span className={'badge ' + (c.urgency_level === 'Urgente' ? 'badge-red' : c.urgency_level === 'Faible' ? 'badge-green' : 'badge-yellow')}>
                      {c.urgency_level}
                    </span>
                  </td>
                  <td><span className={'badge ' + statusBadge(c.status)}>{statusLabel(c.status)}</span></td>
                  <td style={{ fontSize: 13 }}>{formatDate(c.created_at)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openMessages(c)}>
                      <MessageSquare size={14} /> Voir
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(c)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewMessages && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewMessages(null)}>
          <div className="modal-content" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>Messages - {viewMessages.id}</h2>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{viewMessages.patient_name} {viewMessages.doctor_name || ''}</div>
              </div>
              <button onClick={() => setViewMessages(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 400, overflowY: 'auto', padding: 0 }}>
              {loadingMsgs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="empty-state">Aucun message</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {messages.map(m => (
                    <div key={m.id} style={{
                      padding: '10px 16px',
                      background: m.sender_id === 'system' ? '#f9fafb' : '#f0fdf4',
                      borderLeft: m.sender_id === 'system' ? '3px solid #9ca3af' : '3px solid #059669'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{m.sender_name}</span>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(m.created_at)}</span>
                      </div>
                      {m.message_type === 'voice' ? (
                        <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
                          Message vocal ({m.duration}s)
                        </div>
                      ) : m.message_type === 'image' ? (
                        <div>
                          {m.text && <div style={{ fontSize: 13 }}>{m.text}</div>}
                          {m.file_url && <img src={m.file_url} alt="" style={{ maxWidth: 200, borderRadius: 8, marginTop: 4 }} />}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>Supprimer la consultation</h2>
              <button onClick={() => setConfirmDelete(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>Supprimer la consultation <strong>{confirmDelete.id}</strong> et tous ses messages ?</p>
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

      {toast && <div className={'toast toast-' + toast.type}>{toast.msg}</div>}
    </div>
  );
}
