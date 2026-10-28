/** @type {import('next').NextConfig} */

/**
 * The admin panel calls the backend with absolute paths (`/api/...` — see
 * lib/api.js). Those requests are routed by the hosting layer:
 *   - Vercel (single project, Vercel Services): the top-level rewrites in
 *     the repository-root vercel.json route /api/* to the Express "api"
 *     service — the requests never reach this app, so no proxy is
 *     configured here.
 *   - legacy VPS: nginx routes /api → backend container.
 *   - local dev: the rewrite below proxies /api to the local server.js
 *     (DEV_BACKEND_ORIGIN, default http://localhost:3000).
 *
 * basePath stays "/admin": the platform routes /admin and /admin/* to this
 * service with the original path preserved, which is exactly what a
 * basePath-prefixed Next.js app expects.
 */
const nextConfig = {
  basePath: "/admin",
  output: "standalone",
  async rewrites() {
    // Local development proxy only (production routing is done by the
    // platform — see the note above).
    const apiOrigin = (process.env.DEV_BACKEND_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
        basePath: false, // clients call absolute /api/*, not /admin/api/*
      },
    ];
  },
};

export default nextConfig;
