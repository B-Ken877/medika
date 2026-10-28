"use client";

/**
 * New consultation flow — web port of SymptomIntakeScreen.kt + PaymentActivity.kt.
 *
 * Step 1: describe symptoms + pick a specialty (prices from /api/specialties/prices)
 * Step 2: choose a doctor from the filtered list (GET /api/doctors?specialty=)
 * Step 3: payment — real mode: MonCash (create → gateway tab → verify), same
 *   protocol as Android. Simulated mode (server-discovered via
 *   /api/payment/config, only on authorized testing deployments): a
 *   server-verified simulated payment — no MonCash redirect, explicit test
 *   notice, success only after backend confirmation.
 * Step 4: POST /api/consultations (with payment metadata) → redirect to the chat
 *
 * Directory entry (?doctor=<id>): the doctor is resolved and kept selected, his
 * specialty is prefilled, and the patient still goes through the FULL intake
 * form (symptoms + urgency) before payment — the intake is never skipped.
 *
 * Includes anti-double-submit guards and 409/refresh handling on conflicts.
 * UI copy: Haitian Creole (display labels only — raw backend values for
 * specialty/urgency are preserved exactly as the API expects them).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FlaskConical,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { createConsultation, getDoctors, getSpecialtyPrices } from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { buildOrderId, createPayment, fetchPaymentMode, openPaymentGateway, verifyPayment, PaymentError } from "@/lib/payment";
import { formatCurrency } from "@/lib/format";
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { SpecialtySelect, type SpecialtyOption } from "@/components/ui/SpecialtySelect";

type Step = "intake" | "doctors" | "payment" | "creating";

function ConsultFlow() {
  const { token, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const preselectedDoctorId = params.get("doctor");

  const [step, setStep] = useState<Step>("intake");
  const [symptoms, setSymptoms] = useState("");
  const [specialty, setSpecialty] = useState<string>("");
  const [urgency, setUrgency] = useState<string>("Moyenne");
  const [prices, setPrices] = useState<SpecialtyPrice[]>([]);
  const [doctors, setDoctors] = useState<User[] | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<User | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Set when ?doctor=<id> could not be resolved — surfaced as a notice. */
  const [doctorNotFound, setDoctorNotFound] = useState(false);

  // Payment state
  const [payState, setPayState] = useState<"idle" | "creating" | "gateway" | "verifying" | "done" | "error">("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const orderIdRef = useRef<string>("");
  /** Server-discovered payment mode — "simulated" only when the backend runs
   * its isolated test-payment path (PAYMENT_SIMULATION on an authorized
   * non-production deployment). Display signal from the server; the backend
   * still authorizes every create/verify on its own. */
  const [payMode, setPayMode] = useState<"loading" | "real" | "simulated">("loading");
  /** True once the server accepted the simulated order for the current
   * doctor selection — lets a retry re-verify the SAME order instead of
   * creating orphan payment rows. */
  const simOrderReadyRef = useRef(false);

  /** Issue #31: the deliberate review/confirmation phase before the MonCash
   * gateway is opened. Reset whenever the doctor selection (or the payment
   * state tied to it) is reset, so stale review state is never reused. */
  const [reviewed, setReviewed] = useState(false);

  // Internal values sent to the backend (DB default: "Moyenne") — display
  // labels come from urgencyLabel(); the raw values must never change.
  const URGENCY_LEVELS = ["Faible", "Moyenne", "Haute", "Critique"];

  // Load prices once
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    getSpecialtyPrices(token, controller.signal)
      .then((list) => setPrices(Array.isArray(list) ? list : []))
      .catch(() => setPrices([]));
    return () => controller.abort();
  }, [token]);

  const priceOf = useCallback(
    (name: string) => prices.find((p) => p.name === name)?.price ?? null,
    [prices],
  );

  const specialtyOptions: SpecialtyOption[] = useMemo(
    () =>
      prices.map((p) => ({
        value: p.name, // raw backend value — used for price lookup and payloads
        label: specialtyLabel(p.name), // Haitian Creole display label
        priceLabel: formatCurrency(p.price),
      })),
    [prices],
  );

  // Discover the server's payment mode when the payment step is reached, so
  // the step labels itself honestly (test simulation vs real MonCash) before
  // the patient clicks anything. Server-authoritative signal; authorization
  // is still enforced per-request. Fails closed to the real-mode UI.
  useEffect(() => {
    if (step !== "payment") return;
    let cancelled = false;
    setPayMode("loading");
    fetchPaymentMode().then((mode) => {
      if (!cancelled) setPayMode(mode.simulated ? "simulated" : "real");
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  const findDoctors = useCallback(
    (specialtyName: string) => {
      if (!token || !specialtyName) return;
      setStep("doctors");
      setDoctors(null);
      setError(null);
      const controller = new AbortController();
      getDoctors(token, controller.signal)
        .then((list) => {
          const all = Array.isArray(list) ? list : [];
          const filtered = all.filter((d) => d.specialty === specialtyName);
          setDoctors(filtered);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err);
          setDoctors([]);
        });
    },
    [token],
  );

  // Preselected doctor via ?doctor=<id> (from the directory page).
  // The doctor is resolved and KEPT selected with his specialty prefilled, but
  // the patient still lands on the intake form — payment only happens after
  // the medical intake (symptoms + urgency) is completed and validated.
  useEffect(() => {
    if (!preselectedDoctorId || !token) return;
    const controller = new AbortController();
    getDoctors(token, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        const doc = (Array.isArray(list) ? list : []).find((d) => d.id === preselectedDoctorId);
        if (doc) {
          setSelectedDoctor(doc);
          if (doc.specialty) setSpecialty(doc.specialty);
          setDoctorNotFound(false);
          // Deliberately stay on "intake" — never jump straight to payment.
        } else {
          setDoctorNotFound(true);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Unreachable directory API: fall through to the normal intake flow.
        setDoctorNotFound(true);
      });
    return () => controller.abort();
  }, [preselectedDoctorId, token]);

  const onSpecialtyChange = (value: string) => {
    setSpecialty(value);
    // Explicitly drop a preselected doctor when the specialty no longer
    // matches — the patient then continues through the normal doctor list.
    if (selectedDoctor && value !== selectedDoctor.specialty) {
      setSelectedDoctor(null);
    }
  };

  const onIntakeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!symptoms.trim()) {
      setError(new ApiError("validation", 0, "Tanpri, di nou sa w ap senti anvan w kontinye."));
      return;
    }
    if (!specialty) {
      setError(new ApiError("validation", 0, "Tanpri, chwazi yon espesyalite medikal."));
      return;
    }
    setError(null);
    // Doctor already chosen from the directory (and still matching the
    // selected specialty) → go to the review step. Otherwise, show the
    // filtered doctor list.
    if (selectedDoctor && selectedDoctor.specialty === specialty) {
      setStep("payment");
      setReviewed(false);
      setPayState("idle");
      setPayError(null);
      setTransactionId(null);
      simOrderReadyRef.current = false;
    } else {
      findDoctors(specialty);
    }
  };

  const selectDoctor = (doc: User) => {
    setSelectedDoctor(doc);
    setStep("payment");
    setReviewed(false); // issue #31: every new selection starts at the review step
    setPayState("idle");
    setPayError(null);
    setTransactionId(null);
    simOrderReadyRef.current = false;
  };

  const startPayment = async () => {
    if (!selectedDoctor || payState === "creating") return;
    const amount = priceOf(selectedDoctor.specialty ?? specialty);
    if (!amount || amount <= 0) {
      setPayState("error");
      setPayError("Montan an pa valab. Tanpri, eseye ankò.");
      return;
    }
    setPayState("creating");
    setPayError(null);
    const orderId = buildOrderId(selectedDoctor.id);
    orderIdRef.current = orderId;
    try {
      const res = await createPayment({ orderId, amount });
      const opened = openPaymentGateway(res.redirectUrl);
      if (!opened) {
        // Popup blocked → tell the patient how to allow it.
        setPayState("error");
        setPayError(
          "Si paj peman an pa louvri, verifye si navigatè w la bloke fenèt pop-up yo, epi eseye ankò.",
        );
        return;
      }
      setPayState("gateway");
    } catch (err) {
      setPayState("error");
      setPayError(
        err instanceof PaymentError
          ? err.message
          : "Nou pa t kapab kòmanse peman an. Tanpri, eseye ankò.",
      );
    }
  };

  /** Simulated test payment (authorized testing deployments only — the
   * SERVER decides via PAYMENT_SIMULATION; this handler never fakes
   * anything locally). One click runs the server-verified flow: create a
   * clearly-identified simulated order → confirm it server-side. Success is
   * shown ONLY after the backend confirms; a server that refuses simulation
   * (mode changed, production guard) surfaces as an error, never as success. */
  const startSimulatedPayment = async () => {
    if (!selectedDoctor || payState === "creating" || payState === "verifying") return;
    const amount = priceOf(selectedDoctor.specialty ?? specialty);
    if (!amount || amount <= 0) {
      setPayState("error");
      setPayError("Montan an pa valab. Tanpri, eseye ankò.");
      return;
    }
    setPayError(null);
    try {
      if (!simOrderReadyRef.current) {
        // No accepted simulated order yet for this doctor selection → create
        // one (retries after a verify failure reuse it — no orphan rows).
        setPayState("creating");
        const orderId = buildOrderId(selectedDoctor.id);
        orderIdRef.current = orderId;
        const res = await createPayment({ orderId, amount });
        if (res.simulated !== true) {
          // The server did NOT run its simulated path — never fake success.
          setPayState("error");
          setPayError("Nou pa t kapab konfime peman tès la. Tanpri, eseye ankò.");
          return;
        }
        simOrderReadyRef.current = true;
      }
      setPayState("verifying");
      const result = await verifyPayment(orderIdRef.current);
      if (result.success) {
        setTransactionId(result.transactionId);
        setPayState("done");
      } else {
        setPayState("error");
        setPayError("Nou pa t kapab konfime peman tès la. Tanpri, eseye ankò.");
      }
    } catch (err) {
      setPayState("error");
      setPayError(
        err instanceof PaymentError
          ? err.message
          : "Nou pa t kapab konfime peman tès la. Tanpri, eseye ankò.",
      );
    }
  };

  const confirmPayment = async () => {
    if (payState === "verifying") return;
    setPayState("verifying");
    setPayError(null);
    try {
      const result = await verifyPayment(orderIdRef.current);
      if (result.success) {
        setTransactionId(result.transactionId);
        setPayState("done");
      } else {
        setPayState("gateway");
        setPayError("Peman an poko konfime. Fini peman an sou MonCash, epi eseye ankò.");
      }
    } catch (err) {
      setPayState("gateway");
      setPayError(err instanceof PaymentError ? err.message : "Nou pa t kapab verifye peman an. Tanpri, eseye ankò.");
    }
  };

  const createTheConsultation = async () => {
    if (!token || !selectedDoctor || submitting) return; // anti double-submit
    setSubmitting(true);
    setError(null);
    try {
      const consultation = await createConsultation(token, {
        description: symptoms.trim(),
        specialtyNeeded: selectedDoctor.specialty ?? specialty,
        urgencyLevel: urgency,
        aiSummary: "",
        aiExplanation: "",
        doctorId: selectedDoctor.id,
        patientAge: typeof user?.age === "number" ? user.age : null,
        transactionId,
        paymentAmount: priceOf(selectedDoctor.specialty ?? specialty),
        orderId: orderIdRef.current || null,
      });
      router.replace(`/app/consultations/${encodeURIComponent(consultation.id)}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && (err.code === "conflict" || err.code === "validation")) {
        setError(err);
      } else {
        setError(err instanceof Error ? err : new ApiError("unknown", 0, "Nou pa t kapab kreye konsiltasyon an. Tanpri, eseye ankò."));
      }
    }
  };

  const backToDoctors = () => {
    setSelectedDoctor(null);
    setReviewed(false); // issue #31: changing the selection resets the review state
    setPayState("idle");
    setPayError(null);
    setTransactionId(null);
    simOrderReadyRef.current = false;
    // Reload the filtered doctor list (covers both the directory entry path
    // and the normal intake path — doctors is null when we skipped step 2).
    findDoctors(specialty);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === "intake") {
    return (
      <div className="stack consult-intake" style={{ maxWidth: 640, margin: "0 auto" }}>
        <Link href="/app" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={16} aria-hidden /> Retounen
        </Link>
        <div>
          <h1 className="page-title">Jwenn yon doktè</h1>
          <p className="muted small">Di nou sa w ap santi epi chwazi kalite swen ou bezwen an.</p>
        </div>

        <ErrorAlert error={error} />

        {doctorNotFound && (
          <div className="alert alert-warning" role="status">
            <span>
              Nou pa jwenn doktè ou te chwazi a. Ou ka{" "}
              <Link href="/app/doctors" className="nowrap">
                gade lis doktè yo
              </Link>{" "}
              oswa kontinye ak fòm sa a nòmalman.
            </span>
          </div>
        )}

        <form onSubmit={onIntakeSubmit} className="card">
          {/* Doctor chosen from the directory — kept selected through intake */}
          {selectedDoctor && (
            <div className="card doctor-card" style={{ marginBottom: 16, boxShadow: "none" }}>
              <Avatar
                name={selectedDoctor.name}
                src={selectedDoctor.avatar_url}
                size="lg"
                alt={`Foto pwofil ${selectedDoctor.name}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="doctor-name">{selectedDoctor.name}</div>
                <div className="doctor-specialty">{specialtyLabel(selectedDoctor.specialty)}</div>
                <div className="doctor-meta">{selectedDoctor.hospital ?? ""}</div>
                {priceOf(selectedDoctor.specialty ?? "") != null && (
                  <div className="doctor-meta" style={{ fontWeight: 700, color: "var(--green-700)" }}>
                    {formatCurrency(priceOf(selectedDoctor.specialty ?? ""))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="symptoms">Sa w ap santi</label>
            <textarea
              id="symptoms"
              className="textarea"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="Eksplike sa w ap santi, depi kilè sa kòmanse, ak nenpòt lòt detay ki enpòtan..."
              maxLength={2000}
              required
            />
            <p className="field-hint">Bay detay: enfòmasyon sa yo ap ede doktè a ede w pi byen.</p>
          </div>

          <div className="field">
            <label id="urgency-label">Ki jan sitiyasyon an ijan?</label>
            <div className="tabs" role="group" aria-labelledby="urgency-label">
              {URGENCY_LEVELS.map((u) => (
                <button
                  key={u}
                  type="button"
                  className={urgency === u ? "active" : ""}
                  onClick={() => setUrgency(u)}
                  aria-pressed={urgency === u}
                >
                  {urgencyLabel(u)}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="specialty">Espesyalite medikal</label>
            <SpecialtySelect
              id="specialty"
              options={specialtyOptions}
              value={specialty}
              onChange={onSpecialtyChange}
              loading={prices.length === 0}
              ariaLabel="Espesyalite medikal"
            />
            {selectedDoctor && selectedDoctor.specialty === specialty && (
              <p className="field-hint">Espesyalite sa a se pou doktè ou chwazi a.</p>
            )}
          </div>

          <button className="btn btn-primary btn-block btn-lg mt-2" type="submit">
            <Search size={16} aria-hidden /> Kontinye
          </button>
        </form>
      </div>
    );
  }

  if (step === "doctors") {
    const list = doctors ?? [];
    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setStep("intake")}>
          <ArrowLeft size={16} aria-hidden /> Modifye sa m ap santi
        </button>
        <div>
          <h1 className="page-title">{specialtyLabel(specialty)}</h1>
          <p className="muted small">N ap chèche doktè ki disponib...</p>
        </div>

        <ErrorAlert error={error} />

        {doctors === null && <Spinner label="N ap chèche doktè ki disponib..." />}

        {doctors !== null && list.length === 0 && (
          <div className="card text-center">
            <p className="muted">Nou pa jwenn doktè pou espesyalite sa a.</p>
            <p className="small muted">Eseye yon lòt espesyalite oswa retounen pita.</p>
            <button className="btn btn-secondary mt-2" onClick={() => setStep("intake")}>
              Chwazi yon lòt espesyalite
            </button>
          </div>
        )}

        <div className="list">
          {list.map((d) => (
            <button key={d.id} className="row" onClick={() => selectDoctor(d)}>
              <Avatar name={d.name} src={d.avatar_url} size="md" alt={`Foto pwofil ${d.name}`} />
              <div className="row-body">
                <div className="row-title">
                  <span>{d.name}</span>
                  {d.is_available === 1 ? (
                    <span className="badge badge-green">Disponib</span>
                  ) : (
                    <span className="badge badge-gray">Pa disponib</span>
                  )}
                </div>
                <div className="row-meta">{d.hospital ?? "—"}</div>
              </div>
              <div className="nowrap text-center">
                <div style={{ fontWeight: 700, color: "var(--green-700)" }}>
                  {formatCurrency(priceOf(specialty))}
                </div>
                <span className="btn btn-primary btn-sm mt-1" style={{ pointerEvents: "none" }}>
                  Chwazi <ChevronRight size={13} aria-hidden />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // step === "payment" (or "creating")
  const amount = priceOf(selectedDoctor?.specialty ?? specialty);
  const amountValid = amount != null && amount > 0;
  return (
    <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={backToDoctors}>
        <ArrowLeft size={16} aria-hidden /> Chwazi yon lòt doktè
      </button>

      <div>
        <h1 className="page-title">{reviewed ? "Peman" : "Revize demann ou an"}</h1>
        <p className="muted small">
          {reviewed
            ? payMode === "simulated"
              ? "Mòd tès — peman simile"
              : "Etap sekirize MonCash"
            : "Verifye ki moun w ap konsilte ak sa w ap peye anvan w kontinye."}
        </p>
      </div>

      <ErrorAlert error={error} />

      {/* Doctor identity — the review step (issue #31) shows the available
          professional details and links to the FULL profile page (issue #30). */}
      <div className="card doctor-card">
        <Avatar name={selectedDoctor?.name} src={selectedDoctor?.avatar_url} size="lg" alt={`Foto pwofil ${selectedDoctor?.name}`} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="doctor-name" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{selectedDoctor?.name}</span>
            {selectedDoctor?.verification_status === "verified" && <VerifiedBadge compact />}
          </div>
          <div className="doctor-specialty">{specialtyLabel(selectedDoctor?.specialty ?? specialty)}</div>
          {selectedDoctor?.hospital && <div className="doctor-meta">{selectedDoctor.hospital}</div>}
          {selectedDoctor?.license_number && (
            <div className="doctor-meta">Lisans: {selectedDoctor.license_number}</div>
          )}
          <Link
            href={`/app/doctors/${encodeURIComponent(selectedDoctor?.id ?? "")}`}
            className="tiny nowrap"
            style={{ display: "inline-block", marginTop: 4 }}
          >
            Gade pwofil konplè a <ChevronRight size={12} aria-hidden style={{ display: "inline" }} />
          </Link>
        </div>
      </div>

      {/* Consultation summary — the exact price (server pricing contract),
          the intake the patient entered, and the urgency level. */}
      <div className="card">
        <div className="flex-between mb-1">
          <span className="muted">Konsiltasyon ({specialtyLabel(selectedDoctor?.specialty ?? specialty)})</span>
          <strong>{formatCurrency(amount)}</strong>
        </div>
        <div className="flex-between">
          <span className="muted small">Nivo ijans</span>
          <span className="small">{urgencyLabel(urgency)}</span>
        </div>
        <div className="flex-between" style={{ alignItems: "flex-start", gap: 12 }}>
          <span className="muted small" style={{ paddingTop: 2 }}>Sentòm ou</span>
          <span className="small" style={{ textAlign: "right", maxWidth: "70%", whiteSpace: "pre-line" }}>
            {symptoms.trim().length > 220 ? `${symptoms.trim().slice(0, 220)}…` : symptoms.trim()}
          </span>
        </div>
        <hr className="divider" />
        {payMode === "simulated" ? (
          <p className="tiny muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <FlaskConical size={14} aria-hidden /> Peman tès — trete pa sèvis tès Medika a, pa pa MonCash.
          </p>
        ) : (
          <p className="tiny muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ShieldCheck size={14} aria-hidden /> Peman an trete pa MonCash. Medika pa kenbe enfòmasyon kat w yo.
          </p>
        )}
      </div>

      {payMode === "simulated" && (
        <div className="alert alert-info" role="status">
          <FlaskConical size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Mòd tès la aktive. Peman sa a se yon simulation; pa gen okenn lajan k ap deplase.</span>
        </div>
      )}

      {payError && (
        <div className="alert alert-warning" role="alert">
          {payError}
        </div>
      )}
      {!payError && payState === "error" && (
        <div className="alert alert-error" role="alert">
          {payMode === "simulated"
            ? "Nou pa t kapab konfime peman tès la. Tanpri, eseye ankò."
            : "Gen yon pwoblèm ak peman an. Tanpri, eseye ankò."}
        </div>
      )}

      {/* ── Review phase (issue #31): a DELIBERATE confirmation before the
          MonCash gateway is opened — the patient sees who, what and how
          much, and explicitly chooses to continue. A missing/invalid price
          stops the flow with a clear next step. */}
      {!reviewed && (
        <div className="stack">
          {!amountValid && (
            <div className="alert alert-warning" role="alert">
              Pri konsiltasyon an pa disponib kounye a. Tanpri, retounen epi eseye ankò — si pwoblèm nan kontinye,
              chwazi yon lòt espesyalite.
            </div>
          )}
          <button
            className="btn btn-primary btn-block btn-lg"
            disabled={!amountValid}
            onClick={() => setReviewed(true)}
          >
            <ShieldCheck size={17} aria-hidden /> Kontinye ak peman an — {formatCurrency(amount)}
          </button>
          <p className="tiny muted text-center">
            {payMode === "simulated"
              ? "Peman tès — pa gen redireksyon MonCash."
              : "Apre w fin kontinye, paj peman MonCash la ap louvri pou w finalize peman an."}
          </p>
        </div>
      )}

      {payState === "idle" && payMode === "loading" && reviewed && (
        <button className="btn btn-primary btn-block btn-lg" disabled>
          <span className="spin" aria-hidden /> N ap chaje peman an...
        </button>
      )}

      {payState === "idle" && payMode === "real" && reviewed && (
        <button className="btn btn-primary btn-block btn-lg" onClick={startPayment}>
          <CreditCard size={17} aria-hidden /> Peye {formatCurrency(amount)} ak MonCash
        </button>
      )}

      {payState === "idle" && payMode === "simulated" && reviewed && (
        <button className="btn btn-primary btn-block btn-lg" onClick={startSimulatedPayment}>
          <FlaskConical size={17} aria-hidden /> Simile peman an
        </button>
      )}

      {payState === "creating" && (
        <button className="btn btn-primary btn-block btn-lg" disabled>
          <span className="spin" aria-hidden /> N ap prepare peman an...
        </button>
      )}

      {payState === "gateway" && (
        <div className="stack">
          <div className="alert alert-info">
            <ExternalLink size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Paj MonCash la louvri nan yon nouvo onglet. Fini peman an la, epi vini konfime li isit la.
            </span>
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={confirmPayment}>
            <Banknote size={17} aria-hidden /> Verifye peman an
          </button>
        </div>
      )}

      {payState === "verifying" && (
        <div className="stack">
          <div className="alert alert-info" role="status">
            {payMode === "simulated"
              ? "N ap konfime peman tès la..."
              : "Peman an poko konfime. Si w fin peye sou MonCash, tann yon ti moman epi verifye ankò."}
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled>
            <span className="spin" aria-hidden />{" "}
            {payMode === "simulated" ? "N ap konfime peman tès la..." : "N ap verifye peman an..."}
          </button>
        </div>
      )}

      {payState === "done" && (
        <div className="stack">
          <div className="alert alert-success" role="status">
            <CheckCircle2 size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {payMode === "simulated"
                ? "Peman tès la reyisi. Konsiltasyon ou a konfime."
                : "Peman an konfime."}
              {transactionId ? <span className="tiny muted" style={{ display: "block" }}>Idantifyan: {transactionId}</span> : null}
            </span>
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={createTheConsultation} disabled={submitting}>
            {submitting ? (
              <>
                <span className="spin" aria-hidden /> N ap kreye konsiltasyon ou a...
              </>
            ) : (
              <>
                <Stethoscope size={17} aria-hidden /> Voye demann lan
              </>
            )}
          </button>
        </div>
      )}

      {payState === "error" && (
        <div className="stack">
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={payMode === "simulated" ? startSimulatedPayment : startPayment}
          >
            Eseye ankò
          </button>
          <button
            className="btn btn-secondary btn-block"
            onClick={() => setPayState("idle")}
            aria-label="Retounen sou etap peman an"
          >
            Anile
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConsultPage() {
  return (
    <Suspense fallback={<Spinner label="N ap chaje..." />}>
      <ConsultFlow />
    </Suspense>
  );
}
