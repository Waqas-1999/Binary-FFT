import type { NextConfig } from "next";

/** Where the web server forwards `/api/*`. Read at build time; set it for each deployment. */
const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Blog and promotional images go through next/image with explicit width/height (no layout shift).
    formats: ["image/avif", "image/webp"],
    // Add CDN/CMS hosts here when the blog backend exists.
    remotePatterns: [],
  },
  // Same-origin API: session cookies stay first-party and no CORS is needed in the browser.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
