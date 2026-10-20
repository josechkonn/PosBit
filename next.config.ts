import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // output standalone genera un servidor autocontenido necesario para
  // el build de Electron desktop y despliegues en la nube (Railway / Docker / VPS).
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/**/*": ["./sql/**/*"],
    "/**/*": ["./sql/**/*"],
  },
  outputFileTracingExcludes: {
    "*": ["./mobile/**/*", "./dist-electron/**/*", "./resources/**/*"],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Sync-Api-Key",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
