/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/admin",
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/admin/api/:path*",
        destination: "http://localhost:3000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
