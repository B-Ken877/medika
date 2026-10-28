"use client";

/**
 * SpecialtySelect — custom searchable specialty picker (Clinical Calm).
 *
 * Replaces the browser-native <select>/<option> pair whose opened panel
 * cannot be styled consistently across browsers. Visual vocabulary reuses
 * the existing design tokens (see .sp-* rules in app/globals.css).
 *
 * Accessibility (ARIA APG combobox + listbox popup):
 *  - The trigger is a <button> with aria-haspopup="listbox" + aria-expanded.
 *  - The panel holds a search textbox (aria-autocomplete="list") and a
 *    role="listbox" with role="option" entries carrying aria-selected.
 *  - aria-activedescendant on the search input tracks the active option.
 *  - ArrowUp/ArrowDown move, Enter/Space-free (button) select, Escape closes
 *    and restores focus to the trigger, click-outside closes.
 *
 * DATA INTEGRITY: `option.value` is the RAW backend specialty value
 * (used for price lookup, doctor filtering and the API payload);
 * `option.label` is only the Haitian Creole display label.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { filterSpecialtyOptions } from "@/lib/labels";

export interface SpecialtyOption {
  /** Raw backend value — never mutated by this component. */
  value: string;
  /** Haitian Creole display label. */
  label: string;
  /** Optional formatted price shown on the right. */
  priceLabel?: string | null;
}

export interface SpecialtySelectProps {
  id?: string;
  options: SpecialtyOption[];
  value: string;
  onChange: (value: string) => void;
  /** Closed-control placeholder. */
  placeholder?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Empty-search-results message. */
  emptyMessage?: string;
  /** Shown while the specialty list is loading. */
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  /** Accessible name when no <label htmlFor> is wired. */
  ariaLabel?: string;
}

export function SpecialtySelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Chwazi yon espesyalite",
  searchPlaceholder = "Chèche yon espesyalite...",
  emptyMessage = "Nou pa jwenn espesyalite sa a.",
  loading = false,
  loadingLabel = "N ap chaje espesyalite yo...",
  disabled = false,
  ariaLabel,
}: SpecialtySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const searchId = useId();

  const filtered = useMemo(() => filterSpecialtyOptions(options, query), [options, query]);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // Keep the active option valid whenever the filtered set or query changes.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(filtered.length > 0 ? filtered.length - 1 : 0);
  }, [filtered.length, activeIndex]);

  // Close on click-outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Focus the search input when the panel opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      const idx = filtered.length > 0 ? Math.max(0, filtered.findIndex((o) => o.value === value)) : 0;
      setActiveIndex(idx);
      // Focus after the panel mounts.
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll the active option into view (arrow-key navigation).
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
  };

  const closePanel = (returnFocus = true) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  };

  const select = (option: SpecialtyOption) => {
    onChange(option.value);
    closePanel();
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((i) => {
        if (e.key === "ArrowDown") return (i + 1) % filtered.length;
        return (i - 1 + filtered.length) % filtered.length;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[activeIndex];
      if (option) select(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
    } else if (e.key === "Tab") {
      // Let focus leave naturally; the panel closes without stealing Tab.
      setOpen(false);
      setQuery("");
    }
  };

  const activeDescendant =
    open && filtered.length > 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  return (
    <div className="sp-select" ref={rootRef} data-open={open || undefined}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="sp-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => (open ? closePanel(false) : openPanel())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openPanel();
          }
        }}
      >
        <span className={`sp-value ${selected ? "" : "sp-placeholder"}`}>
          {selected ? (
            <>
              {selected.label}
              {selected.priceLabel && <span className="sp-price-inline"> · {selected.priceLabel}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={16} className="sp-chevron" aria-hidden />
      </button>

      {open && (
        <div className="sp-panel" role="presentation">
          <div className="sp-search-wrap">
            <Search size={15} aria-hidden className="sp-search-icon" />
            <input
              ref={searchRef}
              id={searchId}
              type="text"
              className="sp-search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescendant}
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {loading ? (
            <p className="sp-status" role="status">
              {loadingLabel}
            </p>
          ) : filtered.length === 0 ? (
            <p className="sp-status" role="status">
              {emptyMessage}
            </p>
          ) : (
            <ul className="sp-list" id={listboxId} role="listbox" aria-label={ariaLabel ?? placeholder} ref={listRef}>
              {filtered.map((o, i) => {
                const isSelected = o.value === value;
                return (
                  <li key={o.value} role="option" aria-selected={isSelected} data-index={i} id={`${listboxId}-opt-${i}`}>
                    <button
                      type="button"
                      className="sp-option"
                      data-active={i === activeIndex || undefined}
                      tabIndex={-1}
                      onClick={() => select(o)}
                      onMouseEnter={() => setActiveIndex(i)}
                    >
                      <span className="sp-option-label">
                        {o.label}
                        {isSelected && <Check size={15} className="sp-check" aria-hidden />}
                      </span>
                      {o.priceLabel && <span className="sp-price">{o.priceLabel}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
