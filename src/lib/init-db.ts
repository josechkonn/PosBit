import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

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
    // - ../sql/schema.sql relativo a este archivo (standalone build)
    // - sql/schema.sql en el directorio de trabajo del standalone server
    const candidates = [
      join(process.cwd(), "sql", "schema.sql"),
      join(__dirname, "..", "..", "sql", "schema.sql"),
      join(__dirname, "..", "sql", "schema.sql"),
    ];
    const schemaPath = candidates.find((p) => {
      try { readFileSync(p, "utf-8"); return true; } catch { return false; }
    });
    if (!schemaPath) throw new Error(`schema.sql no encontrado. Buscado en: ${candidates.join(", ")}`);
    const schema = readFileSync(schemaPath, "utf-8");
    await appPool.query(schema);
    console.log("Tablas y datos iniciales verificados.");

    const { seedAdminUser } = await import("./seed-admin");
    await seedAdminUser();
  } finally {
    await appPool.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await appPool.end();
  }
}
