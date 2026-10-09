// Migración de IDs: convierte a UUID todas las tablas de la aplicación EXCEPTO
// `productos` (que conserva su id integer) y las tablas de Better Auth (user,
// account, session, verification) que ya usan `text`.
//
// No borra ninguna fila: solo cambia el TIPO de la columna id y de las FKs que
// la apuntan, reasignando los valores con un mapa old_int -> new_uuid.
//
//   npx tsx scripts/migrar-uuid.ts --dry-run   (ejecuta y hace ROLLBACK)
import { Client } from "pg";
import * as fs from "fs";

const DRY = process.argv.includes("--dry-run");

// Tablas que conservan su id integer (productos) o ya son text (Better Auth).
const NO_CONVERTIR = new Set([
  "productos",
  "user",
  "account",
  "session",
  "verification",
]);

interface Fk {
  conname: string;
  hijo: string;
  cols: string;
  padre: string;
}

// regclass::text devuelve los nombres entrecomillados si son palabra reservada
// (p. ej. "user"). Los normalizamos a nombre plano.
const sinComillas = (s: string) => s.replace(/^"|"$/g, "").replace(/""/g, '"');

// Tablas de la aplicación sin FKs (no aparecen en el listado de FKs) que
// también pasan a UUID.
const SIN_FKS = new Set(["configuracion"]);

