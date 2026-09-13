import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the same network use `npm run dev` via this PC's IP address.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "145.126.*.*"],
  experimental: {
    serverActions: {
      // Recipe photos are downscaled client-side; this leaves headroom under Vercel's 4.5 MB cap.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
