"use client";

/**
 * OfferCountdown — live countdown to a server-persisted deadline
 * (issue #25: the 1-hour acceptance window, or the 5-hour consultation
 * expiry). The deadline value is ALWAYS the server-persisted epoch
 * timestamp from the API; this component only renders the remaining time,
 * so a refresh/reconnect can never drift the deadline itself.
 */
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/format";

export default function OfferCountdown({
  deadline,
  label,
  warnUnderSeconds = 10 * 60,
  compact = false,
}: {
  deadline: number | null | undefined;
  label?: string;
  /** Below this remaining time the chip switches to the warning style. */
  warnUnderSeconds?: number;
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  if (!deadline) return null;
  const text = formatCountdown(deadline, nowMs);
  if (!text) return null;
  const remaining = deadline * 1000 - nowMs;
  const expired = remaining <= 0;
  const warn = !expired && remaining <= warnUnderSeconds * 1000;

  return (
    <span
      className={`offer-countdown${warn ? " warn" : ""}${expired ? " expired" : ""}${compact ? " compact" : ""}`}
      aria-label={label ? `${label}: ${text}` : text}
      suppressHydrationWarning
    >
      {label ? `${label} ${text}` : text}
    </span>
  );
}
