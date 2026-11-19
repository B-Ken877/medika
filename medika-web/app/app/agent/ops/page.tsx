"use client";

/**
 * Supervisor workspace (brief #18) — live operational overview + agent
 * status + recent sessions + today's reports. Monitoring metrics do NOT
 * grant conversation access: no call audio, no recordings (policy).
 * Server-side requireRole('agent_supervisor'|'admin') is the real gate.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { agentOpsOverview, agentOpsSessions, agentOpsReports } from "@/lib/api/endpoints";

const PRESENCE_LABEL: Record<string, string> = {
  available: "Dispo", busy: "Sou sesyon", on_break: "Repo",
  offline: "Ale", wrapping_up: "Ap ranje", technical_issue: "Teknik",
};

export default function AgentOpsPage() {
  const { token, user } = useAuth();
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof agentOpsOverview>> | null>(null);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof agentOpsSessions>> | null>(null);
  const [reports, setReports] = useState<Awaited<ReturnType<typeof agentOpsReports>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [o, s, r] = await Promise.all([agentOpsOverview(token), agentOpsSessions(token), agentOpsReports(token)]);
      setOverview(o); setSessions(s); setReports(r); setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError("Se supervizè ak administratè ki gen aksè a.");
      else if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [token, refresh]);

  if (!token) {
    return <main className="page"><section className="panel"><p>Ouvri sesyon ou.</p></section></main>;
  }
  if (user && !["agent_supervisor", "admin"].includes(user.role)) {
    return <main className="page"><section className="panel"><p>Espas sa a se pou supervizè yo.</p></section></main>;
  }

  const m = overview?.metrics ?? {};

  return (
    <main className="page">
      <header className="page-head">
        <h1>Superviz — operasyon ajan</h1>
        <p className="muted">Metrik yo soti nan dosye ki anrejistre — yo pa janm fabrike.</p>
      </header>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      <section className="panel" aria-labelledby="live">
        <div className="panel-head"><h2 id="live">Konprann kounye a</h2></div>
        <div className="stat-grid">
          <div className="stat-card"><span className="stat-value">{m.agents_available ?? 0}</span><span className="stat-label">Ajan dispo</span></div>
          <div className="stat-card"><span className="stat-value">{m.agents_busy ?? 0}</span><span className="stat-label">Sou sesyon</span></div>
          <div className="stat-card"><span className="stat-value">{m.sessions_waiting ?? 0}</span><span className="stat-label">Pasyan ap tann</span></div>
          <div className="stat-card"><span className="stat-value">{m.callbacks_pending ?? 0}</span><span className="stat-label">Callbacks an tann</span></div>
          <div className="stat-card"><span className="stat-value">{m.sessions_wrapping_up ?? 0}</span><span className="stat-label">Ap ranje dosye</span></div>
        </div>
      </section>

      <section className="panel" aria-labelledby="agents">
        <div className="panel-head"><h2 id="agents">Ajan yo</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ajan</th><th>Estati</th><th>Vakt</th><th>Dènye batman kè</th></tr></thead>
            <tbody>
              {(overview?.agents ?? []).map((a) => (
                <tr key={a.agentId}>
                  <td>{a.name}</td>
                  <td>{PRESENCE_LABEL[a.availability] ?? a.availability}</td>
                  <td>{a.shiftStatus ?? "—"}</td>
                  <td>{new Date(a.lastHeartbeat).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="reps">
        <div className="panel-head"><h2 id="reps">Pèfòmans jodi a</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ajan</th><th>Sesyon fini</th><th>Demann konsiltasyon</th><th>Pa rezoud</th><th>Mwayen sesyon</th></tr></thead>
            <tbody>
              {(reports?.perAgent ?? []).map((a) => (
                <tr key={a.agentId}>
                  <td>{a.name}{a.employeeRef ? ` (${a.employeeRef})` : ""}</td>
                  <td>{a.completed}</td>
                  <td>{a.consultRequests}</td>
                  <td>{a.unresolved}</td>
                  <td>{a.avgSessionSeconds ? `${Math.round(a.avgSessionSeconds / 60)} min` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="sess">
        <div className="panel-head"><h2 id="sess">Dènye sesyon yo</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pasyan</th><th>Ajan</th><th>Estati</th><th>Rezilta</th><th>Spesyalite</th><th>Kreye</th></tr></thead>
            <tbody>
              {(sessions ?? []).slice(0, 25).map((s) => (
                <tr key={s.sessionId}>
                  <td>{s.patientName}</td>
                  <td>{s.agentName ?? "—"}</td>
                  <td>{s.status}</td>
                  <td>{s.outcome ?? "—"}</td>
                  <td>{s.specialty ?? "—"}</td>
                  <td>{new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
