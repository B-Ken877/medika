"use client";

/**
 * Active agent session (brief #9) — the three-zone contact-center workspace.
 * Zone A: call controls (real in-app audio via ZEGO; no decorative buttons).
 * Zone B: minimum-necessary patient info. Zone C: the guided scheduling
 * workflow with an always-visible stage indicator. Call end ≠ session end:
 * wrap-up is an explicit step (brief #15).
 *
 * Owner brief — the agent works ON BEHALF of the member during the call:
 *  - the intake form (reason for the visit, what the member says they feel,
 *    urgency) is OPEN from the moment the call starts and is saved to the
 *    member's session (migration 017); medical-history updates are captured
 *    as session notes (clinical history is a later workstream);
 *  - the member's PREFERRED doctor is searchable by name, across all
 *    specialties;
 *  - "Submit Payment" pushes a simulated MonCash-style request (phone +
 *    4-digit PIN) to the member's device — the call NEVER drops, and the
 *    consultation is created for the member on confirmation (nobody is
 *    redirected; it appears on the member's dashboard).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { useSocket } from "@/lib/ws/socket-context";
import {
  agentSession, agentSessionSpecialty, agentSessionDoctor, agentSessionNote,
  agentSessionIntake, agentCreatePaymentRequest, agentCancelPaymentRequest,
  agentCallStart, agentCallEnd, agentSessionComplete, agentSpecialties, agentDoctors,
  type AgentSessionDetail,
} from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { urgencyLabel } from "@/lib/labels";
import { AssistAudioSession } from "@/lib/call/assist-audio";

const STAGES = [
  ["identify", "Idantifikasyon"],
  ["request", "Demann"],
  ["specialty", "Espesyalite"],
  ["doctor", "Doktè"],
  ["payment", "Peman"],
  ["wrapup", "Fen sesyon"],
] as const;

/** Raw internal values — the backend contract; display labels come from
 *  urgencyLabel() exactly like the manual self-service flow. */
