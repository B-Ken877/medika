/** @type {import('next').NextConfig} */

/**
 * Routing model:
 *
 *  - Production on Vercel (API deployed as a separate Vercel project):
 *      API_ORIGIN=https://medika-api.<team>.vercel.app   (build-time env)
 *    The Next.js server proxies /api, /payment and /uploads to the API project
 *    so the browser only ever talks to one origin (no CORS, cookies-free
 *    Bearer auth). WebSocket upgrades CANNOT be proxied here — clients connect
 *    directly to the API origin via NEXT_PUBLIC_WS_URL=wss://…/ws.
 *
 *  - Local development: rewrites mirror the production nginx routes
 *      (/api and /uploads -> backend :3000, /payment -> MonCash server :9998).
 */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN;
    if (apiOrigin) {
      // Production proxy through this Next.js server (same-origin for browsers).
      const backend = apiOrigin.replace(/\/+$/, "");
      return [
        { source: "/api/:path*", destination: `${backend}/api/:path*` },
        { source: "/payment/:path*", destination: `${backend}/payment/:path*` },
        { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
      ];
    }
    // Local development proxy — mirrors the legacy nginx routes.
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
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
