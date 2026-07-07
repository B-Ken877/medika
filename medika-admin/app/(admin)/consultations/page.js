'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatDate, statusLabel, statusBadge } from '../../../lib/api';
import { Search, Trash2, X, MessageSquare, AlertTriangle, Check, Filter, Eye } from 'lucide-react';

const URGENCY_BADGE = {
  'Urgente': 'badge-red',
  'Faible': 'badge-green',
  'Moyenne': 'badge-yellow',
};

const STATUS_DOT = {
  'RECHERCHE_MEDECIN': '#F59E0B',
  'EN_COURS': '#3B82F6',
  'TERMINE': '#10B981',
  'REFUSE': '#EF4444',
};

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

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

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
      showToast('Consultation supprimée');
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  // Status summary counts
  const statusCounts = consultations.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Suivi médical
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
          Consultations
        </h1>
      </div>

      {/* Status summary pills */}
      {!loading && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          {[
            { key: '', label: 'Toutes', count: consultations.length },
            { key: 'RECHERCHE_MEDECIN', label: 'En attente', count: statusCounts['RECHERCHE_MEDECIN'] || 0 },
            { key: 'EN_COURS', label: 'En cours', count: statusCounts['EN_COURS'] || 0 },
            { key: 'TERMINE', label: 'Terminées', count: statusCounts['TERMINE'] || 0 },
            { key: 'REFUSE', label: 'Refusées', count: statusCounts['REFUSE'] || 0 },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setFilterStatus(s.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 14px',
                border: `1px solid ${filterStatus === s.key ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-full)',
                background: filterStatus === s.key ? 'var(--primary-muted)' : 'var(--bg-surface)',
                cursor: 'pointer',
                fontSize: 12.5, fontWeight: filterStatus === s.key ? 700 : 500,
                color: filterStatus === s.key ? 'var(--primary)' : 'var(--text-secondary)',
                transition: 'all 120ms ease',
                fontFamily: 'inherit',
              }}
            >
              {s.key && (
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: STATUS_DOT[s.key] || '#94A3B8',
                  flexShrink: 0,
                }} />
              )}
              {s.label}
              <span style={{
                background: filterStatus === s.key ? 'rgba(5,150,105,0.15)' : 'var(--bg-sunken)',
                color: filterStatus === s.key ? 'var(--primary)' : 'var(--text-muted)',
                padding: '0 6px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 700,
              }}>{s.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1, maxWidth: 380 }}>
          <Search size={15} className="search-icon" />
          <input
            className="form-input"
            placeholder="Patient, médecin, ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {!loading && (
        <div className="count-label">
          <span className="count-pill">{filtered.length}</span>
          consultation{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Table */}
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
                  <th style={{ width: 110 }}>ID</th>
                  <th>Patient</th>
                  <th>Médecin</th>
                  <th>Spécialité</th>
                  <th>Urgence</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'center' }}>Messages</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state">
                        <div className="empty-state-icon"><MessageSquare size={22} /></div>
                        <p>Aucune consultation trouvée</p>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map(c => (
                  <tr key={c.id}>
                    <td>
                      <span style={{
                        fontFamily: 'monospace', fontSize: 11.5,
                        color: 'var(--text-muted)',
                        background: 'var(--bg-sunken)',
                        padding: '2px 7px', borderRadius: 5,
                      }}>
                        {c.id}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.patient_name}</div>
                      {c.patient_phone && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.patient_phone}</div>
                      )}
                    </td>
                    <td>
                      {c.doctor_name
                        ? <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.doctor_name}</div>
                        : <span style={{ color: 'var(--text-placeholder)', fontSize: 13 }}>Non assigné</span>
                      }
                    </td>
                    <td>
                      <span className="badge badge-blue">{c.specialty_needed}</span>
                    </td>
                    <td>
                      <span className={`badge ${URGENCY_BADGE[c.urgency_level] || 'badge-gray'}`}>
                        {c.urgency_level}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: STATUS_DOT[c.status] || '#94A3B8',
                          flexShrink: 0,
                        }} />
                        <span className={`badge ${statusBadge(c.status)}`}>{statusLabel(c.status)}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(c.created_at)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openMessages(c)} title="Voir les messages">
                        <Eye size={13} /> Voir
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(c)}>
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

      {/* Messages Modal */}
      {viewMessages && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewMessages(null)}>
          <div className="modal-content" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>
                  Messagerie de la consultation
                </h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', background: 'var(--bg-sunken)', padding: '1px 6px', borderRadius: 4 }}>
                    {viewMessages.id}
                  </span>
                  <span>·</span>
                  <span>{viewMessages.patient_name}</span>
                  {viewMessages.doctor_name && <><span>→</span><span>{viewMessages.doctor_name}</span></>}
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setViewMessages(null)}><X size={16} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 440, overflowY: 'auto', padding: '12px 16px' }}>
              {loadingMsgs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 36 }}>
                  <div className="spinner" />
                </div>
              ) : messages.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="empty-state-icon"><MessageSquare size={20} /></div>
                  <p>Aucun message dans cette consultation</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {messages.map(m => (
                    <div
                      key={m.id}
                      className={m.sender_id === 'system' ? 'msg-bubble msg-system' : 'msg-bubble msg-user'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
                        <span style={{
                          fontWeight: 700, fontSize: 12.5,
                          color: m.sender_id === 'system' ? 'var(--text-muted)' : 'var(--primary)'
                        }}>
                          {m.sender_name}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDate(m.created_at)}</span>
                      </div>
                      {m.message_type === 'voice' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          🎙 Message vocal ({m.duration}s)
                        </div>
                      ) : m.message_type === 'image' ? (
                        <div>
                          {m.text && <div style={{ fontSize: 13, marginBottom: 6 }}>{m.text}</div>}
                          {m.file_url && (
                            <img
                              src={m.file_url}
                              alt=""
                              style={{ maxWidth: 240, borderRadius: 10, display: 'block', boxShadow: 'var(--shadow-sm)' }}
                            />
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                          {m.text}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} color="#DC2626" />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: '#DC2626' }}>Supprimer la consultation</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Action irréversible</p>
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setConfirmDelete(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Supprimer la consultation <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{confirmDelete.id}</strong> et tous ses messages ?
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
