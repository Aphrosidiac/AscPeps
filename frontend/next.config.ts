import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Inlines the small (~11KB) atomic Tailwind CSS bundle into <head>
    // instead of a render-blocking <link>, per the performance audit's
    // finding that it cost 120-157ms on every page load. Production-only —
    // no effect in dev.
    inlineCss: true,
  },
};

export default nextConfig;
