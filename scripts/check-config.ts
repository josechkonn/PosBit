import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const res = await pool.query('SELECT * FROM configuracion ORDER BY tipo, clave');
  console.log("Total rows:", res.rows.length);
  res.rows.forEach(r => console.log(`  ${r.clave} = "${r.valor}" (${r.tipo})`));
  await pool.end();
}

main();
