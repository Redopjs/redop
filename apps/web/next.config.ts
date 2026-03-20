import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return [
      // Mintlify /docs rewrites so to be in redop.useagents.site/docs
    ];
  },
};

export default nextConfig;
