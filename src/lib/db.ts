import { Pool } from "pg";
import { ensureDatabase } from "./init-db";

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
  dbInit: Promise<void> | undefined;
};

if (!globalForPool.dbInit) {
  globalForPool.dbInit = ensureDatabase().catch((err) => {
    // Durante `next build` no hay PostgreSQL — esto es normal.
    // En runtime, las queries fallarán con su propio error de conexión.
    console.warn("⚠ DB init falló (normal durante build):", err.message ?? err);
  });
}

const dbInit = globalForPool.dbInit;

export const pool =
  globalForPool.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.pool = pool;
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

export async function transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  await dbInit;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDB(): Promise<void> {
  await dbInit;
}
