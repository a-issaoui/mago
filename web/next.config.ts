import type { NextConfig } from "next";

// The Python API is only reachable from this machine; the browser talks to it through these rewrites.
const API = process.env.MAGO_API ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["mago.test"],
  // Local only, so compression buys nothing, and gzip would hold back the live event stream.
  compress: false,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/media/:path*", destination: `${API}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
