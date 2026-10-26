/**
 * Emoji picker — curated in-app set (no heavyweight dependency) plus a
 * cursor-safe insertion helper.
 *
 * Unicode safety: insertion counts CODE POINTS (Array.from), never splitting
 * surrogate pairs; the composer's 4000-unit limit is enforced without ever
 * truncating mid-sequence. Emojis survive PostgreSQL (UTF-8 TEXT), REST,
 * WebSocket delivery and refresh untouched — nothing in the stack strips
 * or normalizes them.
 */

export interface EmojiItem {
  char: string;
  name: string;
}

export interface EmojiCategory {
  id: string;
  label: string;
  emojis: EmojiItem[];
}

/** Curated, useful set for a medical chat — restrained, mobile-grid sized. */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "reyaksyon",
    label: "Reyaksyon",
    emojis: [
      { char: "😀", name: "Souri kontan" },
      { char: "😃", name: "Souri byen" },
      { char: "😄", name: "Souri je fèmen" },
      { char: "😁", name: "Souri bèl" },
      { char: "🙂", name: "Souri lejè" },
      { char: "😉", name: "Kone yon je" },
      { char: "😊", name: "Souri kalm" },
      { char: "😍", name: "Renmen anpil" },
      { char: "😘", name: "Anbrase" },
      { char: "😗", name: "Bize" },
      { char: "😙", name: "Bize kontan" },
      { char: "😚", name: "Bize fèmen je" },
      { char: "☺️", name: "Souri senp" },
      { char: "😋", name: "Manje bon" },
      { char: "😛", name: "Lang deyò" },
      { char: "🤗", name: "Anbrase sere" },
      { char: "🤔", name: "Ap reflesi" },
      { char: "🤨", name: "Sispèk" },
      { char: "😐", name: "Nèt" },
      { char: "😴", name: "Ap dòmi" },
      { char: "😪", name: "Fatige" },
      { char: "😥", name: "Tris" },
      { char: "😮", name: "Sezi" },
      { char: "😬", name: "Je sere" },
      { char: "😅", name: "Swi" },
      { char: "😂", name: "Mouri ri" },
      { char: "🤣", name: "Ri gwo" },
      { char: "😓", name: "Swi frèt" },
      { char: "😔", name: "Deskouraje" },
      { char: "🙁", name: "Fache yon ti kras" },
      { char: "☹️", name: "Pa kontan" },
      { char: "😢", name: "Ap kriye" },
      { char: "😭", name: "Kriye fò" },
      { char: "😤", name: "Entèdi" },
      { char: "😠", name: "Fache" },
      { char: "🤬", name: "Kolon" },
      { char: "🤒", name: "Tè cho" },
      { char: "🤕", name: "Blesi tèt" },
      { char: "🤢", name: "Vanti" },
      { char: "🤧", name: "Eterni" },
      { char: "😷", name: "Mas fron" },
      { char: "🥵", name: "Tè cho" },
      { char: "🥶", name: "Tè frèt" },
    ],
  },
  {
    id: "jes",
    label: "Jès",
    emojis: [
      { char: "👍", name: "Bravo" },
      { char: "👎", name: "Pa dakò" },
      { char: "👌", name: "Tout byen" },
      { char: "✌️", name: "La pa" },
      { char: "🤞", name: "Chans" },
      { char: "🤝", name: "Akò" },
      { char: "🙏", name: "Mèsi" },
      { char: "👏", name: "Ap bat bravo" },
      { char: "💪", name: "Fòs" },
      { char: "👋", name: "Bonjou" },
      { char: "🤙", name: "Rele m" },
      { char: "✋", name: "Stòp" },
      { char: "🫶", name: "Renmen" },
      { char: "🤌", name: "Kesyon" },
      { char: "👉", name: "La a" },
      { char: "☝️", name: "Enpòtan" },
    ],
  },
  {
    id: "kè",
    label: "Santiman",
    emojis: [
      { char: "❤️", name: "Kè" },
      { char: "🧡", name: "Kè zoranj" },
      { char: "💛", name: "Kè jòn" },
      { char: "💚", name: "Kè vèt" },
      { char: "💙", name: "Kè ble" },
      { char: "💜", name: "Kè viyolet" },
      { char: "🖤", name: "Kè nwa" },
      { char: "🤍", name: "Kè blan" },
      { char: "💔", name: "Kè kraze" },
      { char: "💕", name: "De kè" },
      { char: "💞", name: "Kè ki vire" },
      { char: "✨", name: "Etwà" },
      { char: "⭐", name: "Etwà" },
      { char: "🌟", name: "Klere" },
      { char: "🔥", name: "Dife" },
      { char: "💡", name: "Lide" },
    ],
  },
  {
    id: "sante",
    label: "Sante",
    emojis: [
      { char: "🩺", name: "Stetoskòp" },
      { char: "💊", name: "Medikaman" },
      { char: "💉", name: "Piki" },
      { char: "🩹", name: "Bandaj" },
      { char: "🌡️", name: "Tèmometè" },
      { char: "🤒", name: "Maladi" },
      { char: "😷", name: "Mas" },
      { char: "🧠", name: "Sèvo" },
      { char: "🫀", name: "Kè moun" },
      { char: "🫁", name: "Poumon" },
      { char: "🦷", name: "Dant" },
      { char: "🦴", name: "Zo" },
      { char: "👀", name: "Je" },
      { char: "👂", name: "Zorèy" },
      { char: "🤰", name: "Ansent" },
      { char: "👶", name: "Bebe" },
      { char: "🚑", name: "Anbilans" },
      { char: "🏥", name: "Lopital" },
      { char: "🍎", name: "Pom" },
      { char: "🥗", name: "Salad" },
      { char: "💧", name: "Dlo" },
      { char: "🛌", name: "Kabann" },
      { char: "🚶", name: "Ap mache" },
      { char: "🏃", name: "Ap kouri" },
    ],
  },
  {
    id: "objè",
    label: "Lavi",
    emojis: [
      { char: "📱", name: "Telefòn" },
      { char: "📞", name: "Rele" },
      { char: "📸", name: "Foto" },
      { char: "🕐", name: "Lè" },
      { char: "📅", name: "Dat" },
      { char: "🌍", name: "Latè" },
      { char: "☀️", name: "Sòlèy" },
      { char: "🌧️", name: "Lapli" },
      { char: "⛈️", name: "Oraj" },
      { char: "🏠", name: "Kay" },
      { char: "🚗", name: "Machin" },
      { char: "✈️", name: "Avyon" },
      { char: "🎓", name: "Diplòm" },
      { char: "📚", name: "Liv" },
      { char: "✏️", name: "Kreyon" },
      { char: "⚠️", name: "Atansyon" },
      { char: "❓", name: "Kesyon" },
      { char: "✅", name: "Oui" },
      { char: "❌", name: "Non" },
      { char: "💯", name: "San pwoblèm" },
    ],
  },
];

