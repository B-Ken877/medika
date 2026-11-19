"use client";

/**
 * Active agent session (brief #9) — the three-zone contact-center workspace.
 * Zone A: call controls (real in-app audio via ZEGO; no decorative buttons).
 * Zone B: minimum-necessary patient info. Zone C: the guided scheduling
 * workflow with an always-visible stage indicator. Call end ≠ session end:
 * wrap-up is an explicit step (brief #15).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { useSocket } from "@/lib/ws/socket-context";
import {
  agentSession, agentSessionSpecialty, agentSessionDoctor, agentSessionNote,
  agentCallStart, agentCallEnd, agentSessionComplete, agentSpecialties,
  getDoctorsBySpecialty, getAssistCallToken,
  type AgentSessionDetail,
} from "@/lib/api/endpoints";
import { SpecialtyPrice } from "@/lib/api/types";
import type { User } from "@/lib/api/types";
import { AssistAudioSession } from "@/lib/call/assist-audio";

const STAGES = [
  ["identify", "Idantifikasyon"],
  ["request", "Demann"],
  ["specialty", "Espesyalite"],
  ["doctor", "Doktè"],
  ["payment", "Peman"],
  ["wrapup", "Fen sesyon"],
] as const;

const OUTCOME_LABEL: Record<string, string> = {
  consultation_initiated: "Demann konsiltasyon kreye",
  payment_pending: "Peman an tann",
  consultation_booked: "Konsiltasyon konfime",
  callback_required: "Callback nesesè",
  no_doctor_available: "Pa gen doktè dispo",
  information_provided: "Enfòmasyon bay pasyan an",
  patient_cancelled: "Pasyan an anile",
  patient_disconnected: "Pasyan an dekonekte",
  transferred: "Transfè",
  escalated: "Eskale",
  unresolved: "Pa rezoud",
};

const CONSULT_STATE_LABEL: Record<string, string> = {
  payment_pending: "Peman an poko fin — pasyan an ap peye sou telefòn li",
  request_submitted: "Demann soumèt",
  awaiting_doctor: "Demann soumèt — n ap tann yon doktè aksepte",
  doctor_accepted: "Doktè a aksepte — konsiltasyon an kòmanse",
  consultation_completed: "Konsiltasyon an fini",
  doctor_declined: "Doktè a refize — sistèm nan ap chèche yon lòt",
  reassignment_required: "Reasiytasyon nesesè",
};

export default function AgentSessionPage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [detail, setDetail] = useState<AgentSessionDetail | null>(null);
  const [prices, setPrices] = useState<SpecialtyPrice[]>([]);
  const [doctors, setDoctors] = useState<User[] | null>(null);
  const [noteText, setNoteText] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const audioRef = useRef<AssistAudioSession | null>(null);
  const remoteRef = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !sessionId) return;
    try { setDetail(await agentSession(token, sessionId)); setError(null); }
    catch (err) {
      if (err instanceof ApiError && err.status === 403) setError("Sesyon sa a pa ou.");
      else if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, [token, sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!token) return;
    void agentSpecialties(token).then(setPrices).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string; sessionId?: string }) => {
      const type = (event as { type?: string; sessionId?: string }).type;
      if (type?.startsWith("agent:")) void refresh();
    });
  }, [socket, refresh]);

  useEffect(() => {
    if (!audio) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [audio]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Aksyon pa reyisi."); }
    finally { setBusy(false); }
  };

  const loadDoctors = async (specialty: string) => {
    if (!token) return;
    setDoctors(null);
    try { setDoctors(await getDoctorsBySpecialty(token, specialty)); }
    catch { setError("N pa t kapab chaje doktè yo."); }
  };

  const startCall = async () => {
    if (!token || !sessionId) return;
    setBusy(true); setError(null);
    try {
      const t = await agentCallStart(token, sessionId);
      const s = new AssistAudioSession({ appId: t.appId, token: t.token, roomName: t.roomName, userId: user?.id ?? "agent" });
      s.attachRemote(remoteRef.current);
      await s.connect();
      audioRef.current = s;
      setAudio(true); setSeconds(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Odyo a pa konekte — pasyan an ap resevwa yon notifikasyon.");
    } finally { setBusy(false); }
  };

  const endCall = async (failureReason = "") => {
    audioRef.current?.disconnect();
    audioRef.current = null;
    setAudio(false);
    if (token && sessionId) await act(() => agentCallEnd(token, sessionId, failureReason));
  };

  if (!token) {
    return <main className="page"><section className="panel"><p>Ouvri sesyon ou.</p></section></main>;
  }
  if (error && !detail) {
    return <main className="page"><section className="panel"><p>{error}</p></section></main>;
  }
  if (!detail) {
    return <main className="page"><section className="panel" aria-busy="true"><p>N ap chaje sesyon an…</p></section></main>;
  }

  const s = detail.session;
  const stageIndex = s.status === "completed" ? 5
    : s.consultState !== "payment_pending" ? 5
    : s.chosenDoctorId ? 4
    : s.specialty ? 3
    : s.reason ? 2 : 1;

  const dur = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const specialtyPrice = prices.find((p) => p.name === s.specialty)?.price;

  return (
    <main className="page agent-workspace">
      <header className="page-head">
        <h1>Sesyon asistans</h1>
        <p className="muted">Refrans: {s.sessionId.slice(0, 12)}… · Estati: {s.status}</p>
      </header>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      {/* Stage indicator */}
      <ol className="stage-bar" aria-label="Etap yo">
        {STAGES.map(([key, label], i) => (
          <li key={key} className={i === stageIndex ? "current" : i < stageIndex ? "done" : ""}>{label}</li>
        ))}
      </ol>

      <div className="workspace-grid">
        {/* Zone A: call panel */}
        <section className="panel" aria-labelledby="callp">
          <div className="panel-head"><h2 id="callp">Apèl</h2>{audio && <span className="call-timer">{dur}</span>}</div>
          <audio ref={remoteRef} className="hidden-audio" />
          <div className="stack">
            {!audio && s.status === "active" && (
              <button className="btn btn-primary" onClick={startCall} disabled={busy}>
                Kòmanse apèl la (sèlman odyo)
              </button>
            )}
            {audio && (
              <div className="btn-row">
                <button className="btn" onClick={() => setMicOn(audioRef.current?.toggleMic() ?? micOn)}>
                  {micOn ? "Fèmi mikro" : "Louvri mikro"}
                </button>
                <button className="btn btn-danger" onClick={() => endCall()} disabled={busy}>Finis apèl</button>
              </div>
            )}
            {s.callEndedAt && <p className="muted">Apèl la fini. {s.status === "wrap_up" ? "Ranje dosye a anvan ou vin dispo." : ""}</p>}
            {!audio && s.callStartedAt && !s.callEndedAt && (
              <button className="btn btn-danger" onClick={() => endCall("connection_failed")} disabled={busy}>
                Make koneksyon an echwe
              </button>
            )}
          </div>
        </section>

        {/* Zone B: patient info — minimum necessary (brief #11) */}
        <section className="panel" aria-labelledby="pat">
          <div className="panel-head"><h2 id="pat">Pasyan</h2></div>
          <div className="stack">
            <p><strong>{detail.patient?.name ?? "—"}</strong></p>
            {detail.patient?.phone && <p className="muted">Telefòn: {detail.patient.phone}</p>}
            <p className="muted">Lang: {s.language === "fr" ? "Franse" : "Kreyòl"}</p>
            {s.reason && <p>Bezwen: {s.reason}</p>}
          </div>
        </section>

        {/* Zone C: guided workflow */}
        <section className="panel zone-c" aria-labelledby="flow">
          <div className="panel-head"><h2 id="flow">Gid planifikasyon an</h2></div>
          <div className="stack">
            {/* 3. Specialty */}
            {!s.specialty && s.status !== "completed" && (
              <>
                <label className="label">Espesyalite ki koresponn ak demann lan (pasyan an deside sa li bezwen — nou pa diagnostike)</label>
                <select className="input" onChange={(e) => e.target.value && act(() => agentSessionSpecialty(token!, sessionId, e.target.value))} defaultValue="">
                  <option value="" disabled>Chwazi yon spesyalite…</option>
                  {prices.map((p) => <option key={p.id} value={p.name}>{p.name} — {p.price} HTG</option>)}
                </select>
              </>
            )}
            {s.specialty && specialtyPrice != null && (
              <p><strong>{s.specialty}</strong> · Pri estanda: {specialtyPrice} HTG</p>
            )}

            {/* 4. Doctor discovery + selection (patient decides) */}
            {s.specialty && !s.chosenDoctorId && s.status !== "completed" && (
              <>
                <div className="btn-row">
                  <button className="btn" onClick={() => loadDoctors(s.specialty!)} disabled={busy}>
                    {doctors ? "Rechaje doktè yo" : `Gade doktè ${s.specialty}`}
                  </button>
                </div>
                {doctors && (doctors.length === 0
                  ? <p className="muted">Pa gen doktè pou spesyalite sa a kounye a — eksplike sitiyasyon an, epi anrejistre yon callback oswa fini sesyon an ak « Pa gen doktè dispo ».</p>
                  : (
                    <ul className="stack">
                      {doctors.map((d) => (
                        <li key={d.id} className="doctor-row">
                          <div>
                            <p><strong>{d.name}</strong> {d.verification_status === "verified" ? "· verifye" : ""}</p>
                            <p className="muted">{d.specialty}{d.hospital ? ` · ${d.hospital}` : ""}{d.biography ? ` · ${d.biography.slice(0, 90)}` : ""}</p>
                          </div>
                          <button className="btn btn-primary" disabled={busy}
                            onClick={() => act(() => agentSessionDoctor(token!, sessionId, d.id))}>
                            Pasyan an chwazi doktè sa a
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
                <p className="muted">Anvan peman: montre kredansyèl doktè a ba pasyan an, epi se PASYAN an ki chwazi (brief #12).</p>
              </>
            )}

            {/* 5-7. Patient approval + payment happens on the PATIENT's device */}
            {s.chosenDoctorId && s.status !== "completed" && (
              <div className="stack">
                <p><strong>Doktè chwazi:</strong> {detail.events.find((e) => e.type === "doctor_presented")?.actor ?? "—"}</p>
                <p className="muted">Kredansyèl yo parèt nan paj doktè a — pasyan an ap konfime epi peye MonCash SOU TELEFÒN LI (nou pa manyen PIN li).</p>
                <p className={`status-line ${s.consultState === "payment_pending" ? "warn" : "ok"}`} role="status">
                  {CONSULT_STATE_LABEL[s.consultState] ?? s.consultState}
                </p>
              </div>
            )}

            {/* Notes */}
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) { void act(() => agentSessionNote(token!, sessionId, noteText.trim())).then(() => setNoteText("")); } }}>
              <label className="label">Nòt entèn (pa gen done medikal)</label>
              <textarea className="input" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <button className="btn" type="submit" disabled={busy || !noteText.trim()}>Anrejistre nòt</button>
            </form>
            {detail.notes.length > 0 && (
              <ul className="muted stack">
                {detail.notes.map((n) => <li key={n.id}>{n.content} — {n.agent}</li>)}
              </ul>
            )}

            {/* 8. Wrap-up — explicit, separate from call end */}
            {s.status === "wrap_up" && (
              <div className="stack wrapup">
                <h3>Clotire sesyon an</h3>
                <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">Rezilta…</option>
                  {Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <textarea className="input" rows={2} placeholder="Nòt rezilta (opsyonèl)" value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} />
                <button className="btn btn-primary" disabled={busy || !outcome}
                  onClick={() => act(() => agentSessionComplete(token!, sessionId, outcome, outcomeNote)).then(() => router.push("/app/agent"))}>
                  Clotire epi vin dispo
                </button>
              </div>
            )}
            {s.status === "completed" && (
              <p className="status-line ok">Sesyon an fini — rezilta: {OUTCOME_LABEL[s.outcome ?? ""] ?? s.outcome}</p>
            )}
          </div>
        </section>
      </div>

      {/* Audit trail */}
      <section className="panel" aria-labelledby="evts">
        <div className="panel-head"><h2 id="evts">Istorik sesyon</h2></div>
        <ol className="events">
          {detail.events.map((e, i) => (
            <li key={i}>{new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — {e.type}{e.actor ? ` (${e.actor})` : ""}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
