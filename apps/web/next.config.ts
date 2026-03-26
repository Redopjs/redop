import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // Mintlify /docs rewrites so to be in redop.useagents.site/docs
      {
        destination: "https://redop.mintlify.dev/docs",
        source: "/docs",
      },
      {
        destination: "https://redop.mintlify.dev/docs/:match*",
        source: "/docs/:match*",
      },
    ];
  },
  typedRoutes: true,
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
