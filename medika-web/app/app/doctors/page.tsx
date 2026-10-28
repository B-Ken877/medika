"use client";

/**
 * Doctor directory — port of the Android doctor search (compact cards +
 * search by name/specialty). Data: GET /api/doctors (+ optional ?specialty=).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Award, MapPin, Search, Stethoscope, X } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getDoctors, getSpecialtyPrices } from "@/lib/api/endpoints";
import type { SpecialtyPrice, User } from "@/lib/api/types";
import { formatCurrency } from "@/lib/format";
import { specialtyLabel } from "@/lib/labels";
import { Avatar, EmptyState, ErrorAlert, SkeletonRows } from "@/components/ui/primitives";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

export default function DoctorsPage() {
  const { token } = useAuth();
  const [doctors, setDoctors] = useState<User[] | null>(null);
  const [prices, setPrices] = useState<SpecialtyPrice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [specialty, setSpecialty] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    getDoctors(token, controller.signal)
      .then((list) => {
        setDoctors(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setDoctors([]);
      });
    getSpecialtyPrices(token, controller.signal)
      .then((list) => setPrices(Array.isArray(list) ? list : []))
      .catch(() => setPrices([]));
  }, [token]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const specialties = useMemo(() => {
    const names = new Set<string>((doctors ?? []).map((d) => d.specialty).filter(Boolean) as string[]);
    // Prefer the backend price list order; append any doctor-only specialties.
    const ordered = prices.map((p) => p.name).filter((n) => names.has(n));
    for (const n of Array.from(names)) if (!ordered.includes(n)) ordered.push(n);
    return ordered;
  }, [doctors, prices]);

  const priceOf = useCallback(
    (name?: string | null) => prices.find((p) => p.name === name)?.price ?? null,
    [prices],
  );

  const filtered = useMemo(() => {
    const list = doctors ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((d) => {
      if (specialty && d.specialty !== specialty) return false;
      if (!q) return true;
      return (
        (d.name ?? "").toLowerCase().includes(q) ||
        (d.specialty ?? "").toLowerCase().includes(q) ||
        (d.username ?? "").toLowerCase().includes(q) ||
        (d.hospital ?? "").toLowerCase().includes(q)
      );
    });
  }, [doctors, query, specialty]);

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Doktè yo</h1>
        <p className="muted small">Chèche yon doktè selon non li, espesyalite li oswa lopital kote li travay.</p>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <div className="input-with-action">
          <Search size={17} aria-hidden style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
          <input
            className="input"
            style={{ paddingLeft: 42 }}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chèche pa non, espesyalite..."
            aria-label="Chèche yon doktè"
            maxLength={100}
          />
          {query && (
            <button className="toggle-btn" onClick={() => setQuery("")} aria-label="Efase rechèch la">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex" style={{ gap: 8, overflowX: "auto", paddingBottom: 4 }} role="group" aria-label="Filtre selon espesyalite">
        <button
          className={`btn btn-sm ${specialty === "" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setSpecialty("")}
        >
          Tout espesyalite
        </button>
        {specialties.map((s) => (
          <button
            key={s}
            className={`btn btn-sm nowrap ${specialty === s ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setSpecialty(specialty === s ? "" : s)}
          >
            {specialtyLabel(s)}
            {priceOf(s) != null && <span className="tiny">· {formatCurrency(priceOf(s))}</span>}
          </button>
        ))}
      </div>

      <p className="small muted" role="status" aria-live="polite">
        {filtered.length === 0
          ? "Nou pa jwenn doktè"
          : `${filtered.length} doktè jwenn`}
      </p>

      {doctors === null && !error && <SkeletonRows count={4} />}
      <ErrorAlert error={error} onRetry={load} />

      {doctors !== null && filtered.length === 0 && !error && (
        <div className="card">
          <EmptyState
            icon={<Stethoscope size={26} />}
            title="Nou pa jwenn doktè"
            description="Eseye yon lòt espesyalite oswa chanje rechèch ou a."
          />
        </div>
      )}

      <div className="list">
        {filtered.map((d) => (
          <Link
            key={d.id}
            href={`/app/doctors/${encodeURIComponent(d.id)}`}
            className="row card-hover"
            aria-label={`Pwofil ${d.name}, ${d.specialty ?? ""}`}
          >
            <Avatar name={d.name} src={d.avatar_url} size="md" alt={`Foto pwofil ${d.name}`} />
            <div className="row-body">
              <div className="row-title">
                <span>{d.name}</span>
                {d.verification_status === "verified" && <VerifiedBadge compact />}
                {d.is_available === 1 ? (
                  <span className="badge badge-green">Disponib</span>
                ) : (
                  <span className="badge badge-gray">Pa disponib</span>
                )}
              </div>
              <div className="row-sub doctor-specialty" style={{ WebkitLineClamp: 1 }}>
                {d.specialty ? specialtyLabel(d.specialty) : "Medsin Jeneral"}
              </div>
              <div className="row-meta flex" style={{ gap: 12, flexWrap: "wrap" }}>
                {d.hospital && (
                  <span className="flex" style={{ gap: 4 }}>
                    <MapPin size={13} aria-hidden /> {d.hospital}
                  </span>
                )}
                {d.license_number && (
                  <span className="flex" style={{ gap: 4 }}>
                    <Award size={13} aria-hidden /> {d.license_number}
                  </span>
                )}
              </div>
            </div>
            <div className="nowrap text-center">
              <div style={{ fontWeight: 700, color: "var(--green-700)" }}>{formatCurrency(priceOf(d.specialty))}</div>
              <span className="btn btn-primary btn-sm mt-1" style={{ pointerEvents: "none" }}>
                Gade pwofil
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
