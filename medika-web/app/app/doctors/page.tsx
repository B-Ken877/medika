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
      <div className="doc-hero">
        <span className="doc-hero-eyebrow">
          <Stethoscope size={13} aria-hidden /> Repètwa medikal
        </span>
        <h1 className="page-title">Jwenn yon doktè</h1>
        <p className="page-desc">
          Chèche yon doktè selon non li, espesyalite li oswa lopital kote li travay.
        </p>
      </div>

      <div className="doc-search">
        <Search size={18} aria-hidden className="doc-search-icon" />
        <input
          className="input"
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

      <div className="flex" style={{ gap: 8, overflowX: "auto", paddingBottom: 4 }} role="group" aria-label="Filtre selon espesyalite">
        <button
          className={`doc-chip ${specialty === "" ? "doc-chip-active" : ""}`}
          onClick={() => setSpecialty("")}
        >
          Tout espesyalite
        </button>
        {specialties.map((s) => (
          <button
            key={s}
            className={`doc-chip nowrap ${specialty === s ? "doc-chip-active" : ""}`}
            onClick={() => setSpecialty(specialty === s ? "" : s)}
          >
            {specialtyLabel(s)}
            {priceOf(s) != null && <span className="doc-chip-price">· {formatCurrency(priceOf(s))}</span>}
          </button>
        ))}
      </div>

      <p className="small muted doc-count" role="status" aria-live="polite">
        {filtered.length === 0
          ? "Nou pa jwenn doktè"
          : (<><strong>{filtered.length}</strong> doktè jwenn</>)}
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
            className="doc-card"
          >
            <Avatar name={d.name} src={d.avatar_url} size="md" alt={`Foto pwofil ${d.name}`} />
            <div className="doc-card-body">
              <div className="doc-card-name">
                <span>{d.name}</span>
                {d.verification_status === "verified" && <VerifiedBadge compact />}
              </div>
              <div className="doc-card-spec">
                {d.specialty ? specialtyLabel(d.specialty) : "Medsin Jeneral"}
              </div>
              <div className="doc-card-meta">
                <span className={`doc-status ${d.is_available === 1 ? "doc-status-on" : "doc-status-off"}`}>
                  <span className="doc-status-dot" aria-hidden />
                  {d.is_available === 1 ? "Disponib" : "Pa disponib"}
                </span>
                {d.hospital && (
                  <span>
                    <MapPin size={13} aria-hidden /> {d.hospital}
                  </span>
                )}
                {d.license_number && (
                  <span>
                    <Award size={13} aria-hidden /> {d.license_number}
                  </span>
                )}
              </div>
            </div>
            <div className="doc-card-side">
              {priceOf(d.specialty) != null && (
                <div className="doc-price">
                  {formatCurrency(priceOf(d.specialty))}
                  <span className="doc-price-unit">pa konsiltasyon</span>
                </div>
              )}
              <span className="btn btn-primary btn-sm doc-cta">Gade pwofil</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
