import { Pool, PoolClient } from "pg";
import { pool, query, queryOne, transaction } from "./db";

export interface SyncConfig {
  id: number;
  dispositivo_id: string;
  nombre_dispositivo: string;
  modo_conexion: "desactivado" | "api_nube" | "db_directa";
  cloud_url: string | null;
  cloud_api_key: string | null;
  cloud_database_url: string | null;
  auto_sync: boolean;
  intervalo_segundos: number;
  ultima_sincronizacion_push: string | null;
  ultima_sincronizacion_pull: string | null;
  ultimo_estado: string;
  ultimo_error: string | null;
  actualizado_en: string;
  es_nube_central?: boolean;
}

export interface SyncTombstone {
  tabla: string;
  registro_id: string;
  eliminado_en: string;
}

export interface SyncNaturalRefs {
  monedas?: Array<{ id: any; codigo: string }>;
  cajas?: Array<{ id: any; nombre: string }>;
  categorias?: Array<{ id: any; nombre: string }>;
  marcas?: Array<{ id: any; nombre: string }>;
  proveedores?: Array<{ id: any; nombre: string }>;
  productos?: Array<{ id: any; codigo: string }>;
  metodos_pago?: Array<{ id: any; nombre: string; caja_id: any }>;
}

export interface SyncDeltaPayload {
  dispositivo_id: string;
  nombre_dispositivo?: string;
  desde: string | null;
  hasta: string;
  es_completa?: boolean;
  tables: Record<string, any[]>;
  eliminados: SyncTombstone[];
  refs?: SyncNaturalRefs;
}

export interface SyncResult {
  ok: boolean;
  direccion: "bidireccional" | "push" | "pull" | "entrante";
  registros_subidos: number;
  registros_bajados: number;
  eliminados_aplicados: number;
  duracion_ms: number;
  fecha: string;
  mensaje: string;
  error?: string;
}

/**
 * Orden topológico estricto de tablas para respetar llaves foráneas (padres antes que hijos).
 */
export const SYNC_TABLES_ORDER = [
  "configuracion",
  "configuracion_global",
  "monedas",
  "cajas",
  "metodos_pago",
  "categorias",
  "marcas",
  "proveedores",
  "clientes",
  "cliente_limites_credito",
  "productos",
  "producto_proveedores",
  "producto_presentaciones",
  "producto_precios",
  "producto_costos_historicos",
  "compras",
  "compra_items",
  "compra_abonos",
  "ventas",
  "venta_items",
  "venta_pagos",
  "venta_cobros_extra",
  "creditos",
  "abonos",
  "retornos",
  "retorno_items",
  "cierres_caja",
  "transacciones",
  "kardex",
] as const;

export const MOBILE_SYNC_TABLES = [
  "configuracion_global",
  "monedas",
  "cajas",
  "metodos_pago",
  "categorias",
  "marcas",
  "clientes",
  "cliente_limites_credito",
  "productos",
  "producto_presentaciones",
  "ventas",
  "venta_items",
  "creditos",
  "abonos",
] as const;

export type SyncTableName = (typeof SYNC_TABLES_ORDER)[number];

/**
 * Detecta si esta instancia de PosBit es el Servidor Central en la Nube (Vercel / Supabase directo)
 * o una instalación local de Escritorio (Electron / PostgreSQL local en localhost).
 */
export function isCloudServerEnvironment(): boolean {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    return true;
  }
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return false;
    const host = new URL(dbUrl).hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

/**
 * Asegura que las tablas e índices de sincronización existan.
 * Se ejecuta una sola vez por proceso en caliente.
 */
const globalForSync = globalThis as unknown as {
  syncTablesVerified?: boolean;
  syncRunning?: boolean;
  bgSyncTimeout?: ReturnType<typeof setTimeout> | null;
};

export async function ensureSyncTables(customClient?: Pool | PoolClient): Promise<void> {
  if (globalForSync.syncTablesVerified && !customClient) return;
  const db = customClient ?? pool;
  await db.query(`
    CREATE TABLE IF NOT EXISTS sync_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dispositivo_id UUID NOT NULL DEFAULT gen_random_uuid(),
      nombre_dispositivo VARCHAR(100) NOT NULL DEFAULT 'Caja Principal',
      modo_conexion VARCHAR(20) NOT NULL DEFAULT 'desactivado',
      cloud_url TEXT,
      cloud_api_key TEXT,
      cloud_database_url TEXT,
      auto_sync BOOLEAN NOT NULL DEFAULT true,
      intervalo_segundos INTEGER NOT NULL DEFAULT 30,
      ultima_sincronizacion_push TIMESTAMPTZ,
      ultima_sincronizacion_pull TIMESTAMPTZ,
      ultimo_estado VARCHAR(30) NOT NULL DEFAULT 'sin_configurar',
      ultimo_error TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO sync_config (id, nombre_dispositivo, modo_conexion, auto_sync, intervalo_segundos, ultimo_estado)
    VALUES (1, 'Caja Principal', 'desactivado', true, 30, 'sin_configurar')
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS sync_eliminados (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tabla VARCHAR(100) NOT NULL,
      registro_id TEXT NOT NULL,
      eliminado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tabla, registro_id)
    );

    CREATE TABLE IF NOT EXISTS sync_historial (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      direccion VARCHAR(20) NOT NULL,
      registros_subidos INTEGER NOT NULL DEFAULT 0,
      registros_bajados INTEGER NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL,
      detalle TEXT,
      duracion_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sync_eliminados_fecha ON sync_eliminados(eliminado_en);
    CREATE INDEX IF NOT EXISTS idx_sync_historial_fecha ON sync_historial(fecha DESC);
    CREATE INDEX IF NOT EXISTS idx_productos_actualizado_en ON productos(actualizado_en);
    CREATE INDEX IF NOT EXISTS idx_ventas_actualizado_en ON ventas(actualizado_en);
    CREATE INDEX IF NOT EXISTS idx_compras_actualizado_en ON compras(actualizado_en);
    CREATE INDEX IF NOT EXISTS idx_clientes_actualizado_en ON clientes(actualizado_en);
    CREATE INDEX IF NOT EXISTS idx_ventas_estado_moneda_fecha ON ventas(estado, moneda_id, fecha DESC);
    CREATE INDEX IF NOT EXISTS idx_compras_estado_moneda_fecha ON compras(estado, moneda_id, fecha DESC);
    CREATE INDEX IF NOT EXISTS idx_productos_activo_stock ON productos(activo, stock, stock_minimo);
  `);
  if (!customClient) globalForSync.syncTablesVerified = true;
}

