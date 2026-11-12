/**
 * Consistent profile identity + WhatsApp-style chat header (owner request,
 * Nov 2026).
 *
 * The backend enriches consultation rows with LIVE identities read from the
 * users table (single source of truth — a profile update shows up on the
 * next fetch). Verified here:
 *  - Avatar: photo renders when a URL exists; clean initials fallback
 *    otherwise (missing photo / broken URL);
 *  - chat page header: photo + name + designation + presence from the LIVE
 *    identity, with snapshot/label fallbacks (patient view previously had
 *    NO doctor name at all — only the requested specialty label);
 *  - consultation list: counterpart photo + live name on both views;
 *  - dossier: live profile name first, snapshot fallback;
 *  - types: the identity payload never carries email/phone/biography fields.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Avatar } from "@/components/ui/primitives";
import { avatarUrl, initialsOf } from "@/lib/format";
import { presenceLabel } from "@/lib/ws/presence";

const WEB = resolve(__dirname, "..");
const src = (p: string) => readFileSync(resolve(WEB, p), "utf8");

describe("Avatar (missing-photo handling)", () => {
  it("renders an <img> when a photo URL exists", () => {
    const html = renderToString(
      createElement(Avatar, {
        name: "Dr Test",
        src: "https://cdn.example/av/dr.png",
        alt: "Foto pwofil Dr Test",
      }),
    );
    expect(html).toContain("https://cdn.example/av/dr.png");
    expect(html).toContain("Foto pwofil Dr Test");
  });

  it("falls back to initials when there is no photo (clean default avatar)", () => {
    const html = renderToString(createElement(Avatar, { name: "Pat Test", src: null }));
    expect(html).not.toContain("<img");
    expect(html).toContain("PT"); // initials
  });

  it("handles a missing name gracefully ('?' initials)", () => {
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("Jean Baptiste")).toBe("JB");
  });
});

describe("avatarUrl (profile photo source shapes)", () => {
  it("passes absolute URLs through and prefixes site-relative paths", () => {
    expect(avatarUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    expect(avatarUrl("/api/media/assets/ast_abc.def")).toContain("/api/media/assets/ast_abc.def");
    expect(avatarUrl(null)).toBeNull();
  });
});

describe("chat page header (source contracts)", () => {
  const chat = src("app/app/consultations/[id]/page.tsx");

  it("uses the LIVE identity for both views (not the snapshot patient_name alone)", () => {
    expect(chat).toContain(
      "const partnerIdentity = isDoctor ? consultation.patient_identity : consultation.doctor_identity;",
    );
    expect(chat).toContain(
      "partnerIdentity?.name ?? (isDoctor ? consultation.patient_name : null)",
    );
    expect(chat).toContain("partnerIdentity?.avatar_url ?? null");
  });

  it("passes the partner photo to the Avatar and keeps the presence dot", () => {
    expect(chat).toMatch(/<Avatar\s*\n?\s*name=\{partnerName \?\? user\?\.name\}/);
    expect(chat).toContain("src={partnerAvatarUrl}");
    expect(chat).toContain('className={`presence-dot ${presence}`}');
  });

  it("shows the doctor designation (specialty · hospital) as the WhatsApp-style subtitle", () => {
    expect(chat).toContain(
      '[partnerIdentity.specialty, partnerIdentity.hospital].filter(Boolean).join(" · ")',
    );
    // subtitle precedence: typing > designation · presence > designation/fallback
    expect(chat).toContain("? \"Ap ekri...\"");
    expect(chat).toContain("`${partnerDesignation} · ${presenceLabel(presence)}`");
  });

  it("title falls back to the requested specialty label when no identity exists yet", () => {
    expect(chat).toContain("partnerName ?? specialtyLabel(consultation.specialty_needed)");
  });

  it("header identity block uses the chat-peer classes (WhatsApp-style polish)", () => {
    expect(chat).toContain('className="chat-peer"');
    expect(chat).toContain('className="chat-peer-name nowrap"');
    expect(chat).toContain('className="chat-peer-sub tiny muted nowrap"');
  });
});

describe("consultation list (source contracts)", () => {
  const list = src("app/app/consultations/page.tsx");

  it("renders the counterpart's live photo and name on BOTH views with fallbacks", () => {
    // Whitespace-tolerant: the ternary is formatted across lines in the JSX.
    expect(list).toMatch(
      /isDoctor\s*\n?\s*\? c\.patient_identity\?\.name \?\? c\.patient_name\s*\n?\s*:\s*c\.doctor_identity\?\.name \?\? specialtyLabel\(c\.specialty_needed\)/,
    );
    expect(list).toContain("src={isDoctor ? c.patient_identity?.avatar_url : c.doctor_identity?.avatar_url}");
    expect(list).toContain("<Avatar");
  });
});

describe("identity surfaces audit (source contracts)", () => {
  it("notes header prefers the live patient name over the snapshot", () => {
    const notes = src("app/app/consultations/[id]/notes/page.tsx");
    expect(notes).toContain("consultation.patient_identity?.name ?? consultation.patient_name");
  });

  it("dossier shows the viewer's LIVE profile name (snapshot only as fallback)", () => {
    const dossier = src("app/app/dossier/page.tsx");
    expect(dossier).toContain("{user?.name ?? history?.patient_name}");
  });

  it("wallet earnings keep the historical snapshot (financial records, by design)", () => {
    const wallet = src("app/app/wallet/page.tsx");
    expect(wallet).toContain("e.patient_name");
  });
});

describe("types (privacy contract)", () => {
  it("ParticipantIdentity carries name/avatar/role + doctor-only designation fields — never contact PII", () => {
    const t = src("lib/api/types.ts");
    expect(t).toContain("export interface ParticipantIdentity");
    const iface = t.slice(t.indexOf("export interface ParticipantIdentity"), t.indexOf("export interface Consultation"));
    for (const allowed of ["id", "name", "avatar_url", "role", "specialty", "hospital"]) {
      expect(iface).toContain(allowed);
    }
    for (const forbidden of ["email", "phone", "biography", "license", "verification"]) {
      expect(iface).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
    expect(t).toMatch(/patient_identity\?: ParticipantIdentity \| null/);
    expect(t).toMatch(/doctor_identity\?: ParticipantIdentity \| null/);
  });
});

describe("presence labels (existing system reused, unchanged)", () => {
  it("WhatsApp-style status text stays Kreyòl and explicit", () => {
    expect(presenceLabel("online")).toBe("Anliy");
    expect(presenceLabel("offline")).toBe("Pa anliy");
    expect(presenceLabel("unknown")).toBe("");
  });
});
