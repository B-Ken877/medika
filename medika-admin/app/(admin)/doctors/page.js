'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';
import { Plus, Search, Edit2, Trash2, Key, Eye, EyeOff, X, Check, Stethoscope, Filter, AlertTriangle } from 'lucide-react';

const SPECIALTIES = [
  'Médecine Générale', 'Cardiologie', 'Dermatologie', 'Endocrinologie',
  'Gastro-entérologie', 'Gynécologie', 'Neurologie', 'Ophtalmologie',
  'ORL', 'Pédiatrie', 'Psychiatrie', 'Pneumologie', 'Radiologie',
  'Rhumatologie', 'Urologie', 'Chirurgie Générale', 'Orthopédie',
  'Odontologie', 'Nutrition', 'Médecine Interne'
];

const emptyForm = {
  username: '', password: '', name: '', email: '', phone: '', age: '',
  gender: 'Homme', specialty: '', licenseNumber: '', location: '',
  hospital: '', biography: '', avatarUrl: ''
};

function DoctorAvatar({ doc, size = 38 }) {
  if (doc.avatar_url) {
    return (
      <img
        src={doc.avatar_url}
        alt={doc.name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--border)' }}
      />
    );
  }
  const initials = doc.name?.split(' ').map(w => w[0]).slice(0, 2).join('') || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #DCFCE7, #A7F3D0)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#059669', fontWeight: 800, fontSize: size * 0.35, flexShrink: 0,
      border: '2px solid rgba(5,150,105,0.15)',
    }}>
      {initials}
    </div>
  );
}

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
    setTimeout(() => setToast(null), 3500);
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
        showToast(`${form.name} mis à jour avec succès`);
      } else {
        if (!form.password) { showToast('Le mot de passe est requis', 'error'); setSubmitting(false); return; }
        await apiFetch('/admin/doctors', { method: 'POST', body: JSON.stringify(form) });
        showToast(`Dr. ${form.name} créé avec succès`);
      }
      setShowForm(false);
      load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (doc) => {
    try {
      await apiFetch(`/admin/doctors/${doc.id}`, { method: 'DELETE' });
      showToast(`${doc.name} supprimé`);
      setConfirmDelete(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleResetPw = async () => {
    if (!newPw || newPw.length < 4) { showToast('Minimum 4 caractères', 'error'); return; }
    try {
      await apiFetch(`/admin/users/${resetPw.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ newPassword: newPw }) });
      showToast(`Mot de passe réinitialisé pour ${resetPw.name}`);
      setResetPw(null);
      setNewPw('');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const toggleAvailability = async (doc) => {
    try {
      const newVal = !doc.is_available;
      await apiFetch(`/admin/doctors/${doc.id}`, { method: 'PUT', body: JSON.stringify({ isAvailable: newVal }) });
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const usedSpecialties = [...new Set(doctors.map(d => d.specialty).filter(Boolean))];

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Gestion du personnel médical
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
          Médecins
        </h1>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="search-box" style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
            <Search size={15} className="search-icon" />
            <input
              className="form-input"
              placeholder="Rechercher un médecin..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Filter size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <select
              className="form-input"
              style={{ paddingLeft: 30, width: 'auto', minWidth: 180 }}
              value={filterSpecialty}
              onChange={e => setFilterSpecialty(e.target.value)}
            >
              <option value="">Toutes les spécialités</option>
              {usedSpecialties.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> Ajouter un médecin
        </button>
      </div>

      {/* Count */}
      {!loading && (
        <div className="count-label">
          <span className="count-pill">{filtered.length}</span>
          médecin{filtered.length !== 1 ? 's' : ''} trouvé{filtered.length !== 1 ? 's' : ''}
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
                  <th>Médecin</th>
                  <th>Spécialité</th>
                  <th>Contact</th>
                  <th style={{ textAlign: 'center' }}>Disponibilité</th>
                  <th style={{ textAlign: 'right' }}>Consultations</th>
                  <th style={{ textAlign: 'right' }}>Gains totaux</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <div className="empty-state-icon"><Stethoscope size={22} /></div>
                        <p>Aucun médecin trouvé</p>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <DoctorAvatar doc={doc} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>{doc.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'monospace' }}>@{doc.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-blue">{doc.specialty || 'N/A'}</span>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{doc.email || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{doc.phone || '—'}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => toggleAvailability(doc)}
                        className={`avail-btn ${doc.is_available ? 'badge-green' : 'badge-gray'}`}
                        style={{ cursor: 'pointer' }}
                      >
                        {doc.is_available ? '● Disponible' : '○ Indisponible'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{doc.consultationCount || 0}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        {doc.completedCount || 0} terminées
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                      {formatCurrency(doc.totalEarnings || 0)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(doc)} title="Modifier">
                          <Edit2 size={13} />
                        </button>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setResetPw(doc)} title="Réinitialiser MDP">
                          <Key size={13} />
                        </button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(doc)} title="Supprimer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal-content" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                  {editing ? 'Modifier le médecin' : 'Nouveau médecin'}
                </h2>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                  {editing ? `Mise à jour du profil de ${editing.name}` : 'Créer un nouveau compte praticien'}
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowForm(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Nom complet *</label>
                    <input className="form-input" value={form.name} onChange={e => updateField('name', e.target.value)} required placeholder="Dr. Jean Dupont" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nom d&apos;utilisateur *</label>
                    <input className="form-input" value={form.username} onChange={e => updateField('username', e.target.value)} required disabled={!!editing} placeholder="jean.dupont" />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Mot de passe {editing ? '(laisser vide)' : '*'}</label>
                    <div style={{ position: 'relative' }}>
                      <input className="form-input" type={showPassword ? 'text' : 'password'} value={form.password}
                        onChange={e => updateField('password', e.target.value)} required={!editing}
                        style={{ paddingRight: 40 }} placeholder="••••••••" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Spécialité *</label>
                    <select className="form-input" value={form.specialty} onChange={e => updateField('specialty', e.target.value)} required>
                      <option value="">Choisir une spécialité...</option>
                      {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => updateField('email', e.target.value)} placeholder="email@example.com" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Téléphone</label>
                    <input className="form-input" value={form.phone} onChange={e => updateField('phone', e.target.value)} placeholder="+509 ..." />
                  </div>
                </div>
                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label">Âge</label>
                    <input className="form-input" type="number" value={form.age} onChange={e => updateField('age', e.target.value ? parseInt(e.target.value) : '')} placeholder="45" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Genre</label>
                    <select className="form-input" value={form.gender} onChange={e => updateField('gender', e.target.value)}>
                      <option value="Homme">Homme</option>
                      <option value="Femme">Femme</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">N° licence</label>
                    <input className="form-input" value={form.licenseNumber} onChange={e => updateField('licenseNumber', e.target.value)} placeholder="MSPP-..." />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Localisation</label>
                    <input className="form-input" value={form.location} onChange={e => updateField('location', e.target.value)} placeholder="Port-au-Prince, Haiti" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hôpital / Clinique</label>
                    <input className="form-input" value={form.hospital} onChange={e => updateField('hospital', e.target.value)} placeholder="Clinique..." />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Biographie</label>
                  <textarea className="form-input" value={form.biography} onChange={e => updateField('biography', e.target.value)} rows={3} placeholder="Courte biographie professionnelle..." />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">URL de l&apos;avatar</label>
                  <input className="form-input" value={form.avatarUrl} onChange={e => updateField('avatarUrl', e.target.value)} placeholder="https://..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? (
                    <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Enregistrement...</>
                  ) : editing ? (
                    <><Check size={15} /> Mettre à jour</>
                  ) : (
                    <><Plus size={15} /> Créer le médecin</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} color="#DC2626" />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: '#DC2626', letterSpacing: '-0.02em' }}>Confirmer la suppression</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Cette action est irréversible</p>
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setConfirmDelete(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Voulez-vous vraiment supprimer <strong style={{ color: 'var(--text-primary)' }}>{confirmDelete.name}</strong> ?
                Toutes les données associées seront effacées.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn btn-danger" style={{ background: '#DC2626', color: '#fff', border: 'none' }} onClick={() => handleDelete(confirmDelete)}>
                <Trash2 size={14} /> Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPw && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setResetPw(null); setNewPw(''); } }}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Réinitialiser le mot de passe</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Pour {resetPw.name}</p>
              </div>
              <button className="modal-close-btn" onClick={() => { setResetPw(null); setNewPw(''); }}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nouveau mot de passe</label>
                <input className="form-input" type="text" value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="Nouveau mot de passe (min. 4 car.)" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleResetPw(); }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setResetPw(null); setNewPw(''); }}>Annuler</button>
              <button className="btn btn-primary" onClick={handleResetPw}><Key size={14} /> Réinitialiser</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