/**
 * Obtiene la configuración actual de sincronización (y variables de entorno de respaldo).
 */
export async function getSyncConfig(): Promise<SyncConfig> {
  await ensureSyncTables();
  const row = await queryOne<SyncConfig>("SELECT * FROM sync_config WHERE id = 1");
  const envCloudUrl = process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL || null;
  const envCloudDbUrl = process.env.CLOUD_DATABASE_URL || null;
  const envCloudKey = process.env.CLOUD_SYNC_SECRET || process.env.CLOUD_API_KEY || null;
  const esNubeCentral = isCloudServerEnvironment();

  if (!row) {
    return {
      id: 1,
      dispositivo_id: "00000000-0000-0000-0000-000000000001",
      nombre_dispositivo: esNubeCentral ? "Servidor PosBit Cloud" : "Caja Principal",
      modo_conexion: envCloudDbUrl ? "db_directa" : envCloudUrl ? "api_nube" : "desactivado",
      cloud_url: envCloudUrl,
      cloud_api_key: envCloudKey,
      cloud_database_url: envCloudDbUrl,
      auto_sync: true,
      intervalo_segundos: 30,
      ultima_sincronizacion_push: null,
      ultima_sincronizacion_pull: null,
      ultimo_estado: esNubeCentral ? "ok" : "sin_configurar",
      ultimo_error: null,
      actualizado_en: new Date().toISOString(),
      es_nube_central: esNubeCentral,
    };
  }

  return {
    ...row,
    cloud_url: row.cloud_url || envCloudUrl,
    cloud_api_key: row.cloud_api_key || envCloudKey,
    cloud_database_url: row.cloud_database_url || envCloudDbUrl,
    es_nube_central: esNubeCentral,
  };
}

/**
 * Cuenta cuántos cambios locales están pendientes de subir a la nube en UNA SOLA consulta SQL.
 * En el Servidor Nube Central (con modo_conexion = desactivado), los datos ya están en la nube (0 pendientes).
 */
export async function countPendingLocalChanges(
  sinceIso: string | null,
  modoConexion?: string
): Promise<{
  totalPendientes: number;
  porTabla: Record<string, number>;
}> {
  if (isCloudServerEnvironment() && (!modoConexion || modoConexion === "desactivado")) {
    return { totalPendientes: 0, porTabla: {} };
  }

  await ensureSyncTables();
  const tablasPrincipales: SyncTableName[] = [
    "ventas",
    "compras",
    "productos",
    "clientes",
    "creditos",
    "abonos",
    "retornos",
    "cierres_caja",
    "transacciones",
  ];

  const porTabla: Record<string, number> = {};
  let totalPendientes = 0;

  try {
    if (sinceIso) {
      const subqueries = tablasPrincipales.map(
        (t) => `(SELECT COUNT(*)::int FROM "${t}" WHERE actualizado_en > $1) AS "${t}"`
      );
      subqueries.push(
        `(SELECT COUNT(*)::int FROM sync_eliminados WHERE eliminado_en > $1) AS "eliminados"`
      );
      const row = await queryOne<Record<string, number>>(
        `SELECT ${subqueries.join(", ")}`,
        [sinceIso]
      );
      if (row) {
        for (const [k, v] of Object.entries(row)) {
          const n = Number(v || 0);
          if (n > 0) {
            porTabla[k] = n;
            totalPendientes += n;
          }
        }
      }
    } else {
      // Si aún no ha hecho el primer push y la sincronización está desactivada en local, devolver 0 rápido
      if (modoConexion === "desactivado") {
        return { totalPendientes: 0, porTabla: {} };
      }
      const subqueries = tablasPrincipales.map(
        (t) => `(SELECT COUNT(*)::int FROM "${t}") AS "${t}"`
      );
      const row = await queryOne<Record<string, number>>(`SELECT ${subqueries.join(", ")}`);
      if (row) {
        for (const [k, v] of Object.entries(row)) {
          const n = Number(v || 0);
          if (n > 0) {
            porTabla[k] = n;
            totalPendientes += n;
          }
        }
      }
    }
  } catch {
    // Fallback silencioso si alguna tabla aún no tiene actualizado_en
  }

  return { totalPendientes, porTabla };
}

/**
 * Extrae el delta de cambios desde `since` (o todos los registros si `since` es null).
 * Optimizado con detección rápida en 1 sola consulta cuando `since` está presente:
 * si ninguna tabla cambió (95% de los polls periódicos), hace 1 consulta en ~2ms en vez de 30.
 */
