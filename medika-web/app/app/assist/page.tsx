"use client";

/**
 * Pale ak yon ajan Medika — the patient entry into the HUMAN assistance
 * contact center (brief #6).
 *
 * Honest states only: the queue position the server reports, the agent's
 * name once connected, a real callback option, and a working cancel.
 * Audio is in-app only (brief #10): the join button appears when the agent
 * accepted; telephone callback transport stays visibly unavailable until a
 * PSTN provider is configured (documented blocker — no simulated calls).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import {
  requestAssistance, getAssistStatus, cancelAssistance,
  requestCallback, getCurrentCallback, getAssistCallToken, endAssistCall,
  type AssistStatus, type AssistCallback,
} from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { AssistAudioSession } from "@/lib/call/assist-audio";
import { useSocket } from "@/lib/ws/socket-context";

const STATUS_LABEL: Record<string, string> = {
  none: "",
  waiting: "N ap chèche yon ajan ki dispo pou ou…",
  connecting: "Yon ajan reponn — n ap konekte…",
  connected: "Ou konekte ak yon ajan Medika",
  wrap_up: "N ap ranje dosye a — mèsi!",
};

export default function AssistPage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [callback, setCallback] = useState<AssistCallback | { status: "none" } | null>(null);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ roomName: string; token: string; appId: number } | null>(null);
  const audioRef = useRef<AssistAudioSession | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [callSeconds, setCallSeconds] = useState(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const s = await getAssistStatus(token);
      setStatus(s);
      setCallback(await getCurrentCallback(token));
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Poll while waiting — WS events (assist:queued/connected) make it instant
  // when they arrive; the poll guarantees convergence (brief #7 realtime).
  useEffect(() => {
    if (!token || !status || ["none", "wrap_up"].includes(status.status)) return;
    const t = setInterval(() => void refresh(), 8_000);
    return () => clearInterval(t);
  }, [token, status, refresh]);

  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string; sessionId?: string }) => {
      const type = (event as { type?: string }).type;
      if (type && type.startsWith("assist:")) void refresh();
    });
  }, [socket, refresh]);

  // Call duration ticks only while audio is live.
  useEffect(() => {
    if (!audio) return;
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1_000);
    return () => clearInterval(t);
  }, [audio]);

  const startAudio = async () => {
    if (!token || !status?.sessionId || busy) return;
    setBusy(true); setError(null);
    try {
      const t = await getAssistCallToken(token, status.sessionId);
      const session = new AssistAudioSession({ appId: t.appId, token: t.token, roomName: t.roomName, userId: user?.id ?? "patient" });
      await session.connect();
      audioRef.current = session;
      setAudio({ roomName: t.roomName, token: t.token, appId: t.appId });
      setCallSeconds(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Koneksyon odyo pa reyisi. Eseye ankò.");
    } finally { setBusy(false); }
  };

  const hangUp = async () => {
    audioRef.current?.disconnect();
    audioRef.current = null;
    setAudio(null);
    if (token && status?.sessionId) { try { await endAssistCall(token, status.sessionId); } catch { /* wrap-up state still recorded server-side */ } }
    void refresh();
  };

  const toggleMic = () => {
    const on = audioRef.current?.toggleMic() ?? micOn;
    setMicOn(on);
  };

  const ask = async () => {
    if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      setStatus(await requestAssistance(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "N pa t kapab voye demann lan.");
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!token || busy) return;
    setBusy(true);
    try { await cancelAssistance(token); await refresh(); } finally { setBusy(false); }
  };

  const askCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !phone || busy) return;
    setBusy(true); setError(null);
    try {
      setCallback(await requestCallback(token, { phoneNumber: phone, reason: reason || undefined }));
      setPhone(""); setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "N pa t kapab anrejistre callback lan.");
    } finally { setBusy(false); }
  };

  if (!token) {
    return (
      <main className="page">
        <section className="panel"><p>Ouvri sesyon ou pou w ka pale ak yon ajan Medika.</p></section>
      </main>
    );
  }

  const st = status?.status ?? "none";
  const dur = `${Math.floor(callSeconds / 60)}:${String(callSeconds % 60).padStart(2, "0")}`;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Pale ak yon ajan Medika</h1>
        <p className="muted">Yon vrè moun nan ekip Medika ap ede w jwenn doktè ki bon pou ou, epi fin peman ou.</p>
      </header>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      {/* Connect flow */}
      <section className="panel" aria-labelledby="assist-cta">
        <div className="panel-head"><h2 id="assist-cta">Asistans dirèk</h2></div>
        {st === "none" && (
          <div className="stack">
            <p className="muted">N ap pran infòmasyon ou, n ap chèche doktè ki koresponn ak bezwen ou, n ap gide w nan peman MonCash la.</p>
            <button className="btn btn-primary" onClick={ask} disabled={busy}>
              {busy ? "N ap voye…" : "Mande yon ajan kounye a"}
            </button>
          </div>
        )}
        {st !== "none" && (
          <div className="stack">
            <p className={`status-line ${st === "connected" ? "ok" : "warn"}`} role="status">
              {STATUS_LABEL[st] ?? st}
            </p>
            {status?.agentName && <p><strong>Ajan:</strong> {status.agentName}</p>}
            {typeof status?.position === "number" && status.position > 0 && (
              <p className="muted">Pozisyon ou nan keu a: {status.position}</p>
            )}

            {st === "connected" && !audio && (
              <button className="btn btn-primary" onClick={startAudio} disabled={busy}>
                {busy ? "N ap konekte odyo…" : "Konekte odyo a"}
              </button>
            )}
            {st === "connected" && audio && (
              <div className="call-controls">
                <span className="call-timer">{dur}</span>
                <button className="btn" onClick={toggleMic}>{micOn ? "Fèmi mikro" : "Louvri mikro"}</button>
                <button className="btn btn-danger" onClick={hangUp}>Finis apèl la</button>
              </div>
            )}
            {(st === "waiting" || st === "connecting") && (
              <button className="btn" onClick={cancel} disabled={busy}>Anile demann lan</button>
            )}
          </div>
        )}
      </section>

      {/* Callback (brief #8) — the honest alternative to waiting */}
      <section className="panel" aria-labelledby="assist-cb">
        <div className="panel-head"><h2 id="assist-cb">Mande yon callback</h2></div>
        {"callbackId" in (callback ?? {}) && callback && (callback as AssistCallback).status && !["completed", "cancelled", "failed"].includes((callback as AssistCallback).status) ? (
          <div className="stack">
            <p><strong>Callback aktif:</strong> {(callback as AssistCallback).phoneNumber}</p>
            <p className="muted">
              Estati: {(callback as AssistCallback).status}
              {typeof (callback as AssistCallback).retryCount === "number" && (
                <> · Tantativ: {(callback as AssistCallback).retryCount}/{(callback as AssistCallback).maxRetries}</>
              )}
            </p>
            {!((callback as AssistCallback).phoneVerified) && (
              <p className="muted warn-text">Nimewo a poko verifye — yon ajan ap konfime l avè w.</p>
            )}
          </div>
        ) : (
          <form className="stack" onSubmit={askCallback}>
            <label>
              Nimewo pou n rele w
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+509 …" inputMode="tel" />
            </label>
            <label>
              Kisa ou bezwen? (opsyonèl)
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Egzanp: m bezwen yon doktè pou tchèk jeneral" />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy || phone.length < 5}>
              Mande callback
            </button>
            <p className="muted">Yon ajan prale rele w nan fenèt ou chwazi a. Apèl la rive nan aplikasyon an.</p>
          </form>
        )}
      </section>
    </main>
  );
}
