import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb", // Yahan 500MB set kiya hai, apni jarurat ke hisaab se change kar lena
    },
  },
};

export default nextConfig;