// Respaldo de la base de datos: DDL + datos en JSON.
// Uso: npx tsx scripts/backup-db.ts <directorio>
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const OUT = process.argv[2] || "./backups/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const c = new Client({ connectionString: url });
  await c.connect();

  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  // 1) Tablas y columnas
  const cols = await c.query(`
    SELECT table_name, column_name, data_type, udt_name, column_default, is_nullable, ordinal_position
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, ordinal_position`);
  fs.writeFileSync(path.join(OUT, `columnas-${stamp}.json`), JSON.stringify(cols.rows, null, 2));

  // 2) Restricciones (PK, FK, unique)
  const cons = await c.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
           kcu.column_name, ccu.table_name AS foreign_table
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
    WHERE tc.table_schema='public' ORDER BY tc.table_name`);
  fs.writeFileSync(path.join(OUT, `constraints-${stamp}.json`), JSON.stringify(cons.rows, null, 2));

  // 3) Índices
  const idx = await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename`);
  fs.writeFileSync(path.join(OUT, `indices-${stamp}.json`), JSON.stringify(idx.rows, null, 2));

  // 4) Secuencias (para conocer los últimos valores de los nextval)
  const seqs = await c.query(`
    SELECT sequencename, last_value FROM pg_sequences WHERE schemaname='public'`);
  fs.writeFileSync(path.join(OUT, `secuencias-${stamp}.json`), JSON.stringify(seqs.rows, null, 2));

  // 5) Datos de TODAS las tablas
  const tables = await c.query(`
    SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const datos: Record<string, any[]> = {};
  for (const t of tables.rows) {
    const name = t.tablename;
    const r = await c.query(`SELECT * FROM "${name}"`);
    datos[name] = r.rows;
  }
  fs.writeFileSync(path.join(OUT, `datos-${stamp}.json`), JSON.stringify(datos, null, 2));

  // 6) DDL legible
  const ddl: string[] = [];
  for (const t of tables.rows) {
    const r = await c.query(`SELECT column_name, data_type, udt_name, column_default, is_nullable
                             FROM information_schema.columns
                             WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t.tablename]);
    const colsSql = r.rows.map((x: any) =>
      `  "${x.column_name}" ${x.udt_name}${x.is_nullable === "NO" ? " NOT NULL" : ""}${x.column_default ? " DEFAULT " + x.column_default : ""}`
    ).join(",\n");
    ddl.push(`CREATE TABLE public."${t.tablename}" (\n${colsSql}\n);`);
  }
  for (const fk of cons.rows.filter((x: any) => x.constraint_type === "FOREIGN KEY")) {
    ddl.push(`-- FK ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table}.id`);
  }
  fs.writeFileSync(path.join(OUT, `esquema-${stamp}.sql`), ddl.join("\n\n"));

  const resumen = tables.rows.map((t: any) => `${t.tablename}: ${datos[t.tablename].length}`).join("\n");
  fs.writeFileSync(path.join(OUT, `RESUMEN.txt`),
    `Respaldo: ${stamp}\nBase: ${url.replace(/:[^:@]*@/, ":***@")}\n\n${resumen}\n`);

  console.log(`Respaldo creado en ${OUT}`);
  console.log(resumen);
  await c.end();
}
main();