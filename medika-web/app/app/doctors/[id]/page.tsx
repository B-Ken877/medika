"use client";

/**
 * Doctor profile page (issue #30) — a core trust-building step before a paid
 * consultation: the patient inspects the doctor's professional identity and
 * background BEFORE committing.
 *
 * Principles (from the issue):
 *  - present every AVAILABLE supported field — photo, name, specialty,
 *    biography, hospital affiliation, license, rating, availability, and the
 *    applicable consultation price (server pricing, not client state);
 *  - never invent credentials, experience, affiliations, ratings or claims:
 *    missing optional fields are simply omitted, and the "Verifye" badge is
 *    grounded in the server's explicit verification_status (issue #32),
 *    never in a populated license string;
 *  - the selected doctor ID is the source of truth when continuing — the
 *    CTA links to /app/consult?doctor=<id> where the full symptom/urgency
 *    intake is STILL required (the profile never bypasses medical intake);
 *  - loading, API errors, unknown/deactivated doctors and stale availability
 *    all have distinct, honest states.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Award,
  CalendarCheck,
  ChevronRight,
  Clock,
  MapPin,
  MessageSquareText,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getDoctor, getSpecialtyPrices } from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/format";
import { specialtyLabel } from "@/lib/labels";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { hasConsultDraft } from "@/lib/consult-draft";

export default function DoctorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const doctorId = String(id ?? "");
  const { token } = useAuth();

  const [doctor, setDoctor] = useState<User | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [prices, setPrices] = useState<SpecialtyPrice[]>([]);
  /** Bumped by the retry button to re-run the bootstrap effect. */
  const [retryNonce, setRetryNonce] = useState(0);
  /** Issue #40: true when the patient arrived with a live consult draft. */
  const [resumeFromConsult, setResumeFromConsult] = useState(false);

  useEffect(() => {
    setResumeFromConsult(hasConsultDraft());
  }, []);

  useEffect(() => {
    if (!token || !doctorId) return;
    const controller = new AbortController();
    getDoctor(token, doctorId, controller.signal)
      .then((d) => {
        setDoctor(d);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.code === "not_found") setNotFound(true);
        else setError(err);
      });
    return () => controller.abort();
  }, [token, doctorId, retryNonce]);

  // Server-authoritative pricing for this doctor's specialty (never derived
  // from navigation/query parameters).
  useEffect(() => {
    const controller = new AbortController();
    getSpecialtyPrices(token ?? undefined, controller.signal)
      .then((list) => setPrices(Array.isArray(list) ? list : []))
      .catch(() => setPrices([]));
    return () => controller.abort();
  }, [token]);

  const price = doctor?.specialty
    ? prices.find((p) => p.name === doctor.specialty)?.price ?? null
    : null;

  if (notFound) {
    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
        <div className="empty-state">
          <h3>Nou pa jwenn doktè sa a.</h3>
          <p className="small">Li ka retire oswa pa disponib ankò.</p>
          <Link href="/app/doctors" className="btn btn-secondary">
            <ArrowLeft size={16} aria-hidden /> Retounen sou lis doktè yo
          </Link>
        </div>
      </div>
    );
  }

  if (!doctor) {
    if (error) {
      return (
        <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
          <ErrorAlert
            error={new ApiError(
              error instanceof ApiError ? error.code : "server",
              error instanceof ApiError ? error.status : 0,
              "Nou pa t kapab chaje pwofil doktè a. Tanpri, eseye ankò.",
            )}
            onRetry={() => {
              setNotFound(false);
              setError(null);
              setDoctor(null);
              setRetryNonce((n) => n + 1);
            }}
          />
          <Link href="/app/doctors" className="btn btn-secondary">
            <ArrowLeft size={16} aria-hidden /> Retounen sur lis doktè yo
          </Link>
        </div>
      );
    }
    return (
      <div style={{ minHeight: "50dvh", display: "grid", placeItems: "center" }}>
        <Spinner label="N ap chaje pwofil doktè a..." />
      </div>
    );
  }

  return (
    <div className="stack doctor-profile" style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Identity hero — mint clinic-card panel, centered like the reference
          design. The photo is the anchor of the page: large centered disc,
          white ring, layered shadow. Every value comes from the server. */}
      <section className="dp-hero" aria-labelledby="dp-name">
        <div className="dp-hero-top">
          <Link href="/app/doctors" className="dp-back" aria-label="Retounen sou lis doktè yo">
            <ArrowLeft size={18} aria-hidden />
          </Link>
          {doctor.verification_status === "verified" && <VerifiedBadge />}
        </div>

        <div className="dp-avatar">
          <Avatar
            name={doctor.name}
            src={doctor.avatar_url}
            size="lg"
            alt={`Foto pwofil ${doctor.name}`}
          />
        </div>

        <h1 id="dp-name" className="dp-name">{doctor.name}</h1>

        <div className="dp-specialty-chip">
          <Stethoscope size={14} aria-hidden />
          {doctor.specialty ? specialtyLabel(doctor.specialty) : "Medsin Jeneral"}
        </div>

        <div className="dp-availability">
          {doctor.is_available === 1 ? (
            <span className="badge badge-green">Disponib kounye a</span>
          ) : (
            <span className="badge badge-gray">Pa disponib kounye a</span>
          )}
        </div>

        {/* Stat strip — every value comes from the server. A doctor nobody has
            rated yet reads "Nouvo" (no fabricated stars), an unknown price
            reads "Sou demann". */}
        <div className="dp-stats">
          <div className="dp-stat">
            <strong>{doctor.rating != null ? Number(doctor.rating).toFixed(1) : "Nouvo"}</strong>
            <span>{doctor.rating != null ? "Nòt mwayèn" : "Pa gen nòt ankò"}</span>
          </div>
          <div className="dp-stat">
            <strong>{price != null ? formatCurrency(price) : "Sou demann"}</strong>
            <span>Pri konsiltasyon</span>
          </div>
          {doctor.verification_status === "verified" && (
            <div className="dp-stat">
              <strong>Verifye</strong>
              <span>Kredansyèl revize</span>
            </div>
          )}
        </div>
      </section>

      {/* About — plain section under the hero. Only what the server actually
          has; missing optional fields are omitted. */}
      {(doctor.biography || doctor.hospital || doctor.license_number || doctor.location) && (
        <section className="dp-about" aria-labelledby="bg-title">
          <h2 id="bg-title" className="section-title">
            <Stethoscope size={16} aria-hidden /> Sou doktè a
          </h2>

          {doctor.biography && <p style={{ whiteSpace: "pre-line" }}>{doctor.biography}</p>}

          <div className="dp-facts">
            {doctor.hospital && (
              <div className="dp-fact">
                <MapPin size={15} aria-hidden />
                <span>
                  <strong>Lopital:</strong> {doctor.hospital}
                </span>
              </div>
            )}
            {doctor.license_number && (
              <div className="dp-fact">
                <Award size={15} aria-hidden />
                <span>
                  Nimewo lisans: <strong>{doctor.license_number}</strong>
                </span>
              </div>
            )}
            {doctor.location && (
              <div className="dp-fact">
                <Clock size={15} aria-hidden />
                <span>{doctor.location}</span>
              </div>
            )}
          </div>

          {doctor.verification_status === "verified" && doctor.verified_at != null && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              <VerifiedBadge compact /> Idantite ak kredansyèl doktè sa a fin revize pa ekip Medika a.
            </p>
          )}
        </section>
      )}

      {/* Price + continuation */}
      <section className="card dp-consult" aria-labelledby="price-title">
        <h2 id="price-title" className="section-title">
          <CalendarCheck size={16} aria-hidden /> Konsiltasyon
        </h2>
        <div className="dp-consult-row">
          <div>
            <span className="muted">Espesyalite: {doctor.specialty ? specialtyLabel(doctor.specialty) : "Medsin Jeneral"}</span>
            {price == null && (
              <p className="tiny muted" style={{ marginTop: 4 }}>
                Pou konnen pri egzak konsiltasyon an, kontinye ak demann lan.
              </p>
            )}
          </div>
          {price != null && (
            <strong className="dp-consult-price">{formatCurrency(price)}</strong>
          )}
        </div>
        <p className="tiny muted" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
          <MessageSquareText size={13} aria-hidden /> Avan peman an, w ap dekri sentòm ou epi chwazi nivo ijans yo.
        </p>
        {/* Issue #40: arriving from the consult flow (a live draft exists) the
            CTA CONTINUES that consultation — resume=1 restores the intake and
            jumps to the pre-payment review. A fresh visit starts the normal
            full intake, as required. */}
        <Link
          href={
            resumeFromConsult
              ? `/app/consult?doctor=${encodeURIComponent(doctor.id)}&resume=1`
              : `/app/consult?doctor=${encodeURIComponent(doctor.id)}`
          }
          className="btn btn-primary btn-block btn-lg mt-2 dp-cta"
        >
          {resumeFromConsult ? "Kontinye konsiltasyon an" : "Kòmanse konsiltasyon ak doktè sa a"}{" "}
          <ChevronRight size={16} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
