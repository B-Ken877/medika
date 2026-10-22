/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    // Local development proxy — mirrors the production nginx routes
    // (/api and /uploads -> backend :3000, /payment -> MonCash server :9998).
    // In production the Next.js server only serves the app shell; nginx handles
    // these routes before requests ever reach this process.
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
