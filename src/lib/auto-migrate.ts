import { pool } from "./db";
import fs from "fs";
import path from "path";

let migrationPromise: Promise<void> | null = null;

export async function ensureSchemaAndMigrate(): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const client = await pool.connect();
    try {
      // 1. Verificar si existe la tabla 'ventas' (indicador de BD inicializada)
      const tableCheck = await client.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'ventas'
      `);

      if (tableCheck.rows.length === 0) {
        return;
      }

      // 2. Verificar tipo de ventas.id
      const colCheck = await client.query(`
        SELECT udt_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'ventas' AND column_name = 'id'
      `);

      const currentType = colCheck.rows[0]?.udt_name;

      if (currentType === "uuid") {
        // Ya migrado
        return;
      }

      if (currentType !== "int4") {
        console.warn(`⚠️ ventas.id tiene tipo inesperado: ${currentType}. Saltando migración.`);
        return;
      }

      // 3. Necesita migración: ejecutar script SQL
      console.log("🔄 Detectada BD con IDs integer → migrando a UUID...");

      const possiblePaths = [
        path.join(process.cwd(), "sql", "migrate-to-uuid.sql"),
        path.join((process as unknown as { resourcesPath?: string }).resourcesPath || "", "standalone", "sql", "migrate-to-uuid.sql"),
      ];

      let sqlContent = "";
      for (const p of possiblePaths) {
        if (p && fs.existsSync(p)) {
          sqlContent = fs.readFileSync(p, "utf-8");
          break;
        }
      }

      if (sqlContent) {
        await client.query(sqlContent);
        console.log("✅ Migración a UUID completada automáticamente");
      } else {
        console.error("❌ No se encontró el script sql/migrate-to-uuid.sql");
      }
    } catch (error) {
      console.error("❌ Error en migración automática:", error);
    } finally {
      client.release();
    }
  })();

  return migrationPromise;
}