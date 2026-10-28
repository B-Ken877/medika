"use client";

/**
 * ImageViewer — accessible full-size viewer for chat image attachments
 * (issue #17). Opens from a compact in-bubble preview; the image keeps using
 * the SAME authorized signed URL the preview resolved (no public URLs, no
 * weakened access — the SecureMedia grant flow stays untouched).
 *
 * Behavior: backdrop click / Escape / close button dismiss; body scrolling is
 * locked while open; focus moves to the close control on open and is restored
 * to the previously focused element on close; load and error states included.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface ImageViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageViewer({ src, alt, onClose }: ImageViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="image-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Apèsi imaj la"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="image-viewer-close"
        onClick={onClose}
        aria-label="Fèmen apèsi imaj la"
      >
        <X size={20} aria-hidden />
      </button>
      {failed ? (
        <div className="image-viewer-error" role="alert">
          Imaj la pa disponib kounye a.
        </div>
      ) : (
        <div className="image-viewer-stage">
          {!loaded && <span className="image-viewer-spinner" role="status" aria-label="N ap chaje imaj la..." />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="image-viewer-img"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
  );
}
