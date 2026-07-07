'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatCurrency } from '../../../lib/api';
import { Tag, Save, RotateCcw, Check, Loader, AlertCircle, Info } from 'lucide-react';

const SPECIALTY_ICONS = {
  'Médecine Générale': '🩺',
  'Cardiologie': '❤️',
  'Dermatologie': '🔬',
  'Endocrinologie': '⚗️',
  'Gastro-entérologie': '🫀',
  'Gynécologie': '👩‍⚕️',
  'Neurologie': '🧠',
  'Ophtalmologie': '👁️',
  'ORL': '👂',
  'Pédiatrie': '🧒',
  'Psychiatrie': '🧘',
  'Pneumologie': '🫁',
  'Radiologie': '🩻',
  'Rhumatologie': '🦴',
  'Urologie': '💊',
  'Chirurgie Générale': '🔪',
  'Orthopédie': '🦿',
  'Odontologie': '🦷',
  'Nutrition': '🥗',
  'Médecine Interne': '🏥',
};

// Fallback for legacy keys without accents
function getIcon(name) {
  // Try exact match first
  if (SPECIALTY_ICONS[name]) return SPECIALTY_ICONS[name];
  // Try case-insensitive
  const key = Object.keys(SPECIALTY_ICONS).find(k => k.toLowerCase() === name?.toLowerCase());
  return key ? SPECIALTY_ICONS[key] : '🏥';
}

const PLATFORM_FEE = 250;

export default function TarificationPage() {
  const [specialties, setSpecialties] = useState([]);
  const [original, setOriginal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/specialties');
      setSpecialties(data);
      setOriginal(JSON.parse(JSON.stringify(data)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updatePrice = (id, price) => {
    const val = parseInt(price) || 0;
    setSpecialties(prev => prev.map(s => s.id === id ? { ...s, price: Math.max(0, val) } : s));
  };

  const hasChanges = JSON.stringify(specialties) !== JSON.stringify(original);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/specialties', {
        method: 'PUT',
        body: JSON.stringify({ specialties: specialties.map(s => ({ id: s.id, price: s.price })) })
      });
      setOriginal(JSON.parse(JSON.stringify(specialties)));
      setToast({ type: 'success', msg: 'Tarifs mis à jour avec succès' });
    } catch (e) {
      setToast({ type: 'error', msg: e.message });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3500);
  };

  const handleReset = () => setSpecialties(JSON.parse(JSON.stringify(original)));

  const filtered = search
    ? specialties.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()))
    : specialties;

  const changedCount = specialties.filter((s, i) => s.price !== original[i]?.price).length;

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Configuration des prix
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
            Tarification
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Définissez le prix de consultation par spécialité médicale
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {hasChanges && (
            <>
              <span style={{
                fontSize: 12, fontWeight: 600, color: '#B45309',
                background: '#FEF3C7', border: '1px solid #FDE68A',
                borderRadius: 'var(--radius-full)', padding: '4px 10px',
              }}>
                {changedCount} modifi{changedCount > 1 ? 'és' : 'é'}
              </span>
              <button className="btn btn-secondary" onClick={handleReset}>
                <RotateCcw size={14} /> Annuler
              </button>
            </>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving
              ? <><Loader size={14} className="spin" /> Enregistrement...</>
              : <><Save size={14} /> Enregistrer les tarifs</>
            }
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#EFF6FF', border: '1px solid #BFDBFE',
        borderRadius: 'var(--radius-lg)', padding: '12px 16px',
        marginBottom: 24,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Info size={16} color="#2563EB" />
        </div>
        <div>
          <span style={{ fontSize: 13, color: '#1D4ED8', fontWeight: 600 }}>
            Frais de plateforme Medika : {formatCurrency(PLATFORM_FEE)} HTG par consultation
          </span>
          <span style={{ fontSize: 12.5, color: '#3B82F6', marginLeft: 8 }}>
            · Ce montant est déduit automatiquement du prix total
          </span>
        </div>
      </div>

      {/* Search */}
      {!loading && specialties.length > 4 && (
        <div className="search-box" style={{ maxWidth: 320, marginBottom: 20 }}>
          <Tag size={14} className="search-icon" />
          <input
            className="form-input"
            placeholder="Filtrer une spécialité..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className="pricing-card">
              <div className="pricing-card-header">
                <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
                <div className="skeleton" style={{ width: 120, height: 14 }} />
              </div>
              <div className="pricing-card-body">
                <div className="skeleton" style={{ width: 80, height: 11, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '100%', height: 42, borderRadius: 8 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(spec => {
            const isChanged = spec.price !== original.find(o => o.id === spec.id)?.price;
            const doctorGain = spec.price > PLATFORM_FEE ? spec.price - PLATFORM_FEE : 0;

            return (
              <div
                key={spec.id}
                className="pricing-card"
                style={{
                  outline: isChanged ? '2px solid var(--primary)' : 'none',
                  outlineOffset: 1,
                }}
              >
                <div className="pricing-card-header">
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: isChanged ? 'var(--primary-muted)' : 'var(--bg-sunken)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, transition: 'background var(--t-normal)',
                  }}>
                    {getIcon(spec.name)}
                  </div>
                  <span style={{
                    fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)',
                    flex: 1, letterSpacing: '-0.01em',
                  }}>
                    {spec.name}
                  </span>
                  {isChanged && (
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--primary)',
                      boxShadow: '0 0 0 3px var(--primary-glow)',
                      flexShrink: 0,
                    }} />
                  )}
                </div>

                <div className="pricing-card-body">
                  <label style={{
                    display: 'block', fontSize: 11, fontWeight: 700,
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.06em', marginBottom: 8,
                  }}>
                    Prix de consultation (HTG)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input
                        type="number"
                        min="0"
                        value={spec.price}
                        onChange={e => updatePrice(spec.id, e.target.value)}
                        style={{
                          width: '100%', padding: '10px 14px',
                          border: `2px solid ${isChanged ? 'var(--primary)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-md)',
                          fontSize: 20, fontWeight: 800,
                          color: isChanged ? 'var(--primary)' : 'var(--text-primary)',
                          outline: 'none',
                          transition: 'border-color 150ms ease, color 150ms ease',
                          fontFamily: 'inherit',
                          background: 'var(--bg-surface)',
                        }}
                        onFocus={e => {
                          e.target.style.borderColor = 'var(--primary)';
                          e.target.style.boxShadow = '0 0 0 3px var(--primary-glow)';
                        }}
                        onBlur={e => {
                          if (!isChanged) {
                            e.target.style.borderColor = 'var(--border)';
                          }
                          e.target.style.boxShadow = 'none';
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
                      HTG
                    </span>
                  </div>

                  {spec.price > 0 && (
                    <div style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      background: spec.price > PLATFORM_FEE ? '#F0FDF4' : '#FEF2F2',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${spec.price > PLATFORM_FEE ? '#BBF7D0' : '#FECACA'}`,
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                    }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#059669' }}>
                        Médecin: {formatCurrency(doctorGain)}
                      </span>
                      <span style={{ fontSize: 11.5, color: '#94A3B8' }}>|</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B45309' }}>
                        Medika: {formatCurrency(PLATFORM_FEE)}
                      </span>
                    </div>
                  )}
                  {spec.price === 0 && (
                    <div style={{
                      marginTop: 10, padding: '7px 12px',
                      background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)',
                      fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center',
                    }}>
                      Entrez un prix pour voir la répartition
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
