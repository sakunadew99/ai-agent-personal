import type { NextConfig } from "next";
// Strip trailing slashes: "https://api.example.com/" would otherwise produce "//api/v1/..." (404 on the API).
const apiInternalUrl = (process.env.API_INTERNAL_URL || "http://localhost:8000").trim().replace(/\/+$/, "");

const config: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
};
export default config;
