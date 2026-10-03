import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Blog and promotional images go through next/image with explicit width/height (no layout shift).
    formats: ["image/avif", "image/webp"],
    // Add CDN/CMS hosts here when the blog backend exists.
    remotePatterns: [],
  },
};

export default nextConfig;
