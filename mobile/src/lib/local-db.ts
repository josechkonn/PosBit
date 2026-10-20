import * as SQLite from "expo-sqlite";

export interface LocalMoneda {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  tasa: number;
  es_base: number;
}

export interface LocalProducto {
  id: number;
  codigo: string;
  nombre: string;
  stock: number;
  precio_base: number;
  moneda_base_id: string | null;
  activo: number;
  actualizado_en: string;
}

export interface LocalVentaPendiente {
  id: string;
  numero: string;
  cliente_nombre: string;
  moneda_id: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  total: number;
  fecha: string;
  items_json: string;
  sincronizado: number;
  creado_en: string;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getMobileDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("posbit_mobile.db");

  await dbInstance.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sync_meta (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS monedas (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      simbolo TEXT NOT NULL,
      tasa REAL NOT NULL DEFAULT 1,
      es_base INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cajas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      moneda_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metodos_pago (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      caja_id TEXT
    );

    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      precio_base REAL NOT NULL DEFAULT 0,
      moneda_base_id TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      actualizado_en TEXT
    );

    CREATE TABLE IF NOT EXISTS ventas_locales (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL,
      cliente_nombre TEXT,
      moneda_id TEXT NOT NULL,
      metodo_pago_id TEXT,
      caja_id TEXT,
      total REAL NOT NULL,
      fecha TEXT NOT NULL,
      items_json TEXT NOT NULL,
      sincronizado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );
  `);

  return dbInstance;
}

export async function getMeta(clave: string): Promise<string | null> {
  const db = await getMobileDb();
  const row = await db.getFirstAsync<{ valor: string }>(
    `SELECT valor FROM sync_meta WHERE clave = ?`,
    [clave]
  );
  return row?.valor ?? null;
}

export async function setMeta(clave: string, valor: string): Promise<void> {
  const db = await getMobileDb();
  await db.runAsync(
    `INSERT INTO sync_meta (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [clave, valor]
  );
}

export async function saveCatalogOffline(data: {
  monedas?: any[];
  cajas?: any[];
  metodos_pago?: any[];
  productos?: any[];
}): Promise<void> {
  const db = await getMobileDb();

  if (Array.isArray(data.monedas)) {
    for (const m of data.monedas) {
      await db.runAsync(
        `INSERT INTO monedas (id, codigo, nombre, simbolo, tasa, es_base)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo,
           nombre = excluded.nombre,
           simbolo = excluded.simbolo,
           tasa = excluded.tasa,
           es_base = excluded.es_base`,
        [
          String(m.id),
          String(m.codigo),
          String(m.nombre),
          String(m.simbolo || "$"),
          Number(m.tasa) || 1,
          m.es_base ? 1 : 0,
        ]
      );
    }
  }

  if (Array.isArray(data.cajas)) {
    for (const c of data.cajas) {
      await db.runAsync(
        `INSERT INTO cajas (id, nombre, moneda_id)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, moneda_id = excluded.moneda_id`,
        [String(c.id), String(c.nombre), String(c.moneda_id)]
      );
    }
  }

  if (Array.isArray(data.metodos_pago)) {
    for (const mp of data.metodos_pago) {
      await db.runAsync(
        `INSERT INTO metodos_pago (id, nombre, tipo, caja_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, tipo = excluded.tipo, caja_id = excluded.caja_id`,
        [String(mp.id), String(mp.nombre), String(mp.tipo || "Efectivo"), mp.caja_id ? String(mp.caja_id) : null]
      );
    }
  }

  if (Array.isArray(data.productos)) {
    for (const p of data.productos) {
      await db.runAsync(
        `INSERT INTO productos (id, codigo, nombre, stock, precio_base, moneda_base_id, activo, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo,
           nombre = excluded.nombre,
           stock = excluded.stock,
           precio_base = excluded.precio_base,
           moneda_base_id = excluded.moneda_base_id,
           activo = excluded.activo,
           actualizado_en = excluded.actualizado_en`,
        [
          Number(p.id),
          String(p.codigo),
          String(p.nombre),
          Number(p.stock) || 0,
          Number(p.precio_base) || 0,
          p.moneda_base_id ? String(p.moneda_base_id) : null,
          p.activo === false ? 0 : 1,
          p.actualizado_en ? String(p.actualizado_en) : new Date().toISOString(),
        ]
      );
    }
  }
}

export async function getLocalProductos(search = ""): Promise<LocalProducto[]> {
  const db = await getMobileDb();
  const q = search.trim();
  if (!q) {
    return await db.getAllAsync<LocalProducto>(
      `SELECT * FROM productos WHERE activo = 1 ORDER BY nombre ASC LIMIT 200`
    );
  }
  const like = `%${q}%`;
  return await db.getAllAsync<LocalProducto>(
    `SELECT * FROM productos WHERE activo = 1 AND (nombre LIKE ? OR codigo LIKE ?) ORDER BY nombre ASC LIMIT 100`,
    [like, like]
  );
}

export async function getLocalMonedas(): Promise<LocalMoneda[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalMoneda>(`SELECT * FROM monedas ORDER BY es_base DESC, codigo ASC`);
}

export async function createOfflineSale(venta: {
  cliente_nombre: string;
  moneda_id: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  total: number;
  items: Array<{ producto_id: number; nombre: string; cantidad: number; precio_unit: number; subtotal: number }>;
}): Promise<LocalVentaPendiente> {
  const db = await getMobileDb();
  const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  const now = new Date();
  const fecha = now.toISOString().split("T")[0];
  const numero = `MOV-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const creado_en = now.toISOString();
  const items_json = JSON.stringify(venta.items);

  await db.runAsync(
    `INSERT INTO ventas_locales (id, numero, cliente_nombre, moneda_id, metodo_pago_id, caja_id, total, fecha, items_json, sincronizado, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      numero,
      venta.cliente_nombre || "Consumidor Final",
      venta.moneda_id,
      venta.metodo_pago_id,
      venta.caja_id,
      venta.total,
      fecha,
      items_json,
      creado_en,
    ]
  );

  // Descontar stock localmente de forma optimista
  for (const item of venta.items) {
    await db.runAsync(
      `UPDATE productos SET stock = stock - ? WHERE id = ?`,
      [item.cantidad, item.producto_id]
    );
  }

  return {
    id,
    numero,
    cliente_nombre: venta.cliente_nombre || "Consumidor Final",
    moneda_id: venta.moneda_id,
    metodo_pago_id: venta.metodo_pago_id,
    caja_id: venta.caja_id,
    total: venta.total,
    fecha,
    items_json,
    sincronizado: 0,
    creado_en,
  };
}

export async function getVentasLocales(): Promise<LocalVentaPendiente[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalVentaPendiente>(
    `SELECT * FROM ventas_locales ORDER BY creado_en DESC LIMIT 50`
  );
}

export async function markVentaSincronizada(id: string): Promise<void> {
  const db = await getMobileDb();
  await db.runAsync(`UPDATE ventas_locales SET sincronizado = 1 WHERE id = ?`, [id]);
}
