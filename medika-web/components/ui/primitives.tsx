"use client";

/** Small shared UI primitives used across all screens. */
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { avatarUrl, initialsOf, statusBadgeClass, statusLabel } from "@/lib/format";
import { ApiError } from "@/lib/api/client";

export function Avatar({
  name,
  src,
  size = "md",
  alt,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  alt?: string;
}) {
  const url = avatarUrl(src);
  const cls = `avatar avatar-${size}`;
  if (url) {
    // Plain <img> with graceful fallback to initials on error.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={cls}
        src={url}
        alt={alt ?? name ?? "Avatar"}
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span className={cls} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusBadgeClass(status)}`}>{statusLabel(status)}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorAlert({
  error,
  onRetry,
  retryLabel = "Eseye ankò",
}: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  if (error === null || error === undefined) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? "Gen yon pwoblèm. Tanpri, eseye ankò."
        : "Gen yon pwoblèm. Tanpri, eseye ankò.";
  return (
    <div className="alert alert-error" role="alert">
      <AlertTriangle size={17} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        {message}
        {onRetry && (
          <div className="mt-1">
            <button className="btn btn-secondary btn-sm" onClick={onRetry}>
              <RefreshCw size={13} /> {retryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="text-center muted" style={{ padding: "36px 0" }} role="status">
      <div
        style={{
          width: 28,
          height: 28,
          margin: "0 auto 10px",
          border: "3px solid var(--gray-200)",
          borderTopColor: "var(--green-600)",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }}
        aria-hidden
      />
      {label ?? "N ap chaje..."}
    </div>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
