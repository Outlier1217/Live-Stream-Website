import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "1000mb",
    },
    // Yeh Middleware ki 10MB limit ko hatayega
    middlewareClientMaxBodySize: "1000mb",
    // Naye proxy convention ke liye bhi limit add kar di hai
    proxyClientMaxBodySize: "1000mb", 
  },
};

export default nextConfig;
