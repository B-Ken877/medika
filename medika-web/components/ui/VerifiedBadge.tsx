"use client";

/**
 * VerifiedBadge (issues #30/#32) — the "verified doctor" trust signal.
 *
 * The badge is shown ONLY when the server's explicit verification_status is
 * "verified". It is never inferred from a populated license number, a filled
 * profile, or any client-side heuristic — a doctor with unknown/legacy
 * status (null), pending review or rejected credentials gets NO badge (and
 * no misleading "unverified" stigma either: we simply say nothing).
 */
import { ShieldCheck } from "lucide-react";

export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`badge badge-verified${compact ? " badge-verified-sm" : ""}`}
      title="Idantite ak kredansyèl doktè sa a verifie pa ekip Medika a."
    >
      <ShieldCheck size={compact ? 12 : 14} aria-hidden /> Verifye
    </span>
  );
}
