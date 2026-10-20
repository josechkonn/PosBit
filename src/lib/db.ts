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

export async function transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  await dbInit;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
