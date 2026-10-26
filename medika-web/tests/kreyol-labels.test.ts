/**
 * Haitian Creole display-label contract tests.
 *
 * The raw backend values (specialties from specialties.json, urgency levels,
 * consultation statuses, gender) are equality-compared for filtering, price
 * lookup and API payloads. These tests pin the DISPLAY mapping and — more
 * importantly — guarantee the raw values are never mutated or dropped:
 * an unknown value must always fall back to itself, never to an invented
 * medical specialty.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  consultationStatusLabel,
  filterSpecialtyOptions,
  genderDisplayLabel,
  normalizeQuery,
  specialtyLabel,
  urgencyLabel,
} from "@/lib/labels";

// The actual raw specialty names seeded into the backend.
const specialtySeed = JSON.parse(
  readFileSync(resolve(__dirname, "../../specialties.json"), "utf8"),
) as { id: string; name: string; price: number }[];
const rawSpecialtyNames = specialtySeed.map((s) => s.name);

describe("specialtyLabel — raw backend values map to Kreyòl display labels", () => {
  it("covers every seeded specialty with a Kreyòl label", () => {
    for (const name of rawSpecialtyNames) {
      const label = specialtyLabel(name);
      expect(label, `specialty "${name}" should have a Kreyòl label`).toBeTruthy();
      expect(label).not.toMatch(/^(Médecine|Cardiologie|Pediatrie)$/); // not the raw French value
    }
  });

  it("maps the directory's known specialties correctly", () => {
    expect(specialtyLabel("Medecine Generale")).toBe("Medsin Jeneral");
    expect(specialtyLabel("Pediatrie")).toBe("Pedyatri");
    expect(specialtyLabel("ORL")).toBe("ORL (zòrèy, ne, gòj)");
  });

  it("falls back to the raw value for unknown specialties (never invents one)", () => {
    expect(specialtyLabel("Chirurgie Vasculaire")).toBe("Chirurgie Vasculaire");
    expect(specialtyLabel("")).toBe("");
    expect(specialtyLabel(null)).toBe("");
    expect(specialtyLabel(undefined)).toBe("");
  });
});

describe("urgencyLabel — internal urgency values stay backend-owned", () => {
  it("maps the four internal values to approved Kreyòl labels", () => {
    expect(urgencyLabel("Faible")).toBe("Ba");
    expect(urgencyLabel("Moyenne")).toBe("Modere");
    expect(urgencyLabel("Haute")).toBe("Wo");
    expect(urgencyLabel("Critique")).toBe("Kritik");
  });

  it("keeps the medical seriousness ranking intact (Critique stays strongest)", () => {
    // The labels must never downgrade urgency wording.
    expect(urgencyLabel("Critique")).toMatch(/Kritik/);
  });

  it("falls back to the raw value when unknown", () => {
    expect(urgencyLabel("Extreme")).toBe("Extreme");
    expect(urgencyLabel(null)).toBe("");
  });
});

describe("consultationStatusLabel", () => {
  it("maps the DB CHECK statuses to Kreyòl", () => {
    expect(consultationStatusLabel("RECHERCHE_MEDECIN")).toBe("An atant");
    expect(consultationStatusLabel("EN_COURS")).toBe("Ap dewoule");
    expect(consultationStatusLabel("TERMINE")).toBe("Fini");
    expect(consultationStatusLabel("REFUSE")).toBe("Refize");
  });

  it("passes unknown statuses through", () => {
    expect(consultationStatusLabel("ARCHIVED")).toBe("ARCHIVED");
  });
});

describe("genderDisplayLabel", () => {
  it("maps stored values (sent to the backend) to Kreyòl display only", () => {
    expect(genderDisplayLabel("Homme")).toBe("Gason");
    expect(genderDisplayLabel("Femme")).toBe("Fi");
    expect(genderDisplayLabel("Autre")).toBe("Autre"); // untouched passthrough
    expect(genderDisplayLabel(null)).toBe("—");
  });
});

describe("specialty picker filtering", () => {
  const options = rawSpecialtyNames.map((name) => ({ value: name, label: specialtyLabel(name) }));

  it("returns every option for an empty query", () => {
    expect(filterSpecialtyOptions(options, "").length).toBe(options.length);
    expect(filterSpecialtyOptions(options, "   ").length).toBe(options.length);
  });

  it("filters on the Kreyòl display label", () => {
    expect(filterSpecialtyOptions(options, "pedyatri")).toEqual([
      { value: "Pediatrie", label: "Pedyatri" },
    ]);
  });

  it("filters on the raw backend value too (users may type the French form)", () => {
    expect(filterSpecialtyOptions(options, "pediatrie")).toEqual([
      { value: "Pediatrie", label: "Pedyatri" },
    ]);
  });

  it("matches without regard to case and accents", () => {
    expect(filterSpecialtyOptions(options, "PEDYATRI").length).toBe(1);
    expect(filterSpecialtyOptions(options, "kadyoloji").length).toBe(1);
  });

  it("keeps raw values intact in the filtered results", () => {
    const out = filterSpecialtyOptions(options, "kadyo");
    expect(out[0].value).toBe("Cardiologie");
  });

  it("returns nothing for a query that matches no specialty", () => {
    expect(filterSpecialtyOptions(options, "zzzz")).toEqual([]);
  });

  it("normalizeQuery strips accents and lowercases", () => {
    expect(normalizeQuery("  PÉDYATRI ")).toBe("pedyatri");
  });
});
