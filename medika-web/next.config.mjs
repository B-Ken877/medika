/** @type {import('next').NextConfig} */

/**
 * Routing model:
 *
 *  - Production on Vercel (single project, Vercel Services): the top-level
 *    rewrites in the repository-root vercel.json route /api, /payment,
 *    /uploads and /ws to the Express "api" service BEFORE any request
 *    reaches this Next.js app. The browser only ever talks to one origin
 *    and no proxy is configured here — same-origin relative URLs just work.
 *  - Self-hosted: nginx (or equivalent) routes /api, /payment, /uploads and
 *    /ws to the backend, exactly like the legacy VPS — again no proxy here.
 *  - Local development: rewrites below mirror the production nginx routes
 *      (/api and /uploads -> backend :3000, /payment -> MonCash server :9998).
 *
 * Note: there is deliberately NO production API_ORIGIN proxy any more. The
 * old separate-Vercel-project architecture proxied /api,/payment,/uploads
 * through this Next.js server; with Vercel Services the platform router
 * sends those paths straight to the api service (one less hop, no
 * cross-project coupling). See ../docs/DEPLOYMENT.md.
 */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    // Local development proxy — mirrors the production nginx routes.
    const backend = process.env.DEV_BACKEND_ORIGIN || "http://localhost:3000";
    const payment = process.env.DEV_PAYMENT_ORIGIN || "http://localhost:9998";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
      { source: "/payment/:path*", destination: `${payment}/payment/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", "value": "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", "value": "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
