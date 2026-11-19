"use client";

/**
 * Agent dashboard (brief #17) — the first screen after agent login answers:
 * Am I working? Am I available? How many patients are waiting? Callbacks due?
 * Am I handling someone? What did I complete today? When does my shift end?
 *
 * Live: WS agent:offer + agent:session-update make the queue instant; a 15s
 * poll + heartbeat keeps presence honest even if the socket drops. Metrics
 * come from /api/agent/dashboard — server-persisted records only.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { ApiError } from "@/lib/api/client";
import {
  agentDashboard, agentHeartbeat, agentPresence, agentShiftStart, agentShiftEnd,
  agentBreakStart, agentBreakEnd, agentAcceptOffer, agentDeclineOffer,
  type AgentDashboard,
} from "@/lib/api/endpoints";

const PRESENCE_LABEL: Record<string, string> = {
  available: "Dispo",
  busy: "Sou yon sesyon",
  on_break: "Nan repo",
  offline: "Pa pre",
  wrapping_up: "Ap ranje dosye",
  technical_issue: "Pwoblèm teknik",
};

export default function AgentHomePage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const [dash, setDash] = useState<AgentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setDash(await agentDashboard(token)); setError(null); }
    catch (err) {
      if (err instanceof ApiError && err.status === 403) setError("Kont ou pa gen aksè a espas ajan an.");
      else if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Heartbeat + poll — a disconnected browser never stays falsely available
  // (server drops stale heartbeats to offline; brief #5).
  useEffect(() => {
    if (!token) return;
    const hb = setInterval(() => { void agentHeartbeat(token).catch(() => {}); }, 15_000);
    const poll = setInterval(() => void refresh(), 15_000);
    return () => { clearInterval(hb); clearInterval(poll); };
  }, [token, refresh]);

  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string; sessionId?: string }) => {
      const type = (event as { type?: string }).type;
      if (type && (type.startsWith("agent:") || type === "assist:connected")) void refresh();
    });
  }, [socket, refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Aksyon pa reyisi."); }
    finally { setBusy(false); }
  };

  if (!token) {
    return <main className="page"><section className="panel"><p>Ouvri sesyon ou pou ou ka kòmanse vakt ou.</p></section></main>;
  }
  if (user && !["agent", "agent_supervisor", "admin"].includes(user.role)) {
    return <main className="page"><section className="panel"><p>Espas sa a se pou ajan Medika yo.</p></section></main>;
  }

  const presence = dash?.presence ?? "offline";
  const shiftActive = dash?.shift && ["active", "on_break"].includes(dash.shift.status);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Espas Ajan</h1>
        <p className="muted">Kontak sant Medika — ede pasyan yo jwenn swen.</p>
      </header>

      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {!shiftActive && !dash?.shift && (
        <div className="banner" role="status">
          Kòmanse vakt ou anvan ou vin dispo pou resevwa apèl.
        </div>
      )}

      {/* A. Agent status */}
      <section className="panel" aria-labelledby="st">
        <div className="panel-head"><h2 id="st">Estati mwen</h2>
          <span className={`badge ${presence === "available" ? "ok" : presence === "busy" ? "warn" : ""}`}>
            {PRESENCE_LABEL[presence] ?? presence}
          </span>
        </div>
        <div className="stack">
          {dash?.shift && (
            <p className="muted">
              Vakt: {dash.shift.status} · Serede fini: {dash.shift.scheduledEnd ? new Date(dash.shift.scheduledEnd).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </p>
          )}
          <div className="btn-row">
            {!dash?.shift && <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentShiftStart(token))}>Kòmanse vakt</button>}
            {dash?.shift && presence === "offline" && <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentPresence(token, "available"))}>Vin dispo</button>}
            {dash?.shift && presence === "available" && <button className="btn" disabled={busy} onClick={() => act(() => agentBreakStart(token))}>Pran repo</button>}
            {dash?.shift && presence === "on_break" && <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentBreakEnd(token))}>Soti repo — vin dispo</button>}
            {dash?.shift && <button className="btn btn-danger" disabled={busy} onClick={() => act(() => agentShiftEnd(token))}>Fini vakt</button>}
          </div>
        </div>
      </section>

      {/* B. Incoming queue — targeted offers (never broadcast) */}
      <section className="panel" aria-labelledby="q">
        <div className="panel-head"><h2 id="q">Demann k ap vini</h2><span className="muted">{dash?.queueWaiting ?? 0} nan keu</span></div>
        {(dash?.offers.length ?? 0) === 0 ? (
          <p className="muted">Pa gen demann adrese ou kounye a.</p>
        ) : (
          <ul className="stack">
            {dash!.offers.map((o) => (
              <li key={o.assignmentId} className="offer-row">
                <div>
                  <p><strong>Pasyan ap tann</strong> · Lang: {o.language === "fr" ? "Franse" : "Kreyòl"}</p>
                  <p className="muted">
                    Ki lè: {new Date(o.offeredAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    {o.reason ? <> · {o.reason.slice(0, 80)}</> : null}
                  </p>
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentAcceptOffer(token, o.assignmentId))}>Aksepte</button>
                  <button className="btn" disabled={busy} onClick={() => act(() => agentDeclineOffer(token, o.assignmentId))}>Refize</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C. Pending callbacks */}
      <section className="panel" aria-labelledby="cb">
        <div className="panel-head"><h2 id="cb">Callbacks</h2><Link className="link" href="/app/agent/callbacks">Jere →</Link></div>
        {(dash?.callbacksPending.length ?? 0) === 0 ? (
          <p className="muted">Pa gen callback an tann.</p>
        ) : (
          <ul className="stack">
            {dash!.callbacksPending.slice(0, 4).map((c) => (
              <li key={c.callbackId}>
                {c.patientName} · {c.phoneNumber}
                {c.phoneVerified ? "" : " · nimewo poko verifye"} · {c.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* D. Active session */}
      {dash?.activeSession && (
        <section className="panel" aria-labelledby="act">
          <div className="panel-head"><h2 id="act">Sesyon aktif</h2></div>
          <Link className="btn btn-primary" href={`/app/agent/session/${dash.activeSession.sessionId}`}>
            Retounen nan sesyon an →
          </Link>
        </section>
      )}

      {/* E. Today's activity — persisted metrics only */}
      <section className="panel" aria-labelledby="today">
        <div className="panel-head"><h2 id="today">Jodi a</h2></div>
        <div className="stat-grid">
          <div className="stat-card"><span className="stat-value">{dash?.today.callsHandled ?? 0}</span><span className="stat-label">Sesyon fini</span></div>
          <div className="stat-card"><span className="stat-value">{dash?.today.consultRequests ?? 0}</span><span className="stat-label">Demann konsiltasyon</span></div>
          <div className="stat-card"><span className="stat-value">{dash?.today.unresolved ?? 0}</span><span className="stat-label">Pa rezoud</span></div>
        </div>
      </section>
    </main>
  );
}
