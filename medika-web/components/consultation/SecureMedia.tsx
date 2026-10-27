"use client";

/**
 * SecureMedia — renders a message's media through the AUTHORIZED access path.
 *
 *  - legacy/public URLs (http(s), /uploads/…) render directly (compatibility);
 *  - private API paths (/api/consultations/{cid}/attachments/{aid}) resolve
 *    to a short-lived signed URL via the authenticated endpoint, cached until
 *    shortly before expiry, refreshed automatically on load errors.
 *
 * Renders image / video / audio / document-chip by message type. PDFs get a
 * safe open/download action (never a third-party iframe embed).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import type { ServerMessage } from "@/lib/api/types";
import { isDirectMediaUrl, parseAttachmentPath, invalidateMediaGrant, resolveMediaUrl } from "@/lib/chat/media";
import { fileSizeLabel } from "@/lib/format";
import { ImageViewer } from "@/components/consultation/ImageViewer";
import { VoiceMessageBubble } from "@/components/consultation/VoiceMessageBubble";

interface SecureMediaProps {
  message: ServerMessage;
  token: string;
}

export function SecureMedia({ message, token }: SecureMediaProps) {
  const fileUrl = message.file_url ?? "";
  const direct = isDirectMediaUrl(fileUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string>(direct ? fileUrl : "");
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (direct) {
      setResolvedUrl(fileUrl);
      return;
    }
    if (!parseAttachmentPath(fileUrl)) {
      setResolvedUrl(fileUrl); // unknown shape: hand through untouched
      return;
    }
    let cancelled = false;
    resolveMediaUrl(fileUrl, token)
      .then((url) => {
        if (!cancelled && mountedRef.current) {
          setResolvedUrl(url);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl, token, direct, retried]);

  /** Expired grant or transient load failure: invalidate and re-resolve once. */
  const onMediaError = useCallback(() => {
    const parsed = parseAttachmentPath(fileUrl);
    if (parsed && !retried) {
      setRetried(true);
      invalidateMediaGrant(parsed.consultationId, parsed.attachmentId);
      setResolvedUrl("");
    } else {
      setFailed(true);
    }
  }, [fileUrl, retried]);

  if (!fileUrl) return null;
  const kind = message.message_type;
  const sizeLabel = message.file_size ? fileSizeLabel(message.file_size) : "";

  if (kind === "image") {
    if (failed) {
      return <div className="media-fallback">Imaj la pa disponib kounye a.</div>;
    }
    if (!resolvedUrl) {
      // Grant still resolving — a calm reserved-size placeholder instead of
      // an error-looking fallback (issue #17).
      return <div className="skeleton bubble-image-skeleton" role="status" aria-label="N ap chaje imaj la..." />;
    }
    return (
      <>
        <button
          type="button"
          className="bubble-image-btn"
          onClick={() => setViewerOpen(true)}
          aria-label="Ouvri imaj la an gran"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolvedUrl} alt="Imaj pataje" className="bubble-image" loading="lazy" onError={onMediaError} />
        </button>
        {viewerOpen && (
          <ImageViewer src={resolvedUrl} alt="Imaj pataje" onClose={() => setViewerOpen(false)} />
        )}
      </>
    );
  }

  if (kind === "video") {
    if (failed || !resolvedUrl) {
      return <div className="media-fallback">Videyo a pa disponib kounye a.</div>;
    }
    return (
      <video
        src={resolvedUrl}
        controls
        preload="metadata"
        className="bubble-video"
        onError={onMediaError}
      />
    );
  }

  if (kind === "voice") {
    if (failed) {
      return (
        <span className="audio-chip">
          <span className="tiny">Mesaj vwa pa disponib kounye a.</span>
        </span>
      );
    }
    if (!resolvedUrl) {
      // Grant still resolving — reserved-size placeholder (issue #18).
      return <span className="skeleton voice-msg-skeleton" role="status" aria-label="N ap chaje mesaj vwa a..." />;
    }
    return (
      <VoiceMessageBubble
        src={resolvedUrl}
        seedKey={String(message.id ?? message.file_url ?? "voice")}
        durationSeconds={message.duration}
        onError={onMediaError}
      />
    );
  }

  // Documents (PDF and other files): a safe open/download chip.
  return (
    <div className="doc-chip">
      <FileText size={18} aria-hidden />
      <div className="doc-chip-body">
        <span className="doc-chip-name">{message.text || "Dokiman"}</span>
        {sizeLabel && <span className="doc-chip-meta tiny">{sizeLabel}</span>}
      </div>
      {resolvedUrl && !failed ? (
        <a
          className="doc-chip-action"
          href={resolvedUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvri dokiman an"
          onError={onMediaError}
        >
          <Download size={16} aria-hidden /> Ouvri
        </a>
      ) : (
        <span className="tiny">…</span>
      )}
    </div>
  );
}
