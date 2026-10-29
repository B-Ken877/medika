"use client";

/**
 * Consultation ROOM — RETIRED as a destination (issue #56).
 *
 * This route used to host the video-first PLACEHOLDER page (issue #33):
 * a status screen with chat/voice/video links that never joined a call
 * and never pretended a call was live. Since issue #56 the REAL
 * call page (../call) is the primary consultation surface and it already
 * handles every state the placeholder used to present:
 *   - not yet accepted (RECHERCHE_MEDECIN) → calm "waiting for the doctor"
 *     screen with bounded, cancellable polling — no fake call UI;
 *   - active → the real call, with the in-call chat panel one tap away;
 *   - terminal statuses (REFUSE / TERMINE / EXPIRE) → clear, honest copy.
 *
 * Any stale link (bookmark, old notification, cached page) therefore lands
 * in the real call flow via this compatibility redirect. The route is kept
 * so those links still resolve; it must never become a destination again.
 */
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/primitives";

export default function ConsultationRoomRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    // mode=video is the default consultation experience (issue #56); the
    // call page handles eligibility/waiting/terminal states and the
    // server-side token gate stays authoritative end to end.
    router.replace(`/app/consultations/${encodeURIComponent(String(id))}/call?mode=video`);
  }, [id, router]);

  return <Spinner label="N ap antre nan apèl la..." />;
}
