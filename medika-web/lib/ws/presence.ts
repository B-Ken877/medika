/**
 * Partner presence — pure state derivation from presence:update events.
 *
 * "unknown" until the first definitive event (no flicker on connect: the dot
 * is simply absent). Never derived from the LOCAL user's socket status —
 * only server events about the partner count. Reconnects re-subscribe and
 * receive a fresh definitive answer.
 */
import type { WsPresenceEvent } from "../api/types";

export type PresenceState = "unknown" | "online" | "offline";

export function presenceFromEvent(
  event: WsPresenceEvent,
  opts: { partnerId: string | null | undefined },
): PresenceState | null {
  if (!event || typeof event.online !== "boolean") return null;
  if (!opts.partnerId || event.userId !== opts.partnerId) return null; // not about our partner
  return event.online ? "online" : "offline";
}

/** Accessible label for a presence state (color alone never communicates). */
export function presenceLabel(state: PresenceState): string {
  if (state === "online") return "Sou entènèt";
  if (state === "offline") return "Pa sou entènèt";
  return "";
}
