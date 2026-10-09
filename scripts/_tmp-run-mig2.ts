import { Client } from "pg";
import * as fs from "fs";

async function main() {
  const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/posbit_test_mig" });
  await c.connect();
  
  const sql = fs.readFileSync("sql/migrate-to-uuid.sql", "utf-8");
  console.log("Ejecutando migración...");
  await c.query(sql);
  
  const r = await c.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='ventas' AND column_name='id'`);
  console.log('ventas.id:', r.rows[0].udt_name);
  const r2 = await c.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='productos' AND column_name='id'`);
  console.log('productos.id:', r2.rows[0].udt_name);
  const r3 = await c.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='productos' AND column_name='moneda_base_id'`);
  console.log('productos.moneda_base_id:', r3.rows[0].udt_name);
  const fk = await c.query(`
    SELECT conname, confrelid::regclass::text AS padre
    FROM pg_constraint WHERE contype='f' AND conrelid='productos'::regclass
  `);
  console.log('FKs de productos:', fk.rows.map(r=>r.conname+'->'+r.padre).join(', '));
  
  await c.end();
}
main();
