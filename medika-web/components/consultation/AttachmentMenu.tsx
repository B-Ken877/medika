"use client";

/**
 * AttachmentMenu — compact picker for attachment kinds (image / video / PDF),
 * so the mobile composer stays clean. One hidden file input per kind with a
 * tight `accept` filter; the server re-validates type and size anyway.
 */
import { useEffect, useRef, useState } from "react";
import { FileText, ImagePlus, Paperclip, Video } from "lucide-react";

interface AttachmentMenuProps {
  disabled: boolean;
  onFile: (file: File, kind: "image" | "video" | "file") => void;
}

const KINDS = [
  { kind: "image" as const, accept: "image/jpeg,image/png,image/webp", label: "Imaj", Icon: ImagePlus },
  { kind: "video" as const, accept: "video/mp4,video/webm,video/quicktime", label: "Videyo", Icon: Video },
  { kind: "file" as const, accept: "application/pdf", label: "Dokiman PDF", Icon: FileText },
];

export function AttachmentMenu({ disabled, onFile }: AttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (kind: "image" | "video" | "file") => {
    setOpen(false);
    inputRefs.current[kind]?.click();
  };

  return (
    <div className="attach-wrap" ref={rootRef}>
      {KINDS.map(({ kind, accept }) => (
        <input
          key={kind}
          ref={(el) => {
            inputRefs.current[kind] = el;
          }}
          type="file"
          accept={accept}
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file, kind);
          }}
        />
      ))}
      <button
        type="button"
        className="composer-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Ajoute fichye"
        title="Ajoute fichye"
      >
        <Paperclip size={20} />
      </button>
      {open && (
        <div className="attach-menu" role="menu" aria-label="Kalite fichye">
          {KINDS.map(({ kind, label, Icon }) => (
            <button key={kind} type="button" role="menuitem" className="attach-item" onClick={() => pick(kind)}>
              <Icon size={17} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
