import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

function getDbName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida");
  const pathname = new URL(url).pathname;
  return decodeURIComponent(pathname.replace(/^\//, ""));
}

function getAdminUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  return `postgresql://${url.username}:${url.password}@${url.hostname}${url.port ? `:${url.port}` : ""}/postgres`;
}

const LOCK_ID = 42;

export async function ensureDatabase(): Promise<void> {
  const dbName = getDbName();

  const adminPool = new Pool({ connectionString: getAdminUrl(), max: 1 });

  try {
    const { rowCount } = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (rowCount === 0) {
      console.log(`Creando base de datos "${dbName}"...`);
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Base de datos "${dbName}" creada.`);
    }
  } finally {
    await adminPool.end();
  }

  const appPool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });

  try {
    await appPool.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);

    // Buscar schema.sql en múltiples ubicaciones:
    // - process.cwd()/sql/schema.sql (desarrollo con next dev)
    // - process.resourcesPath/standalone/sql/schema.sql (Electron empaquetado)
    // - ../sql/schema.sql relativo a este archivo (standalone build)
    // - sql/schema.sql en el directorio de trabajo del standalone server
    const currentDir =
      typeof __dirname !== "undefined"
        ? __dirname
        : typeof import.meta?.url !== "undefined"
          ? dirname(fileURLToPath(import.meta.url))
          : process.cwd();

    const candidates = [
      join(process.cwd(), "sql", "schema.sql"),
      (process as unknown as { resourcesPath?: string }).resourcesPath
        ? join((process as unknown as { resourcesPath?: string }).resourcesPath!, "standalone", "sql", "schema.sql")
        : "",
      join(process.cwd(), "standalone", "sql", "schema.sql"),
      join(currentDir, "..", "..", "sql", "schema.sql"),
      join(currentDir, "..", "sql", "schema.sql"),
    ].filter(Boolean);

    const schemaPath = candidates.find((p) => {
      try { readFileSync(p, "utf-8"); return true; } catch { return false; }
    });
    if (!schemaPath) throw new Error(`schema.sql no encontrado. Buscado en: ${candidates.join(", ")}`);

    // 1. Ejecutar migraciones automáticas previas si la base de datos ya contiene datos
    const { ensureSchemaAndMigrate } = await import("./auto-migrate");
    try {
      await ensureSchemaAndMigrate(appPool);
    } catch (migErr: any) {
      console.warn("Aviso en pre-migración automática:", migErr?.message || migErr);
    }

    // 2. Aplicar/verificar esquema base
    const schema = readFileSync(schemaPath, "utf-8");
    try {
      await appPool.query(schema);
      console.log("Tablas y datos iniciales verificados.");
    } catch (schemaErr: any) {
      console.warn("Aviso al aplicar schema.sql (continuando con migraciones incrementales):", schemaErr?.message || schemaErr);
    }

    // 3. SQL migraciones incrementales: se ejecutan en orden e idénticamente en dev y Electron
    const extraSqlFiles = [
      { file: "global-config-pricing.sql", desc: "Reglas globales de costeo/pricing" },
      { file: "producto-proveedores.sql", desc: "Relación producto-proveedor" },
      { file: "presentaciones-precio.sql", desc: "Presentaciones con precio propio" },
      { file: "presentaciones-codigo.sql", desc: "Códigos de barra de presentaciones" },
      { file: "ventas-cobros-extra.sql", desc: "Cobros extra en ventas" },
      { file: "compras-descuentos.sql", desc: "Descuentos en compras" },
      { file: "compras-abonos.sql", desc: "Sistema de abonos y deudas de compras" },
    ];

    const sqlDir = dirname(schemaPath);
    for (const { file, desc } of extraSqlFiles) {
      try {
        const filePath = join(/*turbopackIgnore: true*/ sqlDir, file);
        if (existsSync(/*turbopackIgnore: true*/ filePath)) {
          const extra = readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8");
          await appPool.query(extra);
          console.log(`${desc} verificadas.`);
        }
      } catch (err: any) {
        console.warn(`Aviso al aplicar ${file}:`, err?.message ?? err);
      }
    }

    // 4. Semilla de usuario administrador
    const { seedAdminUser } = await import("./seed-admin");
    await seedAdminUser();

    // 5. Garantía final de auto-migración y auto-reparación
    await ensureSchemaAndMigrate(appPool);
  } finally {
    await appPool.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await appPool.end();
  }
}
