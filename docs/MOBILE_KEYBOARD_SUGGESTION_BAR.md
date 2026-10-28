# Mobile keyboard suggestion bar — identification runbook (issue #53)

Follow-up to issue #47 / PR #52 (header visibility above the Android keyboard).
After PR #52 landed, one symptom remained: an unwanted black
suggestions/toolbar bar directly above the Android keyboard while typing in a
chat. This document records what the app renders, what it cannot control, and
how to identify the exact owner of the bar on a real device.

## 1. Audit result: the app does not render the bar

A full audit of the chat surfaces (consultation chat, support-ticket chat, and
the in-call chat introduced by PR #49) found **no app-rendered accessory or
suggestion bar anywhere in the composer region**:

| Element | File / rule | Verdict |
| --- | --- | --- |
| Composer subtree | `medika-web/app/app/consultations/[id]/page.tsx` (composer form) | Attachment icon button, emoji button, text input, send button — nothing else |
| Ticket composer subtree | `medika-web/app/app/tickets/[id]/page.tsx` | Text input + send button only |
| In-call composer subtree | `medika-web/components/consultation/InCallChat.tsx` | Label (screen-reader only), text input, send button |
| `.chat-composer` background | `medika-web/app/visual-polish.css` | `rgba(255, 255, 255, 0.98)` — light, not a black strip |
| `.chat-composer .input` background | same file | `var(--gray-50)` — light |
| `.jump-latest` pill | `medika-web/app/globals.css` | Small, right-aligned, light surface, green text — not a full-width bar |
| Emoji picker popover | `medika-web/app/globals.css` `.emoji-picker` | Light surface, opens only on explicit tap |
| Dark theme / `prefers-color-scheme` / `data-theme` | whole `medika-web/app` | Not present — the app is light-only |

Above the composer the DOM only ever contains (conditionally) the read-only
error alert and the floating jump-to-latest pill; below the composer (doctor
view only) is the light prescription panel. Nothing in the app tree renders
between the composer's bottom edge and the keyboard — that space belongs to
the browser/OS window stack.

## 2. The two real candidates (both outside the page DOM)

Both candidates visually sit between the input row and the keyboard keys,
which matches the report exactly. Distinguish them like this on a device:

### Candidate A — Gboard suggestion strip (IME-owned)

- Rendered **inside the Gboard window**, above the key rows.
- Shows **word suggestions that change as you type**, plus mic / sticker /
  menu icons on the strip.
- Renders **black when Gboard's theme is dark**; the app cannot influence it.
- Device test: Gboard → Settings → Theme → pick a light theme. If the bar
  turns light, it is Gboard's strip.
- Web remedy: **none**. User-side: change Gboard theme, or Gboard →
  Settings → Text suggestions → turn off "Show suggestion strip".

### Candidate B — Chrome autofill accessory strip (browser-owned)

- Rendered by **Chrome**, attached to the top of the keyboard.
- Shows **"Use saved address / payment method / password"** style entries —
  profile data, not word suggestions.
- Device test: Chrome → Settings → Autofill using another device / Addresses,
  payment methods, passwords → temporarily disable. If the bar disappears, it
  is Chrome's autofill strip.
- Web remedy: declare the field non-autofillable. **This shipped in the
  follow-up PR to PR #52**: `autoComplete="off"` is now set on **both the
  composer `<form>` and its `<input>`** in all three chat surfaces
  (consultation, ticket, in-call). Chromium treats the form-level signal as
  authoritative for non-credential forms. A chat message is not a
  credential, address, or payment field, so this is the correct semantic.

## 3. What the app deliberately does NOT do

- No attempt to hide or overlay OS/keyboard UI (per the issue's constraint).
- `enterKeyHint="send"` and `autoCapitalize="sentences"` from PR #52 are kept:
  they match the existing Enter-to-send behavior and natural typing, and are
  not causes of either candidate bar.
- The viewport fix from PR #52 (`interactive-widget=resizes-content`) is
  untouched; the in-call composer now matches the same input contract as the
  other two composers.

## 4. Owner verification checklist (requires a real Android device)

1. Open a consultation chat in Android Chrome, focus the composer.
2. Type a word: do the strip entries follow the typed letters? → Candidate A
   (Gboard strip). Do they show saved profile data? → Candidate B (Chrome
   autofill).
3. Apply the matching device test from section 2 to confirm the owner.
4. For Candidate B: reload the chat, focus the composer again, and confirm
   the form-level `autoComplete="off"` suppression removes the strip.
5. For Candidate A: confirm the strip follows Gboard theme (light theme
   turns it light) and report it as OS-owned — no further app change is
   possible.
6. Regression guard: confirm the header stays visible while the keyboard is
   open (issue #47 fix) and that typing, autocorrect, and Enter-to-send all
   still work.

Automated coverage: `medika-web/tests/chat-scroll.test.ts` contains a
"Source contracts — keyboard suggestion bar (issue #53)" suite asserting the
form-level contract on all three composer forms, the in-call input parity,
and that no suggestion/toolbar/accessory element exists in any composer.
