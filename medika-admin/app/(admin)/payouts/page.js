'use client';

/**
 * Payout management (issue #24) — admin schedules and records manual MonCash
 * payouts on the 15th / 30th cycle calendar (February: last calendar day).
 *
 * Workflow: for each due cycle, every doctor's eligible amount is listed with
 * its earning count (reconcilable against the ledger). The admin performs the
 * manual MonCash transfer FIRST, then clicks "Payé" and records the transfer
 * reference. Settlement is idempotent: a repeated click returns the existing
 * payout, never a double payment.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';
import { BadgeCheck, ChevronDown, ChevronUp, Clock, RefreshCw, Wallet } from 'lucide-react';

export default function PayoutsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null); // cycle endDate of the expanded row
  const [payTarget, setPayTarget] = useState(null); // { doctor, cycle }
  const [reference, setReference] = useState('');
  const [settling, setSettling] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/admin/payouts')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const settle = async () => {
    if (!payTarget || settling) return;
    setSettling(true);
    try {
      const res = await apiFetch('/admin/payouts/settle', {
        method: 'POST',
        body: JSON.stringify({
          doctorId: payTarget.doctor.doctorId,
          cycleStart: payTarget.cycle.startDate,
          cycleEnd: payTarget.cycle.endDate,
          moncashReference: reference.trim() || undefined,
        }),
      });
      if (res.alreadyPaid) {
        showToast('Ce versement etait deja enregistre comme paye — aucun doublon cree.', 'error');
      } else {
        showToast(`Versement enregistre: ${formatCurrency(res.payout.amount)} pour ${res.payout.doctor_name} (ref: ${res.payout.moncash_reference || 'sans reference'})`);
      }
      setPayTarget(null);
      setReference('');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSettling(false);
    }
  };

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;
  }
  if (error && !data) {
    return (
      <div className="empty-state">
        <p>Impossible de charger les versements: {error}</p>
        <button className="btn btn-primary" onClick={load}>Reessayer</button>
      </div>
    );
  }

  const dueCycles = (data.cycles || []).filter((c) => c.due);
  const upcomingCycles = (data.cycles || []).filter((c) => !c.due);

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Versements Medika (MonCash)</h1>
          <p style={{ fontSize: 13, color: 'var(--mk-text-secondary)', marginTop: 4 }}>
            Cycles du 15 et du 30 de chaque mois (fevrier : dernier jour). Enregistrez un versement
            uniquement apres avoir execute et verifie le transfert MonCash manuel.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Rafraichir
        </button>
      </div>

      {/* ── Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Total eligible non verse</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--mk-brand)' }}>{formatCurrency(data.totalAvailable || 0)}</div>
          <div style={{ fontSize: 13, color: 'var(--mk-text-secondary)', marginTop: 4 }}>{data.totalAvailableCount || 0} gain(s) disponible(s)</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Cycles a regler</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: dueCycles.length > 0 ? 'var(--mk-warning)' : 'var(--mk-success)' }}>{dueCycles.length}</div>
          <div style={{ fontSize: 13, color: 'var(--mk-text-secondary)', marginTop: 4 }}>cycle(s) termine(s) avec gains non verses</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Cycle en cours</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--mk-brand)' }}>{data.currentCycle.label}</div>
          <div style={{ fontSize: 13, color: 'var(--mk-text-secondary)', marginTop: 4 }}>Prochain paiement le {data.currentCycle.endDate}</div>
        </div>
      </div>

      {/* ── Due cycles (oldest first) ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mk-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <BadgeCheck size={18} color="var(--mk-brand)" />
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Cycles a payer (les plus anciens d&apos;abord)</h2>
        </div>
        {dueCycles.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}><p>Aucun gain en attente de versement. Tout est a jour.</p></div>
        ) : (
          dueCycles.map((cycle) => (
            <div key={cycle.endDate} style={{ borderBottom: '1px solid var(--mk-border)' }}>
              <button
                onClick={() => setExpanded(expanded === cycle.endDate ? null : cycle.endDate)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Cycle {cycle.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                    {cycle.count} gain(s) · {cycle.doctors.length} medecin(s)
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <strong style={{ color: 'var(--mk-brand)' }}>{formatCurrency(cycle.total)}</strong>
                  {expanded === cycle.endDate ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>
              {expanded === cycle.endDate && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Medecin</th>
                      <th style={{ textAlign: 'right' }}>Gains</th>
                      <th style={{ textAlign: 'right' }}>Montant eligible</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycle.doctors.map((doc) => (
                      <tr key={doc.doctorId}>
                        <td style={{ fontWeight: 600 }}>{doc.doctorName}</td>
                        <td style={{ textAlign: 'right' }}>{doc.earningCount}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(doc.amount)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => { setPayTarget({ doctor: doc, cycle }); setReference(''); }}
                          >
                            <Wallet size={14} /> Paye
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Upcoming (accumulating) cycles ── */}
      {upcomingCycles.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mk-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="var(--mk-text-secondary)" />
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Cycle(s) en accumulation</h2>
          </div>
          {upcomingCycles.map((cycle) => (
            <div key={cycle.endDate} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid var(--mk-border)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Cycle {cycle.label}</div>
                <div style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                  Reglable a partir du {cycle.endDate} · {cycle.count} gain(s)
                </div>
              </div>
              <strong>{formatCurrency(cycle.total)}</strong>
            </div>
          ))}
        </div>
      )}

      {/* ── Payout history ── */}
      <div className="card">
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mk-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Historique des versements</h2>
        </div>
        {(data.payouts || []).length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}><p>Aucun versement enregistre pour le moment.</p></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Medecin</th>
                <th>Cycle</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>Gains</th>
                <th>Ref MonCash</th>
                <th>Enregistre par</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.doctor_name}</td>
                  <td>{p.cycle_start} &rarr; {p.cycle_end}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(p.amount)}</td>
                  <td style={{ textAlign: 'right' }}>{p.earning_count}</td>
                  <td>{p.moncash_reference || '—'}</td>
                  <td>{p.paid_by_admin_name || '—'}</td>
                  <td>{formatDate(p.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Settle confirmation modal ── */}
      {payTarget && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !settling) setPayTarget(null); }}>
          <div className="modal-content" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--mk-brand)' }}>Confirmer le versement</h2>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>
                Marquer le versement de <strong>{formatCurrency(payTarget.doctor.amount)}</strong> a{' '}
                <strong>{payTarget.doctor.doctorName}</strong> pour le cycle{' '}
                <strong>{payTarget.cycle.label}</strong> comme <strong>paye</strong>.
              </p>
              <p style={{ color: 'var(--mk-danger)', fontWeight: 600, fontSize: 13 }}>
                N&apos;enregistrez ce versement qu&apos;apres avoir effectue ET verifie le transfert MonCash
                manuel. Les {payTarget.doctor.earningCount} gain(s) concernes passeront en &laquo; payes &raquo;.
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="moncash-ref">Reference de la transaction MonCash (optionnelle)</label>
                <input
                  id="moncash-ref"
                  className="form-input"
                  type="text"
                  maxLength={200}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="ex: MC-TRF-20261030-01"
                  disabled={settling}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPayTarget(null)} disabled={settling}>Annuler</button>
              <button className="btn btn-primary" onClick={settle} disabled={settling}>
                {settling ? 'Enregistrement...' : 'Confirmer le paiement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
