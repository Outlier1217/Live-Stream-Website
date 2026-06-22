import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "1000mb",
    },
    // Ab sirf naya wala proxyClientMaxBodySize hi use karenge
    proxyClientMaxBodySize: "1000mb", 
  },
};

export default nextConfig;
