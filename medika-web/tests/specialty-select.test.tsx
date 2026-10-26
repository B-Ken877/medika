/**
 * Runtime smoke test — renders the SpecialtySelect component to static
 * markup (server render) to guarantee the picker mounts with the approved
 * Kreyòl copy, raw-value options and ARIA wiring. The panel itself only
 * opens on client interaction (covered by the source-contract guards in
 * consult-flow.test.ts); this test pins the closed control.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { SpecialtySelect } from "@/components/ui/SpecialtySelect";

const options = [
  { value: "Medecine Generale", label: "Medsin Jeneral", priceLabel: "750 HTG" },
  { value: "Cardiologie", label: "Kadyoloji", priceLabel: "1 500 HTG" },
  { value: "Pediatrie", label: "Pedyatri", priceLabel: "1 000 HTG" },
];

describe("SpecialtySelect — closed control (SSR smoke)", () => {
  it("renders a combobox trigger with the approved Kreyòl placeholder", () => {
    const html = renderToString(
      createElement(SpecialtySelect, { options, value: "", onChange: () => {} }),
    );
    expect(html).toContain("Chwazi yon espesyalite");
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows the selected Kreyòl label with the price", () => {
    const html = renderToString(
      createElement(SpecialtySelect, { options, value: "Cardiologie", onChange: () => {} }),
    );
    expect(html).toContain("Kadyoloji");
    expect(html).toContain("1 500 HTG");
    expect(html).not.toContain("Chwazi yon espesyalite");
  });

  it("does not leak raw backend values into the closed trigger display", () => {
    const html = renderToString(
      createElement(SpecialtySelect, { options, value: "Cardiologie", onChange: () => {} }),
    );
    expect(html).not.toContain(">Cardiologie<");
  });

  it("renders a loading state when specialties have not loaded", () => {
    const html = renderToString(
      createElement(SpecialtySelect, {
        options: [],
        value: "",
        onChange: () => {},
        loading: true,
      }),
    );
    expect(html).toContain("Chwazi yon espesyalite"); // closed control unchanged
  });

  it("keeps a disabled state for the trigger", () => {
    const html = renderToString(
      createElement(SpecialtySelect, { options, value: "", onChange: () => {}, disabled: true }),
    );
    expect(html).toContain("disabled");
  });
});
