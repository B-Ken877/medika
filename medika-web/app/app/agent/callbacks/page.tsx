"use client";

/**
 * Callback management (brief #8) — the agent sees the pending pool and their
 * assigned callbacks, claims atomically, records results; retries follow the
 * server-configured policy. Previous attempts are visible before dialing.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { ApiError } from "@/lib/api/client";
import {
  agentCallbacks, agentClaimCallback, agentCallbackResult,
  type AssistCallbackView,
} from "@/lib/api/endpoints";

export default function AgentCallbacksPage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const [data, setData] = useState<{ mine: AssistCallbackView[]; pool: AssistCallbackView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setData(await agentCallbacks(token)); setError(null); }
    catch (err) { if (err instanceof ApiError && err.status !== 401) setError(err.message); }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string; sessionId?: string }) => {
      const type = (event as { type?: string }).type;
      if (type?.startsWith("agent:")) void refresh();
    });
  }, [socket, refresh]);

  const act = async (fn: () => Promise<Record<string, unknown>>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const out = await fn();
      if (out.connected && out.sessionId) setFlash("Konekte — sesyon an aktif nan espas ou.");
      await refresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Aksyon pa reyisi."); }
    finally { setBusy(false); }
  };

  if (!token) {
    return <main className="page"><section className="panel"><p>Ouvri sesyon ou.</p></section></main>;
  }
  if (user && !["agent", "agent_supervisor", "admin"].includes(user.role)) {
    return <main className="page"><section className="panel"><p>Espas sa a se pou ajan Medika yo.</p></section></main>;
  }

  const row = (c: AssistCallbackView, assignable: boolean) => (
    <li key={c.callbackId} className="offer-row">
      <div>
        <p><strong>{c.patientName}</strong> · {c.phoneNumber}
          {!c.phoneVerified && <span className="warn-text"> · poko verifye</span>}
        </p>
        <p className="muted">
          Estati: {c.status} · Tantativ: {c.retryCount ?? 0}/{c.maxRetries ?? "—"}
          {c.nextAttemptAt ? ` · Pwocha: ${new Date(c.nextAttemptAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {c.reason ? ` · ${c.reason.slice(0, 60)}` : ""}
        </p>
      </div>
      {assignable && (
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentClaimCallback(token, c.callbackId))}>Klèime</button>
        </div>
      )}
      {!assignable && c.status === "assigned" && (
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy} onClick={() => act(() => agentCallbackResult(token, c.callbackId, "connected"))}>Konekte</button>
          <button className="btn" disabled={busy} onClick={() => act(() => agentCallbackResult(token, c.callbackId, "no_answer"))}>Pa reponn</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => act(() => agentCallbackResult(token, c.callbackId, "cancelled"))}>Anile</button>
        </div>
      )}
    </li>
  );

  return (
    <main className="page">
      <header className="page-head">
        <h1>Callbacks</h1>
        <p className="muted">Pasyan yo ki mande yon rapel — politik repete a soti nan konfigirasyon an, pa janm ennDefini.</p>
      </header>

      {flash && <div className="banner" role="status">{flash}</div>}
      {error && <div className="banner banner-error" role="alert">{error}</div>}

      <section className="panel" aria-labelledby="mine">
        <div className="panel-head"><h2 id="mine">Sa m gen</h2></div>
        {!data || data.mine.length === 0 ? (
          <p className="muted">Pa gen callback ki afekte ou.</p>
        ) : <ul className="stack">{data.mine.map((c) => row(c, false))}</ul>}
      </section>

      <section className="panel" aria-labelledby="pool">
        <div className="panel-head"><h2 id="pool">Keu callbacks</h2><span className="muted">{data?.pool.length ?? 0}</span></div>
        {!data || data.pool.length === 0 ? (
          <p className="muted">Keu a vid.</p>
        ) : <ul className="stack">{data.pool.map((c) => row(c, true))}</ul>}
      </section>
    </main>
  );
}
