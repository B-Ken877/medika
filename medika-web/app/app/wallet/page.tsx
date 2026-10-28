"use client";

/**
 * Doctor wallet (issue #24).
 *
 * Read-only view of the doctor's earnings ledger and payout history:
 *   * available amount (completed consultations with verified payments,
 *     not yet paid out) with the per-cycle breakdown;
 *   * pending amount (completed consultations whose payment is not
 *     verified yet — not payable);
 *   * already-paid totals + the full payout history (cycle, amount,
 *     MonCash reference, admin actor);
 *   * the current accumulating cycle and when it pays out (15th / 30th —
 *     February: last calendar day).
 *
 * There is deliberately NO withdraw/request button: payouts are scheduled
 * and performed by an admin via manual MonCash transfers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getDoctorWallet } from "@/lib/api/endpoints";
import type { DoctorWallet } from "@/lib/api/types";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { specialtyLabel } from "@/lib/labels";
import { EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

export default function WalletPage() {
  const { token } = useAuth();
  const [wallet, setWallet] = useState<DoctorWallet | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    getDoctorWallet(token, controller.signal)
      .then((w) => {
        setWallet(w);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setWallet(null);
      });
  }, [token]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Revni mwen</h1>
          <p className="page-desc">
            Swiv revni ou yo ak peman Medika ou yo. Peman yo fet chak 15 ak 30 mwa a.
          </p>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={load} />
      {wallet === null && !error && (
        <div className="panel" aria-busy="true">
          <div style={{ padding: 24 }}>
            <SkeletonRows count={4} />
          </div>
        </div>
      )}

      {wallet && (
        <>
          {/* Summary */}
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Rezime revni yo">
            <div className="stat-card">
              <div className="stat-label">
                <span className="stat-dot green" aria-hidden /> Disponib pou peman
              </div>
              <div className="stat-value" style={{ fontSize: 24 }}>{formatCurrency(wallet.available.amount)}</div>
              <div className="row-meta">{wallet.available.count} konsiltasyon</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                <span className="stat-dot yellow" aria-hidden /> An atant verifikasyon
              </div>
              <div className="stat-value" style={{ fontSize: 24 }}>{formatCurrency(wallet.pendingPayment.amount)}</div>
              <div className="row-meta">{wallet.pendingPayment.count} konsiltasyon</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">
                <span className="stat-dot blue" aria-hidden /> Deja peye
              </div>
              <div className="stat-value" style={{ fontSize: 24 }}>{formatCurrency(wallet.paidOut.amount)}</div>
              <div className="row-meta">{wallet.paidOut.count} peman</div>
            </div>
          </div>

          {/* Current cycle + unpaid per-cycle breakdown */}
          <section className="panel" aria-labelledby="cycle-title">
            <div className="panel-head">
              <h2 id="cycle-title" className="panel-title">Sik kouran an</h2>
            </div>
            <div className="panel-row" style={{ minHeight: 60 }}>
              <div className="row-body">
                <div className="row-title">
                  <span>{wallet.currentCycle.label}</span>
                </div>
                <div className="row-meta">
                  Pwochen peman an pwograme pou {wallet.currentCycle.endDate} (15 ak 30 chak mwa).
                </div>
              </div>
            </div>
            {wallet.unpaidCycles.map((c) => (
              <div key={c.endDate} className="panel-row" style={{ minHeight: 56 }}>
                <div className="row-body">
                  <div className="row-title">
                    <span>{c.label}</span>
                    <StatusBadge status={c.due ? "TERMINE" : "RECHERCHE_MEDECIN"} />
                  </div>
                  <div className="row-meta">
                    {c.due ? "Pret pou peman" : "Ap akimile"} · {c.count} konsiltasyon
                  </div>
                </div>
                <div className="row-actions">
                  <strong>{formatCurrency(c.amount)}</strong>
                </div>
              </div>
            ))}
          </section>

          {/* Recent earnings */}
          <section className="panel" aria-labelledby="earnings-title">
            <div className="panel-head">
              <h2 id="earnings-title" className="panel-title">Dènye revni yo</h2>
            </div>
            {wallet.earnings.length === 0 ? (
              <EmptyState
                icon={<Wallet size={24} />}
                title="Pa gen revni pou kounye a"
                description="Lè yon konsiltasyon fini ak peman an verifie, revni l ap parèt isit."
              />
            ) : (
              wallet.earnings.map((e) => (
                <div key={e.id} className="panel-row" style={{ minHeight: 60 }}>
                  <div className="row-body">
                    <div className="row-title">
                      <span>{e.patient_name || "Pasyan"}</span>
                      <StatusBadge status={e.status === "PAID" ? "TERMINE" : "RECHERCHE_MEDECIN"} />
                    </div>
                    <div className="row-meta">
                      {specialtyLabel(e.specialty)} · {e.available_at ? formatDateTime(e.available_at) : ""} · Franchiz: {formatCurrency(e.platform_fee)}
                    </div>
                  </div>
                  <div className="row-actions">
                    <strong>{formatCurrency(e.net_amount)}</strong>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Payout history */}
          <section className="panel" aria-labelledby="payouts-title">
            <div className="panel-head">
              <h2 id="payouts-title" className="panel-title">Istorik peman yo</h2>
            </div>
            {wallet.payouts.length === 0 ? (
              <EmptyState
                icon={<Wallet size={24} />}
                title="Pa gen peman anko"
                description="Peman Medika yo fet pa administrasyon an chak 15 ak 30 mwa a."
              />
            ) : (
              wallet.payouts.map((p) => (
                <div key={p.id} className="panel-row" style={{ minHeight: 60 }}>
                  <div className="row-body">
                    <div className="row-title">
                      <span>{p.cycle_start} → {p.cycle_end}</span>
                      <StatusBadge status="TERMINE" />
                    </div>
                    <div className="row-meta">
                      Peje {p.paid_at ? formatDateTime(p.paid_at) : ""} · {p.earning_count} konsiltasyon
                      {p.moncash_reference ? ` · Ref MonCash: ${p.moncash_reference}` : ""}
                    </div>
                  </div>
                  <div className="row-actions">
                    <strong>{formatCurrency(p.amount)}</strong>
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