export async function collectDeltaFromDb(
  targetPool: Pool | PoolClient,
  since: string | null,
  dispositivoId = "server",
  options?: { mode?: "full" | "mobile" }
): Promise<SyncDeltaPayload> {
  const hasta = new Date().toISOString();
  const tables: Record<string, any[]> = {};
  const tableList: readonly string[] =
    options?.mode === "mobile" ? MOBILE_SYNC_TABLES : SYNC_TABLES_ORDER;

  let tablesToFetch: string[] = [...tableList];
  let fetchDeletions = true;

  // Fast-path para sincronizaciones incrementales: 1 sola consulta SQL descubre qué tablas tienen cambios
  if (since) {
    try {
      const checks = tableList.map(
        (t) => `CASE WHEN EXISTS (SELECT 1 FROM "${t}" WHERE actualizado_en > $1) THEN '${t}' END`
      );
      const fastSql = `
        SELECT
          EXISTS (SELECT 1 FROM sync_eliminados WHERE eliminado_en > $1) AS has_del,
          ARRAY_REMOVE(ARRAY[${checks.join(", ")}], NULL) AS changed
      `;
      const fastRes = await targetPool.query(fastSql, [since]);
      const fastRow = fastRes.rows[0];
      if (fastRow) {
        tablesToFetch = Array.isArray(fastRow.changed) ? fastRow.changed : [];
        fetchDeletions = Boolean(fastRow.has_del);
      }
    } catch {
      // Si alguna tabla antigua no tuviera actualizado_en, caer al escaneo normal
      tablesToFetch = [...tableList];
      fetchDeletions = true;
    }
  }

  // Consultar únicamente las tablas que realmente cambiaron
  if (tablesToFetch.length > 0) {
    for (const table of tablesToFetch) {
      try {
        const res = since
          ? await targetPool.query(`SELECT * FROM "${table}" WHERE actualizado_en > $1`, [since])
          : await targetPool.query(`SELECT * FROM "${table}"`);
        if (res.rows.length > 0) {
          tables[table] = res.rows;
        }
      } catch {
        if (!since) {
          try {
            const res = await targetPool.query(`SELECT * FROM "${table}"`);
            if (res.rows.length > 0) tables[table] = res.rows;
          } catch {
            // Tabla no existe
          }
        }
      }
    }
  }

  let eliminados: SyncTombstone[] = [];
  if (fetchDeletions) {
    try {
      const delRes = since
        ? await targetPool.query(
            `SELECT tabla, registro_id, eliminado_en FROM sync_eliminados WHERE eliminado_en > $1`,
            [since]
          )
        : await targetPool.query(`SELECT tabla, registro_id, eliminado_en FROM sync_eliminados`);
      eliminados = delRes.rows;
    } catch {
      eliminados = [];
    }
  }

  // Si hay tablas hijas en un delta incremental, adjuntar el diccionario ligero de llaves naturales
  // (`refs`) para que el receptor siempre traduzca moneda_id, caja_id, metodo_pago_id, categoria_id, etc.
  let refs: SyncNaturalRefs | undefined;
  const hasAnyTableRows = Object.keys(tables).length > 0;
  if (hasAnyTableRows && options?.mode !== "mobile") {
    try {
      const [mRes, cRes, mpRes, catRes, marRes, provRes, prodRes] = await Promise.all([
        targetPool.query(`SELECT id, codigo FROM monedas`),
        targetPool.query(`SELECT id, nombre FROM cajas`),
        targetPool.query(`SELECT id, nombre, caja_id FROM metodos_pago`),
        targetPool.query(`SELECT id, nombre FROM categorias`),
        targetPool.query(`SELECT id, nombre FROM marcas`),
        targetPool.query(`SELECT id, nombre FROM proveedores`),
        targetPool.query(`SELECT id, codigo FROM productos`),
      ]);
      refs = {
        monedas: mRes.rows,
        cajas: cRes.rows,
        metodos_pago: mpRes.rows,
        categorias: catRes.rows,
        marcas: marRes.rows,
        proveedores: provRes.rows,
        productos: prodRes.rows,
      };
    } catch {
      // Ignorar si falla lectura de refs
    }
  }

  return {
    dispositivo_id: dispositivoId,
    desde: since,
    hasta,
    es_completa: !since,
    tables,
    eliminados,
    refs,
  };
}

/**
 * Aplica un payload de sincronización (delta o completo) sobre la base de datos destino (`client`),
 * reconciliando llaves naturales tanto en sincronizaciones completas como incrementales (`refs`),
 * resolviendo colisiones de numeración (`VTA-`, `OC-`, `CRE-`, `RET-`) y usando Last-Write-Wins (`actualizado_en`).
 */
