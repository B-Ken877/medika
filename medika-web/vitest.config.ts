import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next.js compiles app code with the automatic JSX runtime; mirror that for
  // .tsx test files so components render in the node test environment.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
