"use client";

/**
 * EmojiPicker — small curated in-app picker (no dependency).
 * Opens above the composer, closes on outside click / Escape / selection,
 * keyboard-navigable buttons with accessible names. Insertion preserves the
 * draft around the caret and never splits surrogate pairs (lib/chat/emoji).
 */
import { useEffect, useRef, useState } from "react";
import { EMOJI_CATEGORIES, FREQUENT_EMOJIS, type EmojiItem } from "@/lib/chat/emoji";

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<string>(EMOJI_CATEGORIES[0].id);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [onClose]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];

  const pick = (emoji: EmojiItem) => {
    onPick(emoji.char);
    onClose();
  };

  return (
    <div className="emoji-picker" ref={rootRef} role="dialog" aria-label="Chwazi yon emoji" aria-modal="false">
      <div className="emoji-cats" role="tablist" aria-label="Kategori emoji">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={cat.id === active.id}
            className={`emoji-cat ${cat.id === active.id ? "active" : ""}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.emojis[0].char}
            <span className="sr-only">{cat.label}</span>
          </button>
        ))}
      </div>
      {category === EMOJI_CATEGORIES[0].id && (
        <>
          <div className="emoji-section-label tiny" aria-hidden>La pi souvan</div>
          <div className="emoji-grid quick">
            {FREQUENT_EMOJIS.map((emoji) => (
              <button key={`fq-${emoji.char}`} type="button" className="emoji-btn" onClick={() => pick(emoji)} aria-label={emoji.name} title={emoji.name}>
                {emoji.char}
              </button>
            ))}
          </div>
          <div className="emoji-section-label tiny" aria-hidden>{active.label}</div>
        </>
      )}
      {category !== EMOJI_CATEGORIES[0].id && (
        <div className="emoji-section-label tiny" aria-hidden>{active.label}</div>
      )}
      <div className="emoji-grid">
        {active.emojis.map((emoji) => (
          <button key={emoji.char} type="button" className="emoji-btn" onClick={() => pick(emoji)} aria-label={emoji.name} title={emoji.name}>
            {emoji.char}
          </button>
        ))}
      </div>
    </div>
  );
}