export async function applyDeltaToDb(
  client: PoolClient,
  payload: SyncDeltaPayload
): Promise<{ appliedRows: number; deletedRows: number }> {
  const hasTableRows =
    payload.tables &&
    Object.values(payload.tables).some((arr) => Array.isArray(arr) && arr.length > 0);
  const hasDeletions = Array.isArray(payload.eliminados) && payload.eliminados.length > 0;

  // Fast-path: si el delta viene vacío, no ejecutar consultas de metadatos ni bloqueos
  if (!hasTableRows && !hasDeletions) {
    return { appliedRows: 0, deletedRows: 0 };
  }

  let appliedRows = 0;
  let deletedRows = 0;

  const monedaIdMap = new Map<string, any>();
  const cajaIdMap = new Map<string, any>();
  const metodoPagoIdMap = new Map<string, any>();
  const categoriaIdMap = new Map<string, any>();
  const marcaIdMap = new Map<string, any>();
  const proveedorIdMap = new Map<string, any>();
  const productoIdMap = new Map<string, any>();

  await client.query("SET LOCAL posbit.skip_tombstone = 'true'");

  let replicaEnabled = false;
  try {
    await client.query("SET LOCAL session_replication_role = 'replica'");
    replicaEnabled = true;
  } catch {
    // En servicios cloud administrados (Supabase / Neon) sin superuser no hay replica role
  }

  try {
    const allColsRes = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
    );
    const colsByTable = new Map<string, Set<string>>();
    for (const r of allColsRes.rows) {
      let set = colsByTable.get(r.table_name);
      if (!set) {
        set = new Set<string>();
        colsByTable.set(r.table_name, set);
      }
      set.add(r.column_name);
    }

    const [
      existingMonedas,
      existingCajas,
      existingCats,
      existingMarcas,
      existingProvs,
      existingProds,
      existingMps,
      existingCfgs,
      existingPps,
      existingClcs,
      existingPres,
      existingVentasNum,
      existingComprasNum,
      existingCreditosNum,
      existingRetornosNum,
    ] = await Promise.all([
      client.query(`SELECT id, codigo FROM monedas`),
      client.query(`SELECT id, nombre FROM cajas`),
      client.query(`SELECT id, nombre FROM categorias`),
      client.query(`SELECT id, nombre FROM marcas`),
      client.query(`SELECT id, nombre FROM proveedores`),
      client.query(`SELECT id, codigo FROM productos`),
      client.query(`SELECT id, nombre, caja_id FROM metodos_pago`),
      client.query(`SELECT id, clave FROM configuracion`),
      client.query(`SELECT id, producto_id, moneda_id FROM producto_precios`),
      client.query(`SELECT id, cliente_id, moneda_id FROM cliente_limites_credito`),
      client.query(`SELECT id, producto_id, nombre, codigo FROM producto_presentaciones`),
      payload.tables?.ventas?.length
        ? client.query(`SELECT id, numero FROM ventas`)
        : Promise.resolve({ rows: [] }),
      payload.tables?.compras?.length
        ? client.query(`SELECT id, numero FROM compras`)
        : Promise.resolve({ rows: [] }),
      payload.tables?.creditos?.length
        ? client.query(`SELECT id, numero FROM creditos`)
        : Promise.resolve({ rows: [] }),
      payload.tables?.retornos?.length
        ? client.query(`SELECT id, numero FROM retornos`)
        : Promise.resolve({ rows: [] }),
    ]);

    const monedaByCodigo = new Map<string, any>(
      existingMonedas.rows.map((r: any) => [String(r.codigo).toUpperCase().trim(), r.id])
    );
    const cajaByNombre = new Map<string, any>(
      existingCajas.rows.map((r: any) => [String(r.nombre).toLowerCase().trim(), r.id])
    );
    const catByNombre = new Map<string, any>(
      existingCats.rows.map((r: any) => [String(r.nombre).toLowerCase().trim(), r.id])
    );
    const marcaByNombre = new Map<string, any>(
      existingMarcas.rows.map((r: any) => [String(r.nombre).toLowerCase().trim(), r.id])
    );
    const provByNombre = new Map<string, any>(
      existingProvs.rows.map((r: any) => [String(r.nombre).toLowerCase().trim(), r.id])
    );
    const prodByCodigo = new Map<string, any>(
      existingProds.rows.map((r: any) => [String(r.codigo).toLowerCase().trim(), r.id])
    );
    const mpByKey = new Map<string, any>(
      existingMps.rows.map((r: any) => [
        `${String(r.nombre).toLowerCase().trim()}::${r.caja_id ? String(r.caja_id) : ""}`,
        r.id,
      ])
    );
    const cfgByClave = new Map<string, any>(
      existingCfgs.rows.map((r: any) => [String(r.clave), r.id])
    );
    const ppByKey = new Map<string, any>(
      existingPps.rows.map((r: any) => [`${r.producto_id}::${r.moneda_id}`, r.id])
    );
    const clcByKey = new Map<string, any>(
      existingClcs.rows.map((r: any) => [`${r.cliente_id}::${r.moneda_id}`, r.id])
    );
    const presByKey = new Map<string, any>(
      existingPres.rows.map((r: any) => [
        `${r.producto_id}::${String(r.nombre).toLowerCase().trim()}`,
        r.id,
      ])
    );
    const presByCodigo = new Map<string, any>(
      existingPres.rows
        .filter((r: any) => r.codigo)
        .map((r: any) => [String(r.codigo).toLowerCase().trim(), r.id])
    );

    const ventasByNum = new Map<string, any>(
      existingVentasNum.rows.map((r: any) => [String(r.numero), String(r.id)])
    );
    const comprasByNum = new Map<string, any>(
      existingComprasNum.rows.map((r: any) => [String(r.numero), String(r.id)])
    );
    const creditosByNum = new Map<string, any>(
      existingCreditosNum.rows.map((r: any) => [String(r.numero), String(r.id)])
    );
    const retornosByNum = new Map<string, any>(
      existingRetornosNum.rows.map((r: any) => [String(r.numero), String(r.id)])
    );

    // Pre-poblar mapas de traducción de FKs usando `payload.refs` (vital en deltas incrementales)
    if (payload.refs) {
      for (const m of payload.refs.monedas || []) {
        const localId = monedaByCodigo.get(String(m.codigo).toUpperCase().trim());
        if (localId !== undefined && String(localId) !== String(m.id)) {
          monedaIdMap.set(String(m.id), localId);
        }
      }
      for (const c of payload.refs.cajas || []) {
        const localId = cajaByNombre.get(String(c.nombre).toLowerCase().trim());
        if (localId !== undefined && String(localId) !== String(c.id)) {
          cajaIdMap.set(String(c.id), localId);
        }
      }
      for (const cat of payload.refs.categorias || []) {
        const localId = catByNombre.get(String(cat.nombre).toLowerCase().trim());
        if (localId !== undefined && String(localId) !== String(cat.id)) {
          categoriaIdMap.set(String(cat.id), localId);
        }
      }
      for (const mar of payload.refs.marcas || []) {
        const localId = marcaByNombre.get(String(mar.nombre).toLowerCase().trim());
        if (localId !== undefined && String(localId) !== String(mar.id)) {
          marcaIdMap.set(String(mar.id), localId);
        }
      }
      for (const prov of payload.refs.proveedores || []) {
        const localId = provByNombre.get(String(prov.nombre).toLowerCase().trim());
        if (localId !== undefined && String(localId) !== String(prov.id)) {
          proveedorIdMap.set(String(prov.id), localId);
        }
      }
      for (const prod of payload.refs.productos || []) {
        const localId = prodByCodigo.get(String(prod.codigo).toLowerCase().trim());
        if (localId !== undefined && String(localId) !== String(prod.id)) {
          productoIdMap.set(String(prod.id), localId);
        }
      }
      for (const mp of payload.refs.metodos_pago || []) {
        const mappedCajaId =
          mp.caja_id && cajaIdMap.has(String(mp.caja_id))
            ? cajaIdMap.get(String(mp.caja_id))
            : mp.caja_id;
        const key = `${String(mp.nombre).toLowerCase().trim()}::${mappedCajaId ? String(mappedCajaId) : ""}`;
        const localId = mpByKey.get(key);
        if (localId !== undefined && String(localId) !== String(mp.id)) {
          metodoPagoIdMap.set(String(mp.id), localId);
        }
      }
    }

    const translateForeignKeys = (row: Record<string, any>): Record<string, any> => {
      const r = { ...row };
      const mapFk = (field: string, map: Map<string, any>) => {
        if (r[field] !== null && r[field] !== undefined) {
          const mapped = map.get(String(r[field]));
          if (mapped !== undefined) r[field] = mapped;
        }
      };

      mapFk("moneda_id", monedaIdMap);
      mapFk("moneda_base_id", monedaIdMap);
      mapFk("moneda_costo_id", monedaIdMap);
      mapFk("tasa_ref_moneda_id", monedaIdMap);
      mapFk("moneda_transito_compras_id", monedaIdMap);
      mapFk("moneda_transito_ventas_id", monedaIdMap);
      mapFk("caja_id", cajaIdMap);
      mapFk("metodo_pago_id", metodoPagoIdMap);
      mapFk("categoria_id", categoriaIdMap);
      mapFk("marca_id", marcaIdMap);
      mapFk("proveedor_id", proveedorIdMap);
      mapFk("producto_id", productoIdMap);

      return r;
    };

    const resolveUniqueNumero = (
      row: Record<string, any>,
      numMap: Map<string, string>
    ) => {
      if (!row.numero) return;
      const numStr = String(row.numero);
      const existingId = numMap.get(numStr);
      if (existingId && existingId !== String(row.id)) {
        // Dos equipos distintos generaron aleatoriamente el mismo número (ej. VTA-2026-1234):
        // sufijar con los primeros 4 caracteres del UUID para no perder la venta ni chocar con UNIQUE(numero)
        const suffix = String(row.id).slice(0, 4).toUpperCase();
        row.numero = `${numStr}-${suffix}`;
      }
      numMap.set(String(row.numero), String(row.id));
    };

    for (const table of SYNC_TABLES_ORDER) {
      const rawRows = payload.tables?.[table];
      if (!Array.isArray(rawRows) || rawRows.length === 0) continue;

      const validCols = colsByTable.get(table);
      if (!validCols || validCols.size === 0) continue;

      const normalizedRows: Record<string, any>[] = [];
      const seenKeysInBatch = new Map<string, number>();

      for (const rawRow of rawRows) {
        const row = translateForeignKeys(rawRow);

        if (table === "monedas" && row.codigo) {
          const key = String(row.codigo).toUpperCase().trim();
          const localId = monedaByCodigo.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            monedaIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            monedaByCodigo.set(key, row.id);
          }
        } else if (table === "cajas" && row.nombre) {
          const key = String(row.nombre).toLowerCase().trim();
          const localId = cajaByNombre.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            cajaIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            cajaByNombre.set(key, row.id);
          }
        } else if (table === "categorias" && row.nombre) {
          const key = String(row.nombre).toLowerCase().trim();
          const localId = catByNombre.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            categoriaIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            catByNombre.set(key, row.id);
          }
        } else if (table === "marcas" && row.nombre) {
          const key = String(row.nombre).toLowerCase().trim();
          const localId = marcaByNombre.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            marcaIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            marcaByNombre.set(key, row.id);
          }
        } else if (table === "proveedores" && row.nombre) {
          const key = String(row.nombre).toLowerCase().trim();
          const localId = provByNombre.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            proveedorIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            provByNombre.set(key, row.id);
          }
        } else if (table === "productos" && row.codigo) {
          const key = String(row.codigo).toLowerCase().trim();
          const localId = prodByCodigo.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            productoIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            prodByCodigo.set(key, row.id);
          }
        } else if (table === "metodos_pago" && row.nombre) {
          const key = `${String(row.nombre).toLowerCase().trim()}::${row.caja_id ? String(row.caja_id) : ""}`;
          const localId = mpByKey.get(key);
          if (localId !== undefined && String(localId) !== String(row.id)) {
            metodoPagoIdMap.set(String(row.id), localId);
            row.id = localId;
          } else {
            mpByKey.set(key, row.id);
          }
        } else if (table === "configuracion" && row.clave) {
          const localId = cfgByClave.get(String(row.clave));
          if (localId !== undefined) row.id = localId;
          else cfgByClave.set(String(row.clave), row.id);
        } else if (table === "producto_precios" && row.producto_id && row.moneda_id) {
          const key = `${row.producto_id}::${row.moneda_id}`;
          const localId = ppByKey.get(key);
          if (localId !== undefined) row.id = localId;
          else ppByKey.set(key, row.id);
        } else if (table === "cliente_limites_credito" && row.cliente_id && row.moneda_id) {
          const key = `${row.cliente_id}::${row.moneda_id}`;
          const localId = clcByKey.get(key);
          if (localId !== undefined) row.id = localId;
          else clcByKey.set(key, row.id);
        } else if (table === "producto_presentaciones" && row.producto_id && row.nombre) {
          const key = `${row.producto_id}::${String(row.nombre).toLowerCase().trim()}`;
          const codeKey = row.codigo ? String(row.codigo).toLowerCase().trim() : null;
          const localId =
            presByKey.get(key) ?? (codeKey ? presByCodigo.get(codeKey) : undefined);
          if (localId !== undefined) row.id = localId;
          else {
            presByKey.set(key, row.id);
            if (codeKey) presByCodigo.set(codeKey, row.id);
          }
        } else if (table === "ventas") {
          resolveUniqueNumero(row, ventasByNum);
        } else if (table === "compras") {
          resolveUniqueNumero(row, comprasByNum);
        } else if (table === "creditos") {
          resolveUniqueNumero(row, creditosByNum);
        } else if (table === "retornos") {
          resolveUniqueNumero(row, retornosByNum);
        }

        const pkKey =
          table === "producto_proveedores"
            ? `${row.producto_id}::${row.proveedor_id}`
            : String(row.id);

        if (seenKeysInBatch.has(pkKey)) {
          normalizedRows[seenKeysInBatch.get(pkKey)!] = row;
        } else {
          seenKeysInBatch.set(pkKey, normalizedRows.length);
          normalizedRows.push(row);
        }
      }

      if (normalizedRows.length === 0) continue;

      const cols = Object.keys(normalizedRows[0]).filter((c) => validCols.has(c));
      if (cols.length === 0) continue;

      const colNames = cols.map((c) => `"${c}"`).join(", ");
      const conflictTarget =
        table === "producto_proveedores" ? `("producto_id", "proveedor_id")` : `("id")`;
      const updateCols = cols.filter(
        (c) =>
          c !== "id" &&
          !(table === "producto_proveedores" && (c === "producto_id" || c === "proveedor_id"))
      );
      const updateSet = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
      const lwwWhere =
        validCols.has("actualizado_en") && cols.includes("actualizado_en")
          ? ` WHERE "${table}".actualizado_en IS NULL OR EXCLUDED.actualizado_en >= "${table}".actualizado_en`
          : "";

      const BATCH_SIZE = 100;
      for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
        const batch = normalizedRows.slice(i, i + BATCH_SIZE);
        const valueClauses: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        for (const r of batch) {
          const rowPlaceholders: string[] = [];
          for (const c of cols) {
            rowPlaceholders.push(`$${paramIdx++}`);
            let val = r[c];
            if (val !== null && typeof val === "object" && !(val instanceof Date)) {
              val = JSON.stringify(val);
            }
            params.push(val ?? null);
          }
          valueClauses.push(`(${rowPlaceholders.join(", ")})`);
        }

        const batchSql =
          updateCols.length === 0
            ? `INSERT INTO "${table}" (${colNames}) VALUES ${valueClauses.join(", ")} ON CONFLICT ${conflictTarget} DO NOTHING`
            : `INSERT INTO "${table}" (${colNames}) VALUES ${valueClauses.join(", ")} ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}${lwwWhere}`;

        try {
          await client.query("SAVEPOINT sp_sync_batch");
          const res = await client.query(batchSql, params);
          await client.query("RELEASE SAVEPOINT sp_sync_batch");
          appliedRows += res.rowCount ?? 0;
        } catch (batchErr: any) {
          await client.query("ROLLBACK TO SAVEPOINT sp_sync_batch");
          // Fallback fila por fila para que 1 fila con conflicto jamás descarte las otras 99 del lote
          for (const singleRow of batch) {
            const singlePlaceholders: string[] = [];
            const singleParams: any[] = [];
            let sIdx = 1;
            for (const c of cols) {
              singlePlaceholders.push(`$${sIdx++}`);
              let val = singleRow[c];
              if (val !== null && typeof val === "object" && !(val instanceof Date)) {
                val = JSON.stringify(val);
              }
              singleParams.push(val ?? null);
            }
            const singleSql =
              updateCols.length === 0
                ? `INSERT INTO "${table}" (${colNames}) VALUES (${singlePlaceholders.join(", ")}) ON CONFLICT ${conflictTarget} DO NOTHING`
                : `INSERT INTO "${table}" (${colNames}) VALUES (${singlePlaceholders.join(", ")}) ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}${lwwWhere}`;
            try {
              await client.query("SAVEPOINT sp_sync_row");
              const sRes = await client.query(singleSql, singleParams);
              await client.query("RELEASE SAVEPOINT sp_sync_row");
              appliedRows += sRes.rowCount ?? 0;
            } catch (rowErr: any) {
              await client.query("ROLLBACK TO SAVEPOINT sp_sync_row");
              console.warn(`[Sync] Aviso en fila de ${table}:`, rowErr?.message);
            }
          }
        }
      }
    }

    // Aplicar eliminaciones (Tombstones) si existen
    if (hasDeletions) {
      const allowedTables = new Set<string>(SYNC_TABLES_ORDER);
      for (const tomb of payload.eliminados) {
        if (!allowedTables.has(tomb.tabla)) continue;
        try {
          await client.query("SAVEPOINT sp_sync_del");
          const delRes = await client.query(
            `DELETE FROM "${tomb.tabla}" WHERE id::text = $1`,
            [String(tomb.registro_id)]
          );
          await client.query(
            `INSERT INTO sync_eliminados (tabla, registro_id, eliminado_en)
             VALUES ($1, $2, $3)
             ON CONFLICT (tabla, registro_id) DO UPDATE SET eliminado_en = EXCLUDED.eliminado_en`,
            [tomb.tabla, String(tomb.registro_id), tomb.eliminado_en || new Date().toISOString()]
          );
          await client.query("RELEASE SAVEPOINT sp_sync_del");
          deletedRows += delRes.rowCount ?? 0;
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT sp_sync_del");
        }
      }
    }

    // Sincronizar secuencias seriales de PostgreSQL solo cuando se modificaron tablas con secuencias
    const serialTables = [
      { table: "productos", col: "id" },
      { table: "producto_costos_historicos", col: "id" },
      { table: "configuracion_global", col: "id" },
    ];
    for (const { table, col } of serialTables) {
      if (!payload.tables?.[table]?.length) continue;
      try {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('${table}', '${col}'),
            COALESCE((SELECT MAX("${col}") FROM "${table}"), 1),
            (SELECT MAX("${col}") FROM "${table}") IS NOT NULL
          );
        `);
      } catch {
        // Ignorar si la tabla usa UUID
      }
    }
  } finally {
    if (replicaEnabled) {
      await client.query("SET LOCAL session_replication_role = 'origin'").catch(() => {});
    }
  }

  return { appliedRows, deletedRows };
}

/**
 * Ejecuta una sincronización completa o incremental desde la instancia local hacia la Nube.
 * Soporta un solo round-trip HTTP (`bidirectional_sync`) para máxima velocidad.
 */
export async function executeCloudSync(options?: {
  direction?: "bidireccional" | "push" | "pull";
  forceFull?: boolean;
}): Promise<SyncResult> {
  if (globalForSync.syncRunning) {
    return {
      ok: true,
      direccion: options?.direction ?? "bidireccional",
      registros_subidos: 0,
      registros_bajados: 0,
      eliminados_aplicados: 0,
      duracion_ms: 0,
      fecha: new Date().toISOString(),
      mensaje: "Sincronización ya en curso.",
    };
  }

  globalForSync.syncRunning = true;
  const startTime = Date.now();
  const direction = options?.direction ?? "bidireccional";
  const forceFull = options?.forceFull ?? false;

  try {
    await ensureSyncTables();
    const cfg = await getSyncConfig();

    if (cfg.modo_conexion === "desactivado") {
      if (cfg.es_nube_central) {
        return {
          ok: true,
          direccion: direction,
          registros_subidos: 0,
          registros_bajados: 0,
          eliminados_aplicados: 0,
          duracion_ms: Date.now() - startTime,
          fecha: new Date().toISOString(),
          mensaje: "Este servidor ya es la Nube Central (datos en tiempo real).",
        };
      }
      return {
        ok: false,
        direccion: direction,
        registros_subidos: 0,
        registros_bajados: 0,
        eliminados_aplicados: 0,
        duracion_ms: 0,
        fecha: new Date().toISOString(),
        mensaje: "La sincronización en la nube está desactivada.",
        error: "Sincronización desactivada en configuración",
      };
    }

    await query(
      `UPDATE sync_config SET ultimo_estado = 'sincronizando', ultimo_error = NULL WHERE id = 1`
    );

    let subidos = 0;
    let bajados = 0;
    let eliminadosAplicados = 0;

    try {
      const sincePush = forceFull ? null : cfg.ultima_sincronizacion_push;
      const sincePull = forceFull ? null : cfg.ultima_sincronizacion_pull;
      const syncTimestamp = new Date().toISOString();

      if (cfg.modo_conexion === "db_directa") {
        if (!cfg.cloud_database_url) {
          throw new Error("Falta configurar la URL de Base de Datos en la Nube (PostgreSQL)");
        }

        const cloudPool = new Pool({
          connectionString: cfg.cloud_database_url,
          max: 2,
          connectionTimeoutMillis: 10000,
        });

        try {
          await ensureSyncTables(cloudPool);

          if (direction === "bidireccional" || direction === "pull") {
            const cloudDelta = await collectDeltaFromDb(cloudPool, sincePull, "cloud-db");
            const pullRes = await transaction(async (localClient) => {
              return await applyDeltaToDb(localClient, cloudDelta);
            });
            bajados = pullRes.appliedRows;
            eliminadosAplicados += pullRes.deletedRows;

            await query(
              `UPDATE sync_config SET ultima_sincronizacion_pull = $1, actualizado_en = NOW() WHERE id = 1`,
              [cloudDelta.hasta || syncTimestamp]
            );
          }

          if (direction === "bidireccional" || direction === "push") {
            const localDelta = await collectDeltaFromDb(pool, sincePush, cfg.dispositivo_id);
            const cloudClient = await cloudPool.connect();
            try {
              await cloudClient.query("BEGIN");
              const pushRes = await applyDeltaToDb(cloudClient, localDelta);
              await cloudClient.query("COMMIT");
              subidos = pushRes.appliedRows;
            } catch (err) {
              await cloudClient.query("ROLLBACK");
              throw err;
            } finally {
              cloudClient.release();
            }

            await query(
              `UPDATE sync_config SET ultima_sincronizacion_push = $1, actualizado_en = NOW() WHERE id = 1`,
              [localDelta.hasta || syncTimestamp]
            );
          }
        } finally {
          await cloudPool.end().catch(() => {});
        }
      } else if (cfg.modo_conexion === "api_nube") {
        if (!cfg.cloud_url) {
          throw new Error("Falta configurar la URL del Servidor PosBit en la Nube");
        }

        const baseUrl = cfg.cloud_url.replace(/\/+$/, "");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (cfg.cloud_api_key) {
          headers["Authorization"] = `Bearer ${cfg.cloud_api_key}`;
          headers["X-Sync-Api-Key"] = cfg.cloud_api_key;
        }

        // Optimización Single-Roundtrip cuando es bidireccional
        if (direction === "bidireccional") {
          const localDelta = await collectDeltaFromDb(pool, sincePush, cfg.dispositivo_id);
          const totalRowsToPush = Object.values(localDelta.tables).reduce(
            (acc, arr) => acc + arr.length,
            0
          );

          const biRes = await fetch(`${baseUrl}/api/sync`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              action: "bidirectional_sync",
              since: sincePull,
              payload:
                totalRowsToPush > 0 || localDelta.eliminados.length > 0 || forceFull
                  ? localDelta
                  : null,
            }),
            signal: AbortSignal.timeout(45000),
          });

          if (!biRes.ok) {
            const errBody = await biRes.json().catch(() => ({}));
            throw new Error(
              errBody.error || `Error HTTP ${biRes.status} al sincronizar con la nube`
            );
          }

          const biData = await biRes.json();
          subidos = biData.appliedRows ?? 0;

          if (biData.delta) {
            const pullRes = await transaction(async (localClient) => {
              return await applyDeltaToDb(localClient, biData.delta);
            });
            bajados = pullRes.appliedRows;
            eliminadosAplicados += pullRes.deletedRows;
          }

          const remoteTime = biData.delta?.hasta || biData.serverTime || syncTimestamp;
          await query(
            `UPDATE sync_config
                SET ultima_sincronizacion_pull = $1,
                    ultima_sincronizacion_push = $2,
                    actualizado_en = NOW()
              WHERE id = 1`,
            [remoteTime, localDelta.hasta || syncTimestamp]
          );
        } else {
          // 1. PULL (Nube -> Local)
          if (direction === "pull") {
            const pullUrl = new URL(`${baseUrl}/api/sync`);
            if (sincePull) pullUrl.searchParams.set("since", sincePull);

            const pullResponse = await fetch(pullUrl.toString(), {
              method: "GET",
              headers,
              signal: AbortSignal.timeout(30000),
            });

            if (!pullResponse.ok) {
              const errBody = await pullResponse.json().catch(() => ({}));
              throw new Error(
                errBody.error || `Error HTTP ${pullResponse.status} al descargar datos de la nube`
              );
            }

            const cloudDelta: SyncDeltaPayload = await pullResponse.json();
            const pullRes = await transaction(async (localClient) => {
              return await applyDeltaToDb(localClient, cloudDelta);
            });
            bajados = pullRes.appliedRows;
            eliminadosAplicados += pullRes.deletedRows;

            await query(
              `UPDATE sync_config SET ultima_sincronizacion_pull = $1, actualizado_en = NOW() WHERE id = 1`,
              [cloudDelta.hasta || syncTimestamp]
            );
          }

          // 2. PUSH (Local -> Nube)
          if (direction === "push") {
            const localDelta = await collectDeltaFromDb(pool, sincePush, cfg.dispositivo_id);
            const totalRowsToPush = Object.values(localDelta.tables).reduce(
              (acc, arr) => acc + arr.length,
              0
            );

            if (totalRowsToPush > 0 || localDelta.eliminados.length > 0 || forceFull) {
              const pushResponse = await fetch(`${baseUrl}/api/sync`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  action: "remote_push",
                  payload: localDelta,
                }),
                signal: AbortSignal.timeout(45000),
              });

              if (!pushResponse.ok) {
                const errBody = await pushResponse.json().catch(() => ({}));
                throw new Error(
                  errBody.error || `Error HTTP ${pushResponse.status} al subir datos a la nube`
                );
              }

              const pushData = await pushResponse.json();
              subidos = pushData.appliedRows ?? totalRowsToPush;
            }

            await query(
              `UPDATE sync_config SET ultima_sincronizacion_push = $1, actualizado_en = NOW() WHERE id = 1`,
              [localDelta.hasta || syncTimestamp]
            );
          }
        }
      }

      const duracionMs = Date.now() - startTime;
      await query(
        `UPDATE sync_config SET ultimo_estado = 'ok', ultimo_error = NULL, actualizado_en = NOW() WHERE id = 1`
      );

      // Solo insertar en sync_historial cuando hubo cambios o fue forzado manualmente para no saturar la tabla
      if (subidos > 0 || bajados > 0 || eliminadosAplicados > 0 || forceFull) {
        await query(
          `INSERT INTO sync_historial (direccion, registros_subidos, registros_bajados, estado, detalle, duracion_ms)
           VALUES ($1, $2, $3, 'ok', $4, $5)`,
          [
            direction,
            subidos,
            bajados,
            `Sincronización exitosa (${subidos} subidos, ${bajados} recibidos)`,
            duracionMs,
          ]
        );
      }

      return {
        ok: true,
        direccion: direction,
        registros_subidos: subidos,
        registros_bajados: bajados,
        eliminados_aplicados: eliminadosAplicados,
        duracion_ms: duracionMs,
        fecha: new Date().toISOString(),
        mensaje: `Sincronización completada: ${subidos} enviados, ${bajados} recibidos.`,
      };
    } catch (error: any) {
      const duracionMs = Date.now() - startTime;
      const msg = error?.message || String(error);
      await query(
        `UPDATE sync_config SET ultimo_estado = 'error', ultimo_error = $1, actualizado_en = NOW() WHERE id = 1`,
        [msg]
      );
      await query(
        `INSERT INTO sync_historial (direccion, registros_subidos, registros_bajados, estado, detalle, duracion_ms)
         VALUES ($1, $2, $3, 'error', $4, $5)`,
        [direction, subidos, bajados, msg, duracionMs]
      );

      return {
        ok: false,
        direccion: direction,
        registros_subidos: subidos,
        registros_bajados: bajados,
        eliminados_aplicados: eliminadosAplicados,
        duracion_ms: duracionMs,
        fecha: new Date().toISOString(),
        mensaje: `Error de sincronización: ${msg}`,
        error: msg,
      };
    }
  } finally {
    globalForSync.syncRunning = false;
  }
}

/**
 * Dispara una sincronización en segundo plano guiada por eventos (Event-Driven Push)
 * inmediatamente después de guardar una venta, compra, producto o tasa en una PC local.
 * No bloquea la respuesta HTTP al cajero (0ms de penalización).
 */
export function triggerBackgroundSync(): void {
  if (isCloudServerEnvironment()) return;
  if (globalForSync.bgSyncTimeout) {
    clearTimeout(globalForSync.bgSyncTimeout);
  }
  globalForSync.bgSyncTimeout = setTimeout(() => {
    globalForSync.bgSyncTimeout = null;
    getSyncConfig()
      .then((cfg) => {
        if (cfg.modo_conexion !== "desactivado" && cfg.auto_sync) {
          return executeCloudSync({ direction: "bidireccional", forceFull: false });
        }
      })
      .catch(() => {
        // Silencioso en modo offline
      });
  }, 600);
}
