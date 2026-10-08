import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const res = await pool.query('SELECT id, name, email, role FROM "user" WHERE email = $1', ["admin@admin.com"]);
  console.log("Users:", res.rows);
  await pool.end();
}

main();
