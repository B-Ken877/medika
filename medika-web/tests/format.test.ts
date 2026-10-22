/**
 * Formatting utilities tests — statuses, currency, dates, avatars.
 */
import { describe, expect, it } from "vitest";
import {
  avatarUrl,
  formatCurrency,
  formatDaySeparator,
  initialsOf,
  isActiveStatus,
  statusBadgeClass,
  statusLabel,
} from "@/lib/format";

describe("statusLabel", () => {
  it("maps backend statuses to the admin panel's French labels", () => {
    expect(statusLabel("RECHERCHE_MEDECIN")).toBe("En attente");
    expect(statusLabel("EN_COURS")).toBe("En cours");
    expect(statusLabel("TERMINE")).toBe("Terminée");
    expect(statusLabel("REFUSE")).toBe("Refusée");
  });

  it("passes unknown statuses through untouched", () => {
    expect(statusLabel("WEIRD")).toBe("WEIRD");
  });
});

describe("statusBadgeClass", () => {
  it("maps statuses to badge colors", () => {
    expect(statusBadgeClass("RECHERCHE_MEDECIN")).toBe("badge-yellow");
    expect(statusBadgeClass("EN_COURS")).toBe("badge-blue");
    expect(statusBadgeClass("TERMINE")).toBe("badge-green");
    expect(statusBadgeClass("REFUSE")).toBe("badge-red");
    expect(statusBadgeClass("OTHER")).toBe("badge-gray");
  });
});

describe("isActiveStatus", () => {
  it("treats pending and in-progress as active", () => {
    expect(isActiveStatus("EN_COURS")).toBe(true);
    expect(isActiveStatus("RECHERCHE_MEDECIN")).toBe(true);
    expect(isActiveStatus("TERMINE")).toBe(false);
    expect(isActiveStatus("REFUSE")).toBe(false);
  });
});

describe("formatCurrency", () => {
  it("formats amounts in HTG with locale grouping", () => {
    // Node's fr-HT uses a narrow no-break space (U+202F) as group separator.
    const out = formatCurrency(1500).replace(/\u202f|\u00a0/g, " ");
    expect(out).toBe("1 500 HTG");
  });
  it("renders a dash for missing amounts", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });
});

describe("formatDaySeparator", () => {
  it("labels today and yesterday in French", () => {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = now - 24 * 3600;
    expect(formatDaySeparator(now)).toBe("Aujourd'hui");
    expect(formatDaySeparator(yesterday)).toBe("Hier");
  });
  it("returns empty string for missing timestamps", () => {
    expect(formatDaySeparator(undefined)).toBe("");
  });
});

describe("avatarUrl", () => {
  it("prefixes relative backend paths with the API base", () => {
    expect(avatarUrl("/uploads/x/1.jpg")).toBe("/uploads/x/1.jpg");
    expect(avatarUrl("uploads/1.jpg", "https://medikahaiti.site")).toBe(
      "https://medikahaiti.site/uploads/1.jpg",
    );
  });
  it("keeps absolute URLs untouched", () => {
    expect(avatarUrl("https://images.unsplash.com/photo.jpg")).toBe("https://images.unsplash.com/photo.jpg");
  });
  it("returns null when no avatar exists", () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
  });
});

describe("initialsOf", () => {
  it("builds initials from first and last name", () => {
    expect(initialsOf("Sarah Joseph")).toBe("SJ");
  });
  it("takes two letters of a single name", () => {
    expect(initialsOf("Martin")).toBe("MA");
  });
  it("handles missing names", () => {
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
