import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { pool } from "./db";

// En Vercel (HTTPS en la nube) las cookies deben ser Secure (__Secure-).
// En la app de escritorio (Electron en http://127.0.0.1:puerto) o en desarrollo local (http://localhost:3000),
// las cookies NO deben tener Secure ni el prefijo __Secure-, ya que los navegadores basados en Chromium
// descartan inmediatamente cualquier cookie Secure recibida sobre conexiones HTTP.
const isVercel = Boolean(process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_ENV);
const useSecureCookies = Boolean(
  isVercel ||
  (process.env.BETTER_AUTH_URL && process.env.BETTER_AUTH_URL.startsWith("https://"))
);

export const auth = betterAuth({
  appName: "PosBit",
  baseURL: {
    allowedHosts: ["*.vercel.app", "localhost:*", "127.0.0.1:*", "*"],
    fallback: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  },
  trustedOrigins: [
    "https://*.vercel.app",
    "http://localhost:*",
    "http://localhost:3000",
    "http://127.0.0.1:*",
  ],
  advanced: {
    useSecureCookies,
  },
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
