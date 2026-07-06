'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, formatCurrency } from '../../../lib/api';
import { Tag, Save, RotateCcw, Check, Loader } from 'lucide-react';

export default function TarificationPage() {
  const [specialties, setSpecialties] = useState([]);
  const [original, setOriginal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

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
      setToast({ type: 'success', msg: 'Tarifs mis a jour avec succes!' });
    } catch (e) {
      setToast({ type: 'error', msg: e.message });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleReset = () => {
    setSpecialties(JSON.parse(JSON.stringify(original)));
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Tarification par specialite</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6b7280' }}>Definissez le prix de consultation pour chaque specialite</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {hasChanges && (
            <button className="btn btn-secondary" onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={16} /> Annuler
            </button>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges || saving} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: !hasChanges || saving ? 0.6 : 1 }}>
            {saving ? <Loader size={16} className="spin" /> : <Save size={16} />}
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 100, padding: '12px 20px',
          borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 14,
          background: toast.type === 'success' ? '#059669' : '#dc2626',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 8
        }}>
          {toast.type === 'success' ? <Check size={18} /> : null}
          {toast.msg}
        </div>
      )}

      {/* Pricing Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {specialties.map(spec => (
          <div key={spec.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb'
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: '#dbeafe',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Tag size={18} color="#2563eb" />
              </div>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{spec.name}</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Prix de consultation (HTG)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  value={spec.price}
                  onChange={(e) => updatePrice(spec.id, e.target.value)}
                  style={{
                    flex: 1, padding: '10px 14px', border: '2px solid #e5e7eb', borderRadius: 8,
                    fontSize: 18, fontWeight: 700, color: '#111827', outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#059669'}
                  onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>HTG</span>
              </div>
              {spec.price > 0 && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, fontSize: 12, color: '#374151' }}>
                  <span style={{ color: '#059669', fontWeight: 600 }}>Medecin: {formatCurrency(spec.price - 250)}</span>
                  {' | '}
                  <span style={{ color: '#b45309', fontWeight: 600 }}>Medika: {formatCurrency(250)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
