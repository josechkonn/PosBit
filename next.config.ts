import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // output standalone genera un servidor autocontenido necesario para
  // el build de Electron desktop. No afecta al modo desarrollo (next dev).
  output: "standalone",
};

export default nextConfig;

