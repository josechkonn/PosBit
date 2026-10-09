// Sesión temporal para pruebas manuales de la API (se borra al terminar).
import "dotenv/config";
import crypto from "node:crypto";
import { Client } from "pg";

const SECRET = process.env.BETTER_AUTH_SECRET || "better-auth-secret-12345678901234567890";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const token = crypto.randomBytes(32).toString("hex");
const id = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 60 * 60 * 1000);
const userId = "xZtHZXeN4o6vrzd3Uq0hkOHIFFGemEVS";

await db.query(
  `INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId")
   VALUES ($1, $2, $3, NOW(), $4)`,
  [id, expires, token, userId]
);

const sig = crypto.createHmac("sha256", SECRET).update(token).digest("base64");
console.log(`${token}.${sig}`);
await db.end();
