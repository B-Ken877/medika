/**
 * Regression tests for the patient-dashboard hero artwork (issue #109).
 *
 * Issue #109 placed the generated Medika doctor artwork into the reserved
 * `.hero-art` stage (right-hand side of the Akèy hero). The stage keeps a
 * FIXED 4/5 aspect ratio and the asset is produced at exactly the same 4/5
 * intrinsic ratio, so `object-fit: cover` crops nothing, the face keeps the
 * reference's upper-third position, and image loading can never shift
 * layout. The asset carries mint-matched feathered edges (no rectangular
 * boundary) so it blends into the wave field like the approved reference.
 *
 * Environment note: medika-web has no jsdom/React Testing Library dependency,
 * so the component and CSS are verified via source-contract guards (the same
 * pattern used by tests/patient-dashboard-auth.test.ts) plus a real check of
 * the committed asset's format and dimensions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSource = readFileSync(
  resolve(__dirname, "../components/consultation/PatientDashboard.tsx"),
  "utf8",
);
const themeSource = readFileSync(
  resolve(__dirname, "../app/patient-theme.css"),
  "utf8",
);

describe("patient dashboard hero artwork (issue #109)", () => {
  it("the generated asset is committed and is a real PNG with alpha", () => {
    const assetPath = resolve(__dirname, "../public/patient-hero-doctor.png");
    expect(existsSync(assetPath)).toBe(true);
    const bytes = readFileSync(assetPath);
    // PNG magic number
    expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    // IHDR: bit depth 8, color type 6 = RGBA (alpha for the feathered edges)
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(6);
  });

  it("the asset's intrinsic dimensions match the stage's 4/5 ratio (no cover crop, stable face position)", () => {
    const bytes = readFileSync(resolve(__dirname, "../public/patient-hero-doctor.png"));
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBe(560);
    expect(height).toBe(700);
    expect(width / height).toBeCloseTo(4 / 5, 5);
  });

  it("the dashboard renders the artwork inside the reserved stage with fixed dimensions", () => {
    expect(dashboardSource).toContain('src="/patient-hero-doctor.png"');
    expect(dashboardSource).toContain('className="hero-art-img"');
    // Explicit intrinsic dimensions keep the stage layout-shift-free while loading.
    expect(dashboardSource).toContain("width={560}");
    expect(dashboardSource).toContain("height={700}");
    // Creole alt text, consistent with the dashboard's language.
    expect(dashboardSource).toContain('alt="Ilistrasyon doktè Medika a"');
    // Eager load: the hero is the LCP element on the patient home screen.
    expect(dashboardSource).toContain('loading="eager"');
  });

  it("the stage keeps its fixed 4/5 aspect and the image fills it with cover", () => {
    expect(themeSource).toMatch(/\.hero-art\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s);
    expect(themeSource).toMatch(
      /\.hero-art\s+\.hero-art-img\s*\{[^}]*object-fit:\s*cover/s,
    );
  });

  it("the abstract placeholder CSS was fully removed (no dead rules)", () => {
    expect(themeSource).not.toContain("hero-art-shape");
    // The dashboard no longer renders the placeholder span either.
    expect(dashboardSource).not.toContain("hero-art-shape");
  });
});
