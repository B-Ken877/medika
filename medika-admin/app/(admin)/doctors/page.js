'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';
import { Plus, Search, Edit2, Trash2, Key, Eye, EyeOff, X, Check } from 'lucide-react';

const SPECIALTIES = [
  'Medecine Generale', 'Cardiologie', 'Dermatologie', 'Endocrinologie',
  'Gastro-enterologie', 'Gynecologie', 'Neurologie', 'Ophtalmologie',
  'ORL', 'Pediatrie', 'Psychiatrie', 'Pneumologie', 'Radiologie',
  'Rhumatologie', 'Urologie', 'Chirurgie Generale', 'Orthopedie',
  'Odontologie', 'Nutrition', 'Medecine Interne'
];

const emptyForm = {
  username: '', password: '', name: '', email: '', phone: '', age: '',
  gender: 'Homme', specialty: '', licenseNumber: '', location: '',
  hospital: '', biography: '', avatarUrl: ''
};

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSpecialty, setFilterSpecialty] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resetPw, setResetPw] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/doctors');
      setDoctors(data);
      setFiltered(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let result = doctors;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(d =>
        d.name?.toLowerCase().includes(s) || d.username?.toLowerCase().includes(s) ||
        d.email?.toLowerCase().includes(s) || d.specialty?.toLowerCase().includes(s)
      );
    }
    if (filterSpecialty) result = result.filter(d => d.specialty === filterSpecialty);
    setFiltered(result);
  }, [doctors, search, filterSpecialty]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowPassword(false);
    setShowForm(true);
  };

  const openEdit = (doc) => {
    setEditing(doc);
    setForm({
      username: doc.username || '',
      password: '',
      name: doc.name || '',
      email: doc.email || '',
      phone: doc.phone || '',
      age: doc.age || '',
      gender: doc.gender || 'Homme',
      specialty: doc.specialty || '',
      licenseNumber: doc.license_number || '',
      location: doc.location || '',
      hospital: doc.hospital || '',
      biography: doc.biography || '',
      avatarUrl: doc.avatar_url || ''
    });
    setShowPassword(false);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/admin/doctors/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
        showToast(`${form.name} mis a jour`);
      } else {
        if (!form.password) { showToast('Le mot de passe est requis', 'error'); setSubmitting(false); return; }
        await apiFetch('/admin/doctors', { method: 'POST', body: JSON.stringify(form) });
        showToast(`${form.name} cree avec succes`);
      }
      setShowForm(false);
      load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (doc) => {
    try {
      await apiFetch(`/admin/doctors/${doc.id}`, { method: 'DELETE' });
      showToast(`${doc.name} supprime`);
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleResetPw = async () => {
    if (!newPw || newPw.length < 4) { showToast('Minimum 4 caracteres', 'error'); return; }
    try {
      await apiFetch(`/admin/users/${resetPw.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ newPassword: newPw }) });
      showToast(`Mot de passe reinitialise pour ${resetPw.name}`);
      setResetPw(null);
      setNewPw('');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const toggleAvailability = async (doc) => {
    try {
      const newVal = !doc.is_available;
      await apiFetch(`/admin/doctors/${doc.id}`, { method: 'PUT', body: JSON.stringify({ isAvailable: newVal }) });
      showToast(`${doc.name} ${newVal ? 'disponible' : 'indisponible'}`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;

  const usedSpecialties = [...new Set(doctors.map(d => d.specialty).filter(Boolean))];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={16} className="search-icon" />
            <input className="form-input" placeholder="Rechercher un medecin..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-input" style={{ width: 'auto', minWidth: 180 }} value={filterSpecialty} onChange={e => setFilterSpecialty(e.target.value)}>
            <option value="">Toutes les specialites</option>
            {usedSpecialties.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Ajouter un medecin</button>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>{filtered.length} medecin(s) trouve(s)</div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr>
              <th>Medecin</th><th>Specialite</th><th>Contact</th>
              <th style={{ textAlign: 'center' }}>Statut</th><th style={{ textAlign: 'right' }}>Consult.</th>
              <th style={{ textAlign: 'right' }}>Gains</th><th style={{ textAlign: 'center' }}>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">Aucun medecin trouve</td></tr>
              ) : filtered.map(doc => (
                <tr key={doc.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {doc.avatar_url ? (
                        <img src={doc.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669', fontWeight: 700, fontSize: 14 }}>
                          {doc.name?.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>@{doc.username}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="badge badge-blue">{doc.specialty || 'N/A'}</span></td>
                  <td>
                    <div style={{ fontSize: 13 }}>{doc.email || '-'}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{doc.phone || '-'}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => toggleAvailability(doc)}
                      className={`badge ${doc.is_available ? 'badge-green' : 'badge-gray'}`}
                      style={{ cursor: 'pointer', border: 'none' }}>
                      {doc.is_available ? 'Disponible' : 'Indisponible'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div>{doc.consultationCount || 0}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{doc.completedCount || 0} terminees</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>{formatCurrency(doc.totalEarnings || 0)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(doc)} title="Modifier"><Edit2 size={14} /></button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setResetPw(doc)} title="Reset MDP"><Key size={14} /></button>
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(doc)} title="Supprimer"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>{editing ? 'Modifier le medecin' : 'Nouveau medecin'}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Nom complet *</label>
                    <input className="form-input" value={form.name} onChange={e => updateField('name', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nom d&apos;utilisateur *</label>
                    <input className="form-input" value={form.username} onChange={e => updateField('username', e.target.value)} required disabled={!!editing} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Mot de passe {editing ? '(laisser vide pour garder)' : '*'}</label>
                    <div style={{ position: 'relative' }}>
                      <input className="form-input" type={showPassword ? 'text' : 'password'} value={form.password}
                        onChange={e => updateField('password', e.target.value)} required={!editing} style={{ paddingRight: 36 }} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Specialite *</label>
                    <select className="form-input" value={form.specialty} onChange={e => updateField('specialty', e.target.value)} required>
                      <option value="">Choisir...</option>
                      {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => updateField('email', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telephone</label>
                    <input className="form-input" value={form.phone} onChange={e => updateField('phone', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Age</label>
                    <input className="form-input" type="number" value={form.age} onChange={e => updateField('age', e.target.value ? parseInt(e.target.value) : '')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Genre</label>
                    <select className="form-input" value={form.gender} onChange={e => updateField('gender', e.target.value)}>
                      <option value="Homme">Homme</option>
                      <option value="Femme">Femme</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">N. licence</label>
                    <input className="form-input" value={form.licenseNumber} onChange={e => updateField('licenseNumber', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Localisation</label>
                    <input className="form-input" value={form.location} onChange={e => updateField('location', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hopital</label>
                    <input className="form-input" value={form.hospital} onChange={e => updateField('hospital', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Biographie</label>
                  <textarea className="form-input" value={form.biography} onChange={e => updateField('biography', e.target.value)} rows={3} />
                </div>
                <div className="form-group">
                  <label className="form-label">URL de l&apos;avatar</label>
                  <input className="form-input" value={form.avatarUrl} onChange={e => updateField('avatarUrl', e.target.value)} placeholder="https://..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Enregistrement...' : editing ? <><Check size={16} /> Mettre a jour</> : <><Plus size={16} /> Creer</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
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

      {/* Reset Password Modal */}
      {resetPw && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setResetPw(null); setNewPw(''); } }}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Reinitialiser le mot de passe</h2>
              <button onClick={() => { setResetPw(null); setNewPw(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: '#374151', marginBottom: 16 }}>Nouveau mot de passe pour <strong>{resetPw.name}</strong> (@{resetPw.username})</p>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <input className="form-input" type="text" value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="Nouveau mot de passe" autoFocus onKeyDown={e => { if (e.key === 'Enter') handleResetPw(); }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setResetPw(null); setNewPw(''); }}>Annuler</button>
              <button className="btn btn-primary" onClick={handleResetPw}><Key size={16} /> Reinitialiser</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}