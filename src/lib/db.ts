import { Pool } from "pg";
import { ensureDatabase } from "./init-db";

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
  dbInit: Promise<void> | undefined;
};

export const pool =
  globalForPool.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

// Reutilizar el pool tanto en desarrollo como en producción (Vercel serverless warm instances)
globalForPool.pool = pool;

if (!globalForPool.dbInit) {
  globalForPool.dbInit = ensureDatabase(pool).catch((err) => {
    // Durante `next build` sin PostgreSQL disponible esto es normal.
    console.warn("⚠ DB init falló (normal durante build):", err.message ?? err);
  });
}

const dbInit = globalForPool.dbInit;

export function waitForDB(): Promise<void> {
  return dbInit;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  await dbInit;
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  await dbInit;
  const result = await pool.query(text, params);
  return (result.rows[0] as T) ?? null;
}

export async function execute(text: string, params?: any[]): Promise<void> {
  await dbInit;
  await pool.query(text, params);
}

export async function syncAllSerialSequences(runner?: any): Promise<void> {
  const db = runner ?? pool;
  try {
    await db.query(`
      DO $$
      DECLARE
        rec record;
        max_id bigint;
      BEGIN
        FOR rec IN
          SELECT c.table_name,
                 c.column_name,
                 pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS seq_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_name = 'id'
            AND c.data_type IN ('integer', 'bigint', 'smallint')
            AND pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) IS NOT NULL
        LOOP
          EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I', rec.column_name, rec.table_name) INTO max_id;
          IF max_id > 0 THEN
            PERFORM setval(rec.seq_name, max_id, true);
          ELSE
            PERFORM setval(rec.seq_name, 1, false);
          END IF;
        END LOOP;
      END $$;
    `);
  } catch (err) {
    console.warn("[syncAllSerialSequences] Aviso al sincronizar secuencias:", (err as Error)?.message ?? err);
  }
}

const TABLAS_NUMERO_PERMITIDAS = new Set(["ventas", "creditos", "compras", "retornos"]);

/**
 * Genera un número de documento (`VTA-2026-XXXX`, `CRE-2026-XXXX`, `OC-2026-XXXX`, `RET-2026-XXXX`)
 * verificando contra la base de datos que no exista previamente para evitar errores
 * `duplicate key value violates unique constraint "..._numero_key"`.
 */
export async function generarNumeroUnico(
  runner: any,
  tabla: "ventas" | "creditos" | "compras" | "retornos",
  prefijo: string
): Promise<string> {
  if (!TABLAS_NUMERO_PERMITIDAS.has(tabla)) {
    throw new Error(`Tabla no permitida para generarNumeroUnico: ${tabla}`);
  }
  const db = runner ?? pool;
  const year = new Date().getFullYear();

  // Intentar primero con 4 dígitos (1000..9999) y luego ampliar a 5-6 dígitos si hay alta densidad
  for (let attempt = 0; attempt < 15; attempt++) {
    const random =
      attempt < 8
        ? Math.floor(Math.random() * 9000) + 1000
        : Math.floor(Math.random() * 900000) + 100000;
    const candidate = `${prefijo}-${year}-${random}`;
    const res = await db.query(`SELECT 1 FROM "${tabla}" WHERE numero = $1 LIMIT 1`, [candidate]);
    if (res.rows.length === 0) {
      return candidate;
    }
  }

  // Fallback infalible con sufijo de tiempo + aleatorio
  const tsSuffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  return `${prefijo}-${year}-${tsSuffix}`;
}

export async function transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  await dbInit;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});

    // Auto-recuperación ante colisión de secuencia serial (_pkey) o número correlativo (_numero_key)
    const isDuplicateKey =
      e?.code === "23505" ||
      (typeof e?.message === "string" && e.message.toLowerCase().includes("duplicate key"));
    const constraintName = String(e?.constraint || e?.message || "");
    const isRecoverableConstraint =
      isDuplicateKey &&
      (constraintName.includes("_pkey") || constraintName.includes("_numero_key"));

    if (isRecoverableConstraint) {
      console.warn(
        `[DB Transaction] Detectada colisión (${constraintName}). Sincronizando secuencias y reintentando transacción...`
      );
      await syncAllSerialSequences(client);
      try {
        await client.query("BEGIN");
        const retryResult = await fn(client);
        await client.query("COMMIT");
        return retryResult;
      } catch (retryErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw retryErr;
      }
    }

    throw e;
  } finally {
    client.release();
  }
}

/**
 * Registra una eliminación en `sync_eliminados` para que el motor de sincronización
 * y los dispositivos remotos (PC local, Móvil) sepan que el registro fue borrado
 * intencionalmente y no lo resuciten con datos antiguos.
 */
export async function registrarEliminacionSync(
  tabla: string,
  registroId: string | number,
  client?: any
): Promise<void> {
  try {
    const runner = client ?? pool;
    await runner.query(
      `INSERT INTO sync_eliminados (tabla, registro_id, eliminado_en)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tabla, registro_id) DO UPDATE SET eliminado_en = EXCLUDED.eliminado_en`,
      [tabla, String(registroId)]
    );
  } catch (err) {
    console.warn(`[registrarEliminacionSync] No se pudo registrar eliminación de ${tabla} (${registroId}):`, err);
  }
}
