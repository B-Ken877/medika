/** @type {import('next').NextConfig} */

/**
 * The admin panel calls the backend with absolute paths (`/api/...` — see
 * lib/api.js). Those requests are routed by the hosting layer:
 *   - legacy VPS: nginx routes /api → backend container
 *   - local dev / Vercel: the rewrite below proxies them to the backend
 *     (API_ORIGIN, defaulting to the local server.js on :3000).
 */
const nextConfig = {
  basePath: "/admin",
  output: "standalone",
  async rewrites() {
    const apiOrigin = (process.env.API_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
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