/**
 * Insert an emoji at the caret WITHOUT breaking surrogate pairs or combined
 * sequences: the resulting string is counted in code points; if the limit
 * would be exceeded the insertion is refused (returns null). The returned
 * caret is a UTF-16 unit offset, directly usable as selectionStart.
 */
export function insertAtCursor(
  draft: string,
  emoji: string,
  caret: number,
  maxLength = 4000,
): { value: string; caret: number } | null {
  if (!emoji) return null;
  const safeCaret = Math.max(0, Math.min(caret, draft.length));
  const before = draft.slice(0, safeCaret);
  const after = draft.slice(safeCaret);
  const value = before + emoji + after;
  if (Array.from(value).length > maxLength) return null;
  return { value, caret: safeCaret + emoji.length };
}

/** Frequently-used quick row (top of the picker). */
export const FREQUENT_EMOJIS: EmojiItem[] = [
  { char: "👍", name: "Bravo" },
  { char: "🙏", name: "Mèsi" },
  { char: "❤️", name: "Kè" },
  { char: "😀", name: "Souri kontan" },
  { char: "😂", name: "Mouri ri" },
  { char: "😮", name: "Sezi" },
  { char: "🤔", name: "Ap reflesi" },
  { char: "🤒", name: "Tè cho" },
];
