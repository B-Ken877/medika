"use client";

/**
 * New consultation flow — web port of SymptomIntakeScreen.kt + PaymentActivity.kt.
 *
 * Step 1: describe symptoms + pick a specialty (prices from /api/specialties/prices)
 * Step 2: choose a doctor from the filtered list (GET /api/doctors?specialty=)
 * Step 3: MonCash payment (create → gateway tab → verify) — same protocol as Android
 * Step 4: POST /api/consultations (with payment metadata) → redirect to the chat
 *
 * Includes anti-double-submit guards and 409/refresh handling on conflicts.
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
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { createConsultation, getDoctors, getSpecialtyPrices } from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { buildOrderId, createPayment, openPaymentGateway, verifyPayment, PaymentError } from "@/lib/payment";
import { formatCurrency } from "@/lib/format";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";

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

  // Payment state
  const [payState, setPayState] = useState<"idle" | "creating" | "gateway" | "verifying" | "done" | "error">("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const [payUnreachable, setPayUnreachable] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const orderIdRef = useRef<string>("");

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

  // Preselected doctor via ?doctor=<id> (from the directory page)
  useEffect(() => {
    if (!preselectedDoctorId || !token) return;
    const controller = new AbortController();
    getDoctors(token, controller.signal)
      .then((list) => {
        const doc = (Array.isArray(list) ? list : []).find((d) => d.id === preselectedDoctorId);
        if (doc) {
          setSelectedDoctor(doc);
          if (doc.specialty) setSpecialty(doc.specialty);
          setStep("payment");
        }
      })
      .catch(() => {
        // fall through to normal intake flow
      });
    return () => controller.abort();
  }, [preselectedDoctorId, token]);

  const onIntakeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!symptoms.trim()) {
      setError(new ApiError("validation", 0, "Décrivez vos symptômes avant de continuer."));
      return;
    }
    if (!specialty) {
      setError(new ApiError("validation", 0, "Choisissez une spécialité médicale."));
      return;
    }
    setError(null);
    findDoctors(specialty);
  };

  const selectDoctor = (doc: User) => {
    setSelectedDoctor(doc);
    setStep("payment");
    setPayState("idle");
    setPayError(null);
    setTransactionId(null);
  };

  const startPayment = async () => {
    if (!selectedDoctor || payState === "creating") return;
    const amount = priceOf(selectedDoctor.specialty ?? specialty);
    if (!amount || amount <= 0) {
      setPayState("error");
      setPayError("Montant invalide. Veuillez réessayer.");
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
        // Popup blocked → offer a direct link.
        setPayState("error");
        setPayError("Le paiement s'est ouvert dans un nouvel onglet ? Sinon, autorisez les fenêtres surgissantes et réessayez.");
        return;
      }
      setPayState("gateway");
    } catch (err) {
      setPayState("error");
      setPayUnreachable(err instanceof PaymentError && err.stage === "network");
      setPayError(
        err instanceof PaymentError
          ? err.message
          : "Le paiement n'a pas pu être initialisé. Réessayez.",
      );
    }
  };

  /** Mirrors the Android PaymentActivity sandbox mode: a clearly-labelled
   * simulation used only when the payment server is unreachable, so the
   * consultation can still proceed for testing/verification purposes. */
  const simulateSandboxPayment = () => {
    setTransactionId(`SANDBOX_TEST_${Date.now()}`);
    setPayState("done");
    setPayError(null);
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
        setPayError("Le paiement n'est pas encore confirmé. Terminez-le sur MonCash puis réessayez.");
      }
    } catch (err) {
      setPayState("gateway");
      setPayError(err instanceof PaymentError ? err.message : "Vérification impossible. Réessayez.");
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
        setError(err instanceof Error ? err : new ApiError("unknown", 0, "Création impossible. Réessayez."));
      }
    }
  };

  const backToDoctors = () => {
    setStep("doctors");
    setSelectedDoctor(null);
    setPayState("idle");
    setPayError(null);
    setTransactionId(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === "intake") {
    return (
      <div className="stack consult-intake" style={{ maxWidth: 640, margin: "0 auto" }}>
        <Link href="/app" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={16} aria-hidden /> Retour
        </Link>
        <div>
          <h1 className="page-title">Trouvez un docteur</h1>
          <p className="muted small">Décrivez vos symptômes et choisissez une spécialité</p>
        </div>

        <ErrorAlert error={error} />

        <form onSubmit={onIntakeSubmit} className="card">
          <div className="field">
            <label htmlFor="symptoms">Qu&apos;est-ce qui ne va pas ?</label>
            <textarea
              id="symptoms"
              className="textarea"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="Ex : J'ai des maux de tête depuis 3 jours, avec de la fièvre…"
              maxLength={2000}
              required
            />
            <p className="field-hint">Soyez précis : ces informations aideront le médecin.</p>
          </div>

          <div className="field">
            <label htmlFor="urgency">Niveau d&apos;urgence</label>
            <div className="tabs" role="group" aria-label="Niveau d'urgence">
              {URGENCY_LEVELS.map((u) => (
                <button
                  key={u}
                  type="button"
                  className={urgency === u ? "active" : ""}
                  onClick={() => setUrgency(u)}
                  aria-pressed={urgency === u}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="specialty">Spécialité</label>
            <select
              id="specialty"
              name="specialty"
              className="select"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              required
            >
              <option value="">Choisir une spécialité…</option>
              {prices.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} · {formatCurrency(p.price)}
                </option>
              ))}
            </select>
            {prices.length === 0 && <span className="muted small">Chargement des spécialités…</span>}
          </div>

          <button className="btn btn-primary btn-block btn-lg mt-2" type="submit">
            <Search size={16} aria-hidden /> Trouver un docteur
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
          <ArrowLeft size={16} aria-hidden /> Modifier mes symptômes
        </button>
        <div>
          <h1 className="page-title">{specialty}</h1>
          <p className="muted small">Recherche de docteurs…</p>
        </div>

        <ErrorAlert error={error} />

        {doctors === null && <Spinner label="Chargement des médecins…" />}

        {doctors !== null && list.length === 0 && (
          <div className="card text-center">
            <p className="muted">
              Aucun médecin n&apos;est actuellement disponible en {specialty}. Réessayez plus tard ou choisissez une
              autre spécialité.
            </p>
            <button className="btn btn-secondary mt-2" onClick={() => setStep("intake")}>
              Choisir une autre spécialité
            </button>
          </div>
        )}

        <div className="list">
          {list.map((d) => (
            <button key={d.id} className="row" onClick={() => selectDoctor(d)}>
              <Avatar name={d.name} src={d.avatar_url} size="md" alt={`Avatar de ${d.name}`} />
              <div className="row-body">
                <div className="row-title">
                  <span>{d.name}</span>
                  {d.is_available === 1 ? (
                    <span className="badge badge-green">Disponible</span>
                  ) : (
                    <span className="badge badge-gray">Indisponible</span>
                  )}
                </div>
                <div className="row-meta">{d.hospital ?? "—"}</div>
              </div>
              <div className="nowrap text-center">
                <div style={{ fontWeight: 700, color: "var(--green-700)" }}>
                  {formatCurrency(priceOf(specialty))}
                </div>
                <span className="btn btn-primary btn-sm mt-1" style={{ pointerEvents: "none" }}>
                  Choisir <ChevronRight size={13} aria-hidden />
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
  return (
    <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={backToDoctors}>
        <ArrowLeft size={16} aria-hidden /> Choisir un autre médecin
      </button>

      <div>
        <h1 className="page-title">Paiement de la consultation</h1>
        <p className="muted small">Étape sécurisée MonCash</p>
      </div>

      <ErrorAlert error={error} />

      <div className="card doctor-card">
        <Avatar name={selectedDoctor?.name} src={selectedDoctor?.avatar_url} size="lg" alt={`Avatar de ${selectedDoctor?.name}`} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="doctor-name">{selectedDoctor?.name}</div>
          <div className="doctor-specialty">{selectedDoctor?.specialty ?? specialty}</div>
          <div className="doctor-meta">{selectedDoctor?.hospital ?? ""}</div>
        </div>
      </div>

      <div className="card">
        <div className="flex-between mb-1">
          <span className="muted">Consultation ({selectedDoctor?.specialty ?? specialty})</span>
          <strong>{formatCurrency(amount)}</strong>
        </div>
        <div className="flex-between">
          <span className="muted small">Niveau d&apos;urgence</span>
          <span className="small">{urgency}</span>
        </div>
        <hr className="divider" />
        <p className="tiny muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ShieldCheck size={14} aria-hidden /> Paiement traité par MonCash. Medika ne stocke pas vos données
          bancaires.
        </p>
      </div>

      {payError && (
        <div className="alert alert-warning" role="alert">
          {payError}
        </div>
      )}

      {payState === "idle" && (
        <button className="btn btn-primary btn-block btn-lg" onClick={startPayment}>
          <CreditCard size={17} aria-hidden /> Payer {formatCurrency(amount)} avec MonCash
        </button>
      )}

      {payState === "creating" && (
        <button className="btn btn-primary btn-block btn-lg" disabled>
          <span className="spin" aria-hidden /> Initialisation du paiement…
        </button>
      )}

      {payState === "gateway" && (
        <div className="stack">
          <div className="alert alert-info">
            <ExternalLink size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              La page MonCash s&apos;est ouverte dans un nouvel onglet. Terminez le paiement, puis confirmez ici.
            </span>
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={confirmPayment}>
            <Banknote size={17} aria-hidden /> J&apos;ai payé — Vérifier le paiement
          </button>
        </div>
      )}

      {payState === "verifying" && (
        <button className="btn btn-primary btn-block btn-lg" disabled>
          <span className="spin" aria-hidden /> Vérification du paiement…
        </button>
      )}

      {payState === "done" && (
        <div className="stack">
          <div className="alert alert-success" role="status">
            <CheckCircle2 size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Paiement confirmé{transactionId ? ` (${transactionId})` : ""}. Vous pouvez démarrer votre consultation.
            </span>
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={createTheConsultation} disabled={submitting}>
            {submitting ? (
              <>
                <span className="spin" aria-hidden /> Création de la consultation…
              </>
            ) : (
              <>
                <Stethoscope size={17} aria-hidden /> Démarrer ma consultation
              </>
            )}
          </button>
        </div>
      )}

      {payState === "error" && (
        <div className="stack">
          <button className="btn btn-primary btn-block btn-lg" onClick={startPayment}>
            Réessayer le paiement
          </button>
          {payUnreachable && (
            <div className="alert alert-warning">
              <span>
                Le serveur MonCash est injoignable. Vous pouvez continuer en{" "}
                <strong>mode test</strong> (paiement simulé, comme l&apos;application Android en sandbox).
              </span>
              <button className="btn btn-secondary btn-sm mt-1" onClick={simulateSandboxPayment}>
                Mode test : simuler le paiement
              </button>
            </div>
          )}
          <button
            className="btn btn-secondary btn-block"
            onClick={() => setPayState("idle")}
            aria-label="Revenir à l'étape de paiement"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConsultPage() {
  return (
    <Suspense fallback={<Spinner label="Chargement…" />}>
      <ConsultFlow />
    </Suspense>
  );
}
