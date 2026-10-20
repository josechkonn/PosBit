import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "./db";

export const auth = betterAuth({
  appName: "PosBit",
  baseURL: {
    allowedHosts: ["*.vercel.app", "localhost:*", "127.0.0.1:*", "*"],
    fallback: "http://localhost:3000",
  },
  trustedOrigins: [
    "https://*.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:*",
  ],
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "pb_auth_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e2026",
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "usuario",
        input: false,
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