function tabla(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const c = new Client({ connectionString: url });
  await c.connect();

  const fksCrudo: Fk[] = JSON.parse(fs.readFileSync("/tmp/posbit-backup/cons-fk.json", "utf-8"));
  const fks: Fk[] = fksCrudo.map((f) => ({
    conname: sinComillas(f.conname),
    hijo: sinComillas(f.hijo),
    cols: sinComillas(f.cols),
    padre: sinComillas(f.padre),
  }));
  const uniquesCrudo: any[] = JSON.parse(fs.readFileSync("/tmp/posbit-backup/cons-uniq.json", "utf-8"));
  const uniques = uniquesCrudo.map((u: any) => ({
    ...u,
    conname: sinComillas(u.conname),
    tabla: sinComillas(u.tabla),
    cols: sinComillas(u.cols),
  }));

  // Tablas de la aplicación que pasan a uuid
  const aConvertir = Array.from(
    new Set(
      fks
        .map((f) => f.padre)
        .concat(fks.map((f) => f.hijo))
        .concat(Array.from(SIN_FKS))
        .filter((t) => t && !NO_CONVERTIR.has(t))
    )
  ).sort();

  // Columnas FK que hay que re-tipar. La regla depende de la tabla PADRE: una
  // columna se vuelve uuid si su padre pasó a uuid. Por eso las columnas de
  // `productos` que apuntan a monedas/categorias/... sí se re-tipan (aunque
  // productos conserve su id integer), y en cambio kardex.producto_id,
  // venta_items.producto_id, etc. siguen integer porque su padre es productos.
  const setConvertir = new Set(aConvertir);
  const fksAReTipar = fks
    .filter((f) => f.cols.indexOf(",") === -1)
    .filter((f) => setConvertir.has(f.padre) && !NO_CONVERTIR.has(f.padre));

  const fksDeProductos = fks.filter(
    (f) => f.padre === "productos" || f.hijo === "productos"
  );

  console.log(`Tablas a convertir a UUID: ${aConvertir.length}`);
  console.log(`  ${aConvertir.join(", ")}`);
  console.log(`FKs a re-tipar: ${fksAReTipar.length}`);
  console.log(`FKs de productos (quedan integer): ${fksDeProductos.length}`);
  console.log(`Modo: ${DRY ? "DRY-RUN (se hace rollback)" : "REAL"}`);
  console.log("");

  await c.query("BEGIN");

  try {
    // 1) Quitar todas las FKs
    for (const f of fks) {
      await c.query(`ALTER TABLE ${tabla(f.hijo)} DROP CONSTRAINT IF EXISTS "${f.conname}"`);
    }
    console.log(`1) FKs eliminadas: ${fks.length}`);

    // 2) Quitar unique/PK que involucren columnas que vamos a re-tipar o renombrar
    const columnasAReTipar = new Set<string>();
    for (const f of fksAReTipar) columnasAReTipar.add(`${f.hijo}.${f.cols}`);

    let uniquesEliminados = 0;
    const uniquesADropar: typeof uniques = [];
    for (const u of uniques as any[]) {
      if (u.contype !== "u") continue; // las PK se manejan aparte
      if (NO_CONVERTIR.has(u.tabla)) continue; // Better Auth: no se tocan
      const cols = (u.cols as string).split(",").map((s: string) => `${u.tabla}.${s}`);
      if (u.cols === "id" || cols.some((x) => columnasAReTipar.has(x))) {
        await c.query(`ALTER TABLE ${tabla(u.tabla)} DROP CONSTRAINT IF EXISTS "${u.conname}"`);
        uniquesADropar.push(u);
        uniquesEliminados++;
      }
    }
    console.log(`2) Restricciones unique/PK eliminadas: ${uniquesEliminados}`);

    // 3) Convertir tabla por tabla
    for (const t of aConvertir) {
      // Columna nueva con UUID generado
      await c.query(
        `ALTER TABLE ${tabla(t)} ADD COLUMN IF NOT EXISTS "id__uuid" uuid DEFAULT gen_random_uuid()`
      );
      await c.query(`UPDATE ${tabla(t)} SET "id__uuid" = gen_random_uuid() WHERE "id__uuid" IS NULL`);

      // Mapa old -> new en tabla temporal
      await c.query(`DROP TABLE IF EXISTS "map_${t}"`);
      await c.query(`CREATE TEMP TABLE "map_${t}" AS SELECT "id"::int AS old_id, "id__uuid" AS new_id FROM ${tabla(t)}`);

      // Re-tipar las columnas FK que apuntan a esta tabla
      for (const f of fksAReTipar.filter((x) => x.padre === t)) {
        await c.query(
          `ALTER TABLE ${tabla(f.hijo)} ADD COLUMN IF NOT EXISTS "${f.cols}__uuid" uuid`
        );
        await c.query(
          `UPDATE ${tabla(f.hijo)} c SET "${f.cols}__uuid" = m.new_id
             FROM "map_${t}" m WHERE c."${f.cols}" = m.old_id`
        );
        await c.query(`ALTER TABLE ${tabla(f.hijo)} DROP COLUMN "${f.cols}"`);
        await c.query(
          `ALTER TABLE ${tabla(f.hijo)} RENAME COLUMN "${f.cols}__uuid" TO "${f.cols}"`
        );
      }

      // Reemplazar la PK (se elimina explícitamente antes de quitar la columna)
      await c.query(`ALTER TABLE ${tabla(t)} DROP CONSTRAINT IF EXISTS "${t}_pkey"`);
      await c.query(`ALTER TABLE ${tabla(t)} DROP COLUMN "id"`);
      await c.query(`ALTER TABLE ${tabla(t)} RENAME COLUMN "id__uuid" TO "id"`);
      await c.query(`ALTER TABLE ${tabla(t)} ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
      await c.query(`ALTER TABLE ${tabla(t)} ALTER COLUMN "id" SET NOT NULL`);
      await c.query(
        `ALTER TABLE ${tabla(t)} ADD CONSTRAINT "${t}_pkey" PRIMARY KEY ("id")`
      );

      await c.query(`DROP TABLE IF EXISTS "map_${t}"`);
    }
    console.log(`3) Tablas convertidas: ${aConvertir.length}`);

    // 4) Recrear las FKs (solo las de tablas convertidas)
    let creadas = 0;
    for (const f of fks) {
      if (NO_CONVERTIR.has(f.padre) && NO_CONVERTIR.has(f.hijo)) continue;
      if (f.cols.indexOf(",") !== -1) {
        throw new Error(`FK compuesta no soportada: ${f.conname}`);
      }
      await c.query(
        `ALTER TABLE ${tabla(f.hijo)} ADD CONSTRAINT "${f.conname}"
           FOREIGN KEY ("${f.cols}") REFERENCES ${tabla(f.padre)}("id") ON DELETE CASCADE`
      );
      creadas++;
    }
    console.log(`4) FKs recreadas: ${creadas}`);

    // 5) Recrear SOLO los uniques que se eliminaron en el paso 2
    let uq = 0;
    for (const u of uniquesADropar) {
      const cols = (u.cols as string).split(",").map((s: string) => `"${s}"`).join(", ");
      await c.query(
        `ALTER TABLE ${tabla(u.tabla)} ADD CONSTRAINT "${u.conname}" UNIQUE (${cols})`
      );
      uq++;
    }
    console.log(`5) Uniques recreados: ${uq}`);

    // 6) Verificación dentro de la transacción
    const check = await c.query(`
      SELECT COUNT(*)::int AS rotos FROM ventas v
      LEFT JOIN clientes c ON v."cliente_id" = c."id"
      WHERE v."cliente_id" IS NOT NULL AND c."id" IS NULL`);
    console.log(`6) Ventas con cliente huérfano: ${check.rows[0].rotos}`);
    if (check.rows[0].rotos > 0) throw new Error("Hay referencias rotas; se hace rollback");

    if (DRY) {
      await c.query("ROLLBACK");
      console.log("\n✅ DRY-RUN OK — se hizo ROLLBACK, nada cambió.");
    } else {
      await c.query("COMMIT");
      console.log("\n✅ MIGRACIÓN APLICADA.");
    }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n❌ Error (rollback aplicado):", e.message);
    process.exitCode = 1;
  }

  await c.end();
}
main();