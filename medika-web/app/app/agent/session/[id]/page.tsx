"use client";

/**
 * Active agent session (brief #9) — the three-zone contact-center workspace.
 * Zone A: call controls (real in-app audio via ZEGO; no decorative buttons).
 * Zone B: minimum-necessary patient info. Zone C: the booking wizard.
 * Call end ≠ session end: wrap-up is an explicit step (brief #15).
 *
 * Owner brief (this rewrite): the agent impersonates the member — they fill
 * THE MEMBER'S OWN REQUEST FORM (the exact /app/consult intake: symptoms,
 * urgency, specialty), then the doctor, then the payment, in the SAME order
 * the member would. The wizard shows ONE step at a time and switches
 * AUTOMATICALLY: submitting the form advances to the doctor step, picking a
 * doctor advances to the payment step, and the member's validated payment
 * advances to the booked confirmation — no manual navigation between steps.
 * The step shown is DERIVED from server state on every refresh (poll + WS),
 * so the frontend never lies about where the booking stands.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { useSocket } from "@/lib/ws/socket-context";
import {
  agentSession, agentSessionDoctor, agentSessionNote,
  agentSessionIntake, agentCreatePaymentRequest, agentCancelPaymentRequest,
  agentCallStart, agentCallEnd, agentSessionComplete, agentSpecialties, agentDoctors,
  type AgentSessionDetail,
} from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { formatCurrency } from "@/lib/format";
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
import { Avatar } from "@/components/ui/primitives";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { SpecialtySelect, type SpecialtyOption } from "@/components/ui/SpecialtySelect";
import { AssistAudioSession } from "@/lib/call/assist-audio";

const STAGES = [
  ["form", "Fòm pasyan an"],
  ["doctor", "Doktè a"],
  ["payment", "Peman"],
  ["booked", "Konfime"],
  ["wrapup", "Fen sesyon"],
] as const;

type StageKey = (typeof STAGES)[number][0];

/** Raw internal values — the backend contract; display labels come from
 *  urgencyLabel() exactly like the member's own intake form. */
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
  // THE MEMBER'S FORM, filled by the agent on their behalf — hydrated once
  // per session, then it is the agent's working draft (a refresh never
  // clobbers what they typed).
  const [symptoms, setSymptoms] = useState("");
  const [urgency, setUrgency] = useState<string>("Moyenne");
  const [specialty, setSpecialty] = useState<string>("");
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
  /** Local "go back" override (modify the form / change doctor). Cleared by
   *  any successful action — the server-derived stage then takes over again. */
  const [stageOverride, setStageOverride] = useState<StageKey | null>(null);
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

  // Hydrate the form draft ONLY on first load of a given session — later
  // refreshes (poll/WS) must never overwrite what the agent is typing.
  useEffect(() => {
    if (!detail || intakeHydratedFor.current === detail.session.sessionId) return;
    intakeHydratedFor.current = detail.session.sessionId;
    setSymptoms(detail.session.intake.description);
    setUrgency(detail.session.intake.urgencyLevel);
    setSpecialty(detail.session.specialty || "");
  }, [detail]);

  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event: { type?: string }) => {
      const type = (event as { type?: string }).type;
      if (type?.startsWith("agent:")) void refresh();
    });
  }, [socket, refresh]);

  // While the payment request is pending on the member's device, poll the
  // session every 5s — the WS event usually wins, this is the safety net
  // that keeps the wizard switching steps even if the socket hiccups.
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
    try { await fn(); await refresh(); setStageOverride(null); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Aksyon pa reyisi."); }
    finally { setBusy(false); }
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

  /** Load the filtered doctor list for the chosen specialty. */
  const loadDoctors = useCallback(async (spec: string) => {
    if (!token || !spec) return;
    setDoctors(null);
    try { setDoctors(await agentDoctors(token, { specialty: spec })); }
    catch { setError("N pa t kapab chaje doktè yo."); }
  }, [token]);

  // The doctor list loads when the wizard reaches the doctor step.
  useEffect(() => {
    const st = detail?.session;
    if (st && st.specialty && !st.chosenDoctorId && stageOverride !== "form" && !doctors && !searchResults) {
      void loadDoctors(st.specialty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.session.sessionId, detail?.session.specialty, detail?.session.chosenDoctorId, stageOverride]);

  /** Submit THE MEMBER'S FORM (symptoms + urgency + specialty — the member's
   *  own three inputs, their words). Success auto-advances to the doctor
   *  step: the server now holds the specialty, and the wizard derives from
   *  server state. */
  const submitMemberForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !sessionId) return;
    if (!symptoms.trim()) {
      setError("Tanpri, ekri sa pasyan an ap senti anvan w kontinye.");
      return;
    }
    if (!specialty) {
      setError("Tanpri, chwazi yon espesyalite medikal.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await agentSessionIntake(token, sessionId, {
        description: symptoms.trim(),
        urgencyLevel: urgency,
        specialty,
      });
      setStageOverride(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fòm lan pa sove.");
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
  const formDone = Boolean(s.intake.description || s.reason);
  const doctorDone = Boolean(s.chosenDoctorId);
  const paid = payReq?.status === "paid" || s.consultState !== "payment_pending";
  const sessionOver = s.status === "completed";

  // Server-authoritative stage — the wizard ALWAYS shows exactly this step.
  let stage: StageKey =
    paid || (sessionOver && doctorDone) ? "booked"
    : doctorDone ? "payment"
    : s.specialty ? "doctor"
    : formDone ? "doctor"
    : "form";
  if (stageOverride) stage = stageOverride;
  // Wrap-up/completed sessions: the wrap-up panel drives the page.
  const inWrapUp = s.status === "wrap_up" || sessionOver;
  const stageIndex = sessionOver ? 5 : s.status === "wrap_up" ? 4 : STAGES.findIndex(([key]) => key === stage);

  const dur = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const specialtyPrice = prices.find((p) => p.name === s.specialty)?.price ?? null;
  const specialtyOptions: SpecialtyOption[] = prices.map((p) => ({
    value: p.name,
    label: specialtyLabel(p.name),
    priceLabel: formatCurrency(p.price),
  }));
  const doctorEvent = detail.events.find((e) => e.type === "doctor_presented");
  const doctorName = (doctorEvent?.metadata?.doctorName as string | undefined) ?? doctorEvent?.actor ?? "—";
  const chosenDoctor = (searchResults ?? doctors ?? []).find((d) => d.id === s.chosenDoctorId) ?? null;
  const canRequestPayment =
    s.status === "active" && !paid &&
    (!payReq || ["expired", "cancelled", "failed"].includes(payReq.status));

  const pickButton = (d: User) => (
    <button className="btn btn-primary" disabled={busy}
      onClick={() => act(() => agentSessionDoctor(token!, sessionId, d.id))}>
      Pasyan an chwazi doktè sa a
    </button>
  );

  const doctorList = (list: User[]) => (
    <ul className="stack">
      {list.map((d) => (
        <li key={d.id} className="doctor-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <strong>{d.name}</strong>
              {d.verification_status === "verified" && <VerifiedBadge compact />}
              {d.is_available === 1 ? <span className="badge badge-green">Disponib</span> : <span className="badge badge-gray">Pa disponib</span>}
            </p>
            <p className="muted">{specialtyLabel(d.specialty)}{d.hospital ? ` · ${d.hospital}` : ""}</p>
          </div>
          {pickButton(d)}
        </li>
      ))}
    </ul>
  );

  return (
    <main className="page agent-workspace">
      <header className="page-head">
        <h1>Sesyon asistans</h1>
        <p className="muted">Refrans: {s.sessionId.slice(0, 12)}… · Estati: {s.status}</p>
      </header>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      {/* Stage indicator — advances automatically with the server state */}
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

        {/* Zone C: the booking wizard — ONE step at a time, auto-switching */}
        <section className="panel zone-c" aria-labelledby="flow">
          <div className="panel-head"><h2 id="flow">Gid planifikasyon an</h2></div>
          <div className="stack">

            {/* ── STEP 1: THE MEMBER'S OWN FORM (the agent fills it for them) ── */}
            {stage === "form" && !inWrapUp && (
              <form className="stack" onSubmit={submitMemberForm}>
                <div>
                  <h3>Fòm konsiltasyon pasyan an</h3>
                  <p className="muted small">Ou ranpli fòm nan POU pasyan an — menm fòm, menm kesyon yo ak sou sèvis la. Mo pasyan an, pa mo ou.</p>
                </div>
                <div className="field">
                  <label htmlFor="intake-desc">Sa pasyan an ap santi</label>
                  <textarea id="intake-desc" className="input" rows={4} maxLength={2000} value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                    placeholder="Eksplike sa pasyan an ap santi, depi kilè sa kòmanse, ak nenpòt lòt detay ki enpòtan..." />
                  <p className="field-hint">Kesyon: Ki sa ou ap senti? Depi kilè? Ki jan sa ye kounye a?</p>
                </div>
                <div className="field">
                  <span className="label" id="intake-urgency-label">Ki jan sitiyasyon an ijan?</span>
                  <div className="tabs" role="group" aria-labelledby="intake-urgency-label">
                    {URGENCY_LEVELS.map((u) => (
                      <button key={u} type="button" className={urgency === u ? "active" : ""}
                        aria-pressed={urgency === u}
                        onClick={() => setUrgency(u)}>
                        {urgencyLabel(u)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label id="intake-specialty-label" htmlFor="intake-specialty">Espesyalite medikal</label>
                  <SpecialtySelect
                    id="intake-specialty"
                    options={specialtyOptions}
                    value={specialty}
                    onChange={setSpecialty}
                    loading={prices.length === 0}
                    ariaLabel="Espesyalite medikal"
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  Kontinye
                </button>
              </form>
            )}

            {/* ── STEP 2: THE DOCTOR (search by name first, or the specialty list) ── */}
            {stage === "doctor" && !inWrapUp && (
              <div className="stack">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h3>{specialtyLabel(s.specialty || "")}</h3>
                    <p className="muted small">Chèche doktè ki disponib… montre kredansyèl yo ba pasyan an — se PASSYAN an ki chwazi.</p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setStageOverride("form")}>
                    <ArrowLeft size={14} aria-hidden /> Modifye fòm lan
                  </button>
                </div>
                {formDone && (
                  <p className="muted small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <CheckCircle2 size={14} aria-hidden /> Fòm pasyan an sove — ijans: {urgencyLabel(s.intake.urgencyLevel || "Moyenne")}
                  </p>
                )}
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
                    : doctorList(searchResults))}
                </form>
                {doctors === null && !searchResults && <p className="muted" aria-busy="true">N ap chèche doktè ki disponib…</p>}
                {doctors !== null && doctors.length === 0 && (
                  <div className="card text-center">
                    <p className="muted">Nou pa jwenn doktè pou espesyalite sa a.</p>
                    <p className="small muted">Eseye yon lòt espesyalite oswa fini sesyon an ak « Pa gen doktè dispo ».</p>
                    <button className="btn btn-secondary btn-sm mt-2" onClick={() => setStageOverride("form")}>
                      Chwazi yon lòt espesyalite
                    </button>
                  </div>
                )}
                {doctors !== null && doctors.length > 0 && doctorList(doctors)}
              </div>
            )}

            {/* ── STEP 3: PAYMENT (review card like the member sees, then the
                request lands on THEIR device while the call stays open) ── */}
            {stage === "payment" && !inWrapUp && (
              <div className="stack">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h3>Revize demann an</h3>
                    <p className="muted small">Verifye moun pasyan an ap konsilte ak sa yap peye anvan w voye demann peman an.</p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setStageOverride("doctor")}>
                    <ArrowLeft size={14} aria-hidden /> Chwazi yon lòt doktè
                  </button>
                </div>

                {/* Doctor identity — same card language as the member's flow */}
                <div className="card doctor-row" style={{ alignItems: "center" }}>
                  <Avatar name={chosenDoctor?.name ?? doctorName} src={chosenDoctor?.avatar_url} size="lg" alt={`Foto pwofil ${chosenDoctor?.name ?? doctorName}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{chosenDoctor?.name ?? doctorName}</strong>
                      {chosenDoctor?.verification_status === "verified" && <VerifiedBadge compact />}
                    </div>
                    <p className="muted">{specialtyLabel(chosenDoctor?.specialty ?? s.specialty ?? "")}{chosenDoctor?.hospital ? ` · ${chosenDoctor.hospital}` : ""}</p>
                    {chosenDoctor?.license_number && <p className="muted small">Lisans: {chosenDoctor.license_number}</p>}
                  </div>
                </div>

                {/* Consultation summary — price, urgency, the member's words */}
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="muted">Konsiltasyon ({specialtyLabel(s.specialty || "")})</span>
                    <strong>{specialtyPrice != null ? formatCurrency(specialtyPrice) : "—"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted small">Nivo ijans</span>
                    <span className="small">{urgencyLabel(s.intake.urgencyLevel || "Moyenne")}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <span className="muted small" style={{ paddingTop: 2 }}>Sa pasyan an di l ap santi</span>
                    <span className="small" style={{ textAlign: "right", maxWidth: "70%", whiteSpace: "pre-line" }}>
                      {s.intake.description.trim().length > 220 ? `${s.intake.description.trim().slice(0, 220)}…` : s.intake.description.trim()}
                    </span>
                  </div>
                </div>

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

                {(payReq?.status === "expired" || payReq?.status === "cancelled" || payReq?.status === "failed") && (
                  <p className="muted small">
                    Dènye demann peman an: {payReq.status} — ou ka voye yon lòt pandan sesyon an toujou aktif.
                  </p>
                )}

                {canRequestPayment && (
                  <button className="btn btn-primary" disabled={busy || specialtyPrice == null}
                    onClick={() => act(() => agentCreatePaymentRequest(token!, sessionId!))}>
                    <ShieldCheck size={16} aria-hidden /> Voye demann peman an{specialtyPrice != null ? ` — ${formatCurrency(specialtyPrice)}` : ""}
                  </button>
                )}
                <p className="muted small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <ExternalLink size={14} aria-hidden /> Peman an dewoule SOU TELEFÒN PASYAN AN — pa sou telefòn ou.
                </p>
              </div>
            )}

            {/* ── STEP 4: BOOKED — the member validated; the consultation exists ── */}
            {stage === "booked" && !inWrapUp && (
              <div className="stack">
                <div className="payreq-card paid" role="status">
                  <strong style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <CheckCircle2 size={18} aria-hidden /> Peman konfime — konsiltasyon kreye.
                  </strong>
                  <p className="muted">
                    Pasyon an ka rete nan apèl la; konsiltasyon an parèt nan tablodbò li avèk konvèsasyon an.
                    {s.consultationId && <> Ref: <code>{s.consultationId}</code></>}
                  </p>
                </div>
                <p className={`status-line ${s.consultState === "payment_pending" ? "warn" : "ok"}`} role="status">
                  {CONSULT_STATE_LABEL[s.consultState] ?? s.consultState}
                </p>
                {doctorDone && <p className="muted small"><Stethoscope size={14} aria-hidden /> Doktè: {chosenDoctor?.name ?? doctorName}</p>}
              </div>
            )}

            {/* Notes (internal ops — not part of the member's flow) */}
            {!inWrapUp && (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) { void act(() => agentSessionNote(token!, sessionId, noteText.trim())).then(() => setNoteText("")); } }}>
                <label className="label">Nòt entèn (pa gen done medikal)</label>
                <textarea className="input" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                <button className="btn" type="submit" disabled={busy || !noteText.trim()}>Anrejistre nòt</button>
              </form>
            )}
            {!inWrapUp && detail.notes.length > 0 && (
              <ul className="muted stack">
                {detail.notes.map((n) => <li key={n.id}>{n.content} — {n.agent}</li>)}
              </ul>
            )}

            {/* ── Wrap-up — explicit, separate from call end ── */}
            {s.status === "wrap_up" && (
              <div className="stack wrapup">
                <h3>Clotire sesyon an</h3>
                {stage === "booked" && (
                  <p className="status-line ok" role="status">Konsiltasyon an kreye — peman an valide.</p>
                )}
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
            {sessionOver && (
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
