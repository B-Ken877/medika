"use client";

/**
 * ReceiptTick — the small read-receipt indicator for the viewer's OWN
 * messages (system and incoming messages show none).
 *
 *  - pending: clock, only while the optimistic send is unresolved
 *  - sent: single check — the server confirmed persistence
 *  - read: double check + "Li" (the participant actually read it)
 *
 * Accessible: text + icon, never color alone.
 */
import { Check, CheckCheck, Clock } from "lucide-react";
import type { ReceiptState } from "@/lib/chat/receipts";

export function ReceiptTick({ state }: { state: ReceiptState }) {
  if (state === "pending") {
    return (
      <span className="receipt pending" role="status" aria-label="Ap voye">
        <Clock size={11} aria-hidden />
      </span>
    );
  }
  if (state === "sent") {
    return (
      <span className="receipt sent" aria-label="Voye">
        <Check size={12} aria-hidden />
      </span>
    );
  }
  return (
    <span className="receipt read" aria-label="Li">
      <CheckCheck size={12} aria-hidden />
      <span className="receipt-text">Li</span>
    </span>
  );
}
