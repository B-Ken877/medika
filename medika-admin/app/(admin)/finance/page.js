'use client';
import React, { useState, useEffect } from 'react';
import { apiFetch, formatCurrency } from '../../../lib/api';
import { DollarSign, TrendingUp, Users, Calendar } from 'lucide-react';

export default function FinancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/finance').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;
  if (!data) return <div className="empty-state"><p>Impossible de charger les donnees financieres</p></div>;

  const maxHistRevenue = Math.max(...data.history.map(h => h.revenue), 1);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Revenu du mois</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#059669' }}>{formatCurrency(data.currentMonth.revenue)}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{data.currentMonth.consultations} consultation(s) - {data.currentMonth.label}</div>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Calendar size={22} color="#059669" />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Revenu total</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>{formatCurrency(data.total.revenue)}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{data.total.consultations} consultation(s) terminee(s)</div>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={22} color="#2563eb" />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Prix par consultation</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>750 HTG</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Versement au medecin</div>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={22} color="#d97706" />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 15 }}>Historique des revenus (12 mois)</div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 220 }}>
            {data.history.map((h, i) => {
              const height = (h.revenue / maxHistRevenue) * 190;
              const isCurrentMonth = h.label === data.currentMonth.label;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: h.revenue > 0 ? '#059669' : '#9ca3af', marginBottom: 4, textAlign: 'center' }}>
                    {h.revenue > 0 ? formatCurrency(h.revenue) : ''}
                  </div>
                  <div style={{
                    width: '100%', maxWidth: 50, height: Math.max(height, 4),
                    background: isCurrentMonth ? 'linear-gradient(180deg, #059669, #047857)' : h.revenue > 0 ? 'linear-gradient(180deg, #10b981, #059669)' : '#f3f4f6',
                    borderRadius: '6px 6px 0 0', opacity: isCurrentMonth ? 1 : 0.7
                  }} />
                  <div style={{ fontSize: 10, color: isCurrentMonth ? '#059669' : '#6b7280', marginTop: 6, fontWeight: isCurrentMonth ? 700 : 400, textAlign: 'center' }}>
                    {h.month}<br />{String(h.year).slice(2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 15 }}>Gains par medecin</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr>
              <th>Medecin</th><th>Specialite</th>
              <th style={{ textAlign: 'right' }}>Consult. (mois)</th><th style={{ textAlign: 'right' }}>Gains (mois)</th>
              <th style={{ textAlign: 'right' }}>Consult. (total)</th><th style={{ textAlign: 'right' }}>Gains (total)</th>
            </tr></thead>
            <tbody>
              {data.doctorEarnings.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">Aucun medecin</td></tr>
              ) : data.doctorEarnings.map(doc => (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Users size={16} color="#059669" />{doc.name}</div>
                  </td>
                  <td><span className="badge badge-blue">{doc.specialty}</span></td>
                  <td style={{ textAlign: 'right' }}>{doc.monthlyConsultations}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>{formatCurrency(doc.monthlyEarnings)}</td>
                  <td style={{ textAlign: 'right' }}>{doc.totalConsultations}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(doc.totalEarnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 15 }}>Transactions recentes (ce mois)</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Patient</th><th>Medecin</th><th>Specialite</th><th style={{ textAlign: 'right' }}>Montant</th>
            </tr></thead>
            <tbody>
              {data.recentTransactions.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">Aucune transaction ce mois</td></tr>
              ) : data.recentTransactions.map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 13 }}>{formatDate(t.date)}</td>
                  <td style={{ fontWeight: 600 }}>{t.patientName}</td>
                  <td>{t.doctorName}</td>
                  <td><span className="badge badge-blue">{t.specialty}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>{formatCurrency(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}