const URGENCY_LEVELS = ["Faible", "Moyenne", "Haute", "Critique"] as const;

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
  // Intake ON BEHALF of the member — hydrated once per session, then it is
  // the agent's working draft (a refresh never clobbers what they typed).
  const [intakeReason, setIntakeReason] = useState("");
  const [intakeDescription, setIntakeDescription] = useState("");
  const [intakeUrgency, setIntakeUrgency] = useState<string>("Moyenne");
  const [historyNote, setHistoryNote] = useState("");
  const [intakeSaved, setIntakeSaved] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[] | null>(null);
  const [searching, setSearching] = useState(false);
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
  const intakeHydratedFor = useRef<string | null>(null);

  const payReq = detail?.paymentRequest ?? null;

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

  // Hydrate the intake draft ONLY on first load of a given session — later
  // refreshes (poll/WS) must never overwrite what the agent is typing.
  useEffect(() => {
    if (!detail || intakeHydratedFor.current === detail.session.sessionId) return;
    intakeHydratedFor.current = detail.session.sessionId;
    setIntakeReason(detail.session.intake.reason);
    setIntakeDescription(detail.session.intake.description);
    setIntakeUrgency(detail.session.intake.urgencyLevel);
    setIntakeSaved(Boolean(detail.session.intake.description));
  }, [detail]);

  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string }) => {
      const type = (event as { type?: string }).type;
      if (type?.startsWith("agent:")) void refresh();
    });
  }, [socket, refresh]);

  // While the payment request is pending on the member's device, poll the
  // session every 5s — the WS event usually wins, this is the safety net.
  useEffect(() => {
    if (payReq?.status !== "pending" || !token) return;
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [payReq?.status, token, refresh]);

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
    try { setDoctors(await agentDoctors(token, { specialty })); }
    catch { setError("N pa t kapab chaje doktè yo."); }
  };

  /** Preferred-doctor search (owner brief): the member names a doctor, the
   *  agent searches by name across ALL specialties. */
  const searchDoctors = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!token || !docQuery.trim()) return;
    setSearching(true); setSearchResults(null); setError(null);
    try { setSearchResults(await agentDoctors(token, { q: docQuery.trim() })); }
    catch { setError("Rechèch doktè a pa reyisi."); }
    finally { setSearching(false); }
  };

  /** Save the on-behalf intake: reason + what the member feels + urgency.
   *  An optional medical-history update is captured as a session note
   *  (clinical history workstream comes later). */
  const saveIntake = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !sessionId) return;
    setBusy(true); setError(null);
    try {
      await agentSessionIntake(token, sessionId, {
        reason: intakeReason.trim(),
        description: intakeDescription.trim(),
        urgencyLevel: intakeUrgency,
      });
      if (historyNote.trim()) {
        await agentSessionNote(token, sessionId, `Dosye medikal: ${historyNote.trim()}`);
        setHistoryNote("");
      }
      setIntakeSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Entèvyou a pa sove.");
    } finally { setBusy(false); }
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
    : (s.intake.description || s.reason) ? 2 : 1;

  const dur = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const specialtyPrice = prices.find((p) => p.name === s.specialty)?.price;
  // The doctor_presented event carries the doctor's name in its metadata —
  // the actor is the agent who recorded it, not the doctor.
  const doctorEvent = detail.events.find((e) => e.type === "doctor_presented");
  const doctorName = (doctorEvent?.metadata?.doctorName as string | undefined) ?? doctorEvent?.actor ?? "—";
  const canRequestPayment =
    s.status === "active" && s.consultState === "payment_pending" &&
    (!payReq || ["expired", "cancelled", "failed"].includes(payReq.status));

  const pickButton = (d: User) => (
    <button className="btn btn-primary" disabled={busy}
      onClick={() => act(() => agentSessionDoctor(token!, sessionId, d.id))}>
      Pasyan an chwazi doktè sa a
    </button>
  );

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
            <p className="muted small">Apèl la DWE pa finis pandan peman an ap dewoule — pasyan an peye sou telefòn li pandan y ap pale ak ou.</p>
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
            {/* 2. Intake ON BEHALF of the member — OPEN whenever the session
                is live: the agent asks the questions and writes the member's
                own words down (owner brief). */}
            {s.status !== "completed" && (
              <form className="stack intake-card" onSubmit={saveIntake}>
                <h3>Entèvyou pasyan an (ou ranpli l pou li)</h3>
                <div className="field">
                  <label className="label" htmlFor="intake-reason">Rezon vizit la</label>
                  <input id="intake-reason" className="input" value={intakeReason}
                    onChange={(e) => { setIntakeReason(e.target.value); setIntakeSaved(false); }}
                    placeholder="Egzanp: pasyan an vle konsilte pou tèt li fè mal" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="intake-desc">Sa pasyan an ap santi (mo pasyan an)</label>
                  <textarea id="intake-desc" className="input" rows={4} maxLength={2000} value={intakeDescription}
                    onChange={(e) => { setIntakeDescription(e.target.value); setIntakeSaved(false); }}
                    placeholder="Kesyon: Ki sa ou ap santi? Depi kilè? Ki jan sa ye kounye a?" />
                </div>
                <div className="field">
                  <span className="label" id="intake-urgency-label">Ki jan sitiyasyon an ijan?</span>
                  <div className="tabs" role="group" aria-labelledby="intake-urgency-label">
                    {URGENCY_LEVELS.map((u) => (
                      <button key={u} type="button" className={intakeUrgency === u ? "active" : ""}
                        aria-pressed={intakeUrgency === u}
                        onClick={() => { setIntakeUrgency(u); setIntakeSaved(false); }}>
                        {urgencyLabel(u)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="intake-history">Mizajou dosye medikal? (opsyonèl — pwochen etap)</label>
                  <input id="intake-history" className="input" value={historyNote}
                    onChange={(e) => setHistoryNote(e.target.value)}
                    placeholder="Egzanp: li pran nouvo medikaman depi mwa a" />
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" type="submit" disabled={busy}>Anrejistre entèvyou a</button>
                  {intakeSaved && <span className="status-line ok" role="status">Entèvyou a sove ✓</span>}
                </div>
              </form>
            )}

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

            {/* 4. Doctor discovery + selection (patient decides). The member's
                PREFERRED doctor is searchable by name first (owner brief). */}
            {s.specialty && !s.chosenDoctorId && s.status !== "completed" && (
              <>
                <form className="stack" onSubmit={searchDoctors}>
                  <label className="label" htmlFor="doc-search">Doktè pi renmen pasyan an? Chèche non l</label>
                  <div className="btn-row">
                    <input id="doc-search" className="input" style={{ flex: 1 }} value={docQuery}
                      onChange={(e) => setDocQuery(e.target.value)}
                      placeholder="Egzanp: Doktè Deux" />
                    <button className="btn" type="submit" disabled={busy || searching || !docQuery.trim()}>
                      {searching ? "N ap chèche…" : "Chèche"}
                    </button>
                  </div>
                  {searchResults && (searchResults.length === 0
                    ? <p className="muted">Pa jwenn doktè ak non sa a — gade lis spesyalite a anba oswa eseye yon lòt non.</p>
                    : (
                      <ul className="stack">
                        {searchResults.map((d) => (
                          <li key={d.id} className="doctor-row">
                            <div>
                              <p><strong>{d.name}</strong> {d.verification_status === "verified" ? "· verifye" : ""}</p>
                              <p className="muted">{d.specialty}{d.hospital ? ` · ${d.hospital}` : ""}</p>
                            </div>
                            {pickButton(d)}
                          </li>
                        ))}
                      </ul>
                    ))}
                </form>
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
                          {pickButton(d)}
                        </li>
                      ))}
                    </ul>
                  ))}
                <p className="muted">Anvan peman: montre kredansyèl doktè a ba pasyan an, epi se PASYAN an ki chwazi (brief #12).</p>
              </>
            )}

            {/* 5-7. Submit Payment — the agent raises the request; the member
                pays on THEIR device while the call keeps running. */}
            {s.chosenDoctorId && s.status !== "completed" && (
              <div className="stack">
                <p><strong>Doktè chwazi:</strong> {doctorName}</p>

                {payReq?.status === "pending" && (
                  <div className="payreq-card pending" role="status">
                    <strong>N ap tann pasyan an peye sou telefòn li…</strong>
                    <p className="muted">
                      Pop-up peman an louvri sou sèvis pasyan an — APÈL LA RETE LOUVRI.
                      Pa finis apèl la pandan pwosesis sa a.
                    </p>
                    <p className="muted small">
                      Montan: {payReq.amount} {payReq.currency} · Ekspire:{" "}
                      {payReq.expiresAt ? new Date(payReq.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </p>
                    <div className="btn-row">
                      <button className="btn btn-sm" disabled={busy}
                        onClick={() => act(() => agentCancelPaymentRequest(token!, sessionId!))}>
                        Anile demann an
                      </button>
                    </div>
                  </div>
                )}

                {payReq?.status === "paid" && (
                  <div className="payreq-card paid" role="status">
                    <strong>Peman konfime — konsiltasyon kreye.</strong>
                    <p className="muted">
                      Pasyon an ka rete nan apèl la; konsiltasyon an parèt nan tablodbò li avèk konvèsasyon an.
                    </p>
                  </div>
                )}

                {(payReq?.status === "expired" || payReq?.status === "cancelled" || payReq?.status === "failed") && (
                  <p className="muted small">
                    Dènye demann peman an: {payReq.status} — ou ka voye yon lòt pandan sesyon an toujou aktif.
                  </p>
                )}

                {canRequestPayment && (
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => act(() => agentCreatePaymentRequest(token!, sessionId!))}>
                    Voye demann peman an{specialtyPrice != null ? ` — ${specialtyPrice} HTG` : ""}
                  </button>
                )}

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
