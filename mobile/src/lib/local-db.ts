import * as SQLite from "expo-sqlite";

export interface LocalMoneda {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  tasa: number;
  es_base: number;
  decimales?: number;
  tasa_ref_moneda_id?: string | null;
  usa_tasa_usd_directa?: number;
  tasa_usd_directa?: number | null;
}

export interface LocalCaja {
  id: string;
  nombre: string;
  moneda_id: string;
  saldo_actual?: number;
}

export interface LocalMetodoPago {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: string | null;
  moneda_id?: string | null;
  moneda_codigo?: string | null;
}

export interface LocalCategoria {
  id: number;
  nombre: string;
}

export interface LocalPresentacion {
  id: string;
  producto_id: number;
  nombre: string;
  unidades: number;
  codigo: string | null;
  modo_venta: string;
  precio_override: number | null;
  margen_override: number | null;
}

export interface LocalConfiguracionGlobal {
  metodo_conversion_compras: "directa" | "triangulacion";
  metodo_conversion_ventas: "directa" | "triangulacion";
  moneda_transito_compras_id: string | null;
  moneda_transito_ventas_id: string | null;
  auto_precio_compra?: boolean;
  redondeo_activo?: boolean;
  redondeo_multiplo?: number;
  redondeo_no_bajar_de_costo?: boolean;
}

export interface LocalProducto {
  id: number;
  codigo: string;
  nombre: string;
  categoria_id?: number | null;
  categoria_nombre?: string | null;
  marca_nombre?: string | null;
  stock: number;
  stock_minimo?: number;
  precio_base: number;
  costo_base?: number;
  moneda_base_id: string | null;
  moneda_costo_id?: string | null;
  iva_incluido?: number;
  imagen?: string | null;
  activo: number;
  actualizado_en: string;
  presentaciones?: LocalPresentacion[];
}

export interface LocalClienteLimite {
  moneda_id: string;
  codigo: string;
  simbolo: string;
  es_base: number;
  limite: number;
}

export interface LocalClienteDeuda {
  codigo: string;
  simbolo: string;
  monto: number;
}

export interface LocalCliente {
  id: number;
  nombre: string;
  tipo: string;
  documento: string | null;
  email: string | null;
  telefono: string | null;
  ciudad: string | null;
  direccion: string | null;
  recibe_credito: number;
  limite_credito: number;
  activo: number;
  limites_credito: LocalClienteLimite[];
  deuda_total: LocalClienteDeuda[];
  ventas_count?: number;
}

export interface LocalCredito {
  id: number;
  numero: string;
  venta_id: number | null;
  venta_numero?: string | null;
  cliente_id: number;
  cliente_nombre: string;
  cliente_documento?: string | null;
  cliente_telefono?: string | null;
  fecha: string;
  fecha_vencimiento: string | null;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  monto_total: number;
  saldo: number;
  abonado: number;
  estado: "Pendiente" | "Parcial" | "Pagado";
  abonos_count?: number;
}

export interface LocalAbono {
  id: number;
  credito_id: number;
  cliente_id: number;
  fecha: string;
  monto: number;
  moneda_id: string;
  moneda_codigo?: string;
  moneda_simbolo?: string;
  metodo_pago_id: string | null;
  metodo_pago_nombre?: string | null;
  caja_id: string | null;
  observaciones: string | null;
}

export interface LocalVentaRemota {
  id: number;
  numero: string;
  cliente_id: number | null;
  cliente: string | null;
  fecha: string;
  subtotal: number;
  impuesto: number;
  descuento: number;
  total: number;
  moneda_id: string;
  moneda_codigo?: string;
  moneda_simbolo?: string;
  tipo_pago: string;
  metodo_pago_id: string | null;
  metodo_pago_nombre?: string | null;
  estado: string;
  observaciones: string | null;
}

export interface LocalVentaPendiente {
  id: string;
  numero: string;
  cliente_id?: number | null;
  cliente_nombre: string;
  moneda_id: string;
  tipo_pago?: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  subtotal?: number;
  impuesto?: number;
  descuento?: number;
  total: number;
  monto_pagado?: number;
  fecha: string;
  items_json: string;
  pagos_json?: string | null;
  cobros_extra_json?: string | null;
  observaciones?: string | null;
  sincronizado: number;
  creado_en: string;
}

export interface LocalAbonoPendiente {
  id: string;
  credito_id: number;
  fecha: string;
  monto: number;
  moneda_id: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  lineas_json: string | null;
  observaciones: string | null;
  sincronizado: number;
  creado_en: string;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;
let schemaVersionApplied = 0;
const CURRENT_SCHEMA_VERSION = 6;

export async function getMobileDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance && schemaVersionApplied === CURRENT_SCHEMA_VERSION) return dbInstance;
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync("posbit_mobile.db");
  }

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
      es_base INTEGER NOT NULL DEFAULT 0,
      decimales INTEGER NOT NULL DEFAULT 2,
      tasa_ref_moneda_id TEXT,
      usa_tasa_usd_directa INTEGER NOT NULL DEFAULT 0,
      tasa_usd_directa REAL
    );

    CREATE TABLE IF NOT EXISTS cajas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      moneda_id TEXT NOT NULL,
      saldo_actual REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS metodos_pago (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      caja_id TEXT
    );

    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'Persona Natural',
      documento TEXT,
      email TEXT,
      telefono TEXT,
      ciudad TEXT,
      direccion TEXT,
      recibe_credito INTEGER NOT NULL DEFAULT 0,
      limite_credito REAL NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1,
      actualizado_en TEXT
    );

    CREATE TABLE IF NOT EXISTS cliente_limites_credito (
      cliente_id INTEGER NOT NULL,
      moneda_id TEXT NOT NULL,
      limite REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (cliente_id, moneda_id)
    );

    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      categoria_id INTEGER,
      categoria_nombre TEXT,
      marca_nombre TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 5,
      precio_base REAL NOT NULL DEFAULT 0,
      costo_base REAL NOT NULL DEFAULT 0,
      moneda_base_id TEXT,
      iva_incluido INTEGER NOT NULL DEFAULT 1,
      imagen TEXT,
      activo INTEGER NOT NULL DEFAULT 1,
      actualizado_en TEXT
    );

    CREATE TABLE IF NOT EXISTS producto_presentaciones (
      id TEXT PRIMARY KEY,
      producto_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      unidades INTEGER NOT NULL DEFAULT 1,
      codigo TEXT,
      modo_venta TEXT NOT NULL DEFAULT 'derivado',
      precio_override REAL,
      margen_override REAL
    );

    CREATE TABLE IF NOT EXISTS creditos (
      id INTEGER PRIMARY KEY,
      numero TEXT NOT NULL,
      venta_id INTEGER,
      cliente_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      fecha_vencimiento TEXT,
      moneda_id TEXT NOT NULL,
      monto_total REAL NOT NULL DEFAULT 0,
      saldo REAL NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      actualizado_en TEXT
    );

    CREATE TABLE IF NOT EXISTS abonos (
      id INTEGER PRIMARY KEY,
      credito_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      monto REAL NOT NULL DEFAULT 0,
      moneda_id TEXT NOT NULL,
      metodo_pago_id TEXT,
      caja_id TEXT,
      observaciones TEXT
    );

    CREATE TABLE IF NOT EXISTS ventas_remotas (
      id INTEGER PRIMARY KEY,
      numero TEXT NOT NULL,
      cliente_id INTEGER,
      cliente TEXT,
      fecha TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      impuesto REAL NOT NULL DEFAULT 0,
      descuento REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      moneda_id TEXT NOT NULL,
      tipo_pago TEXT NOT NULL DEFAULT 'Contado',
      metodo_pago_id TEXT,
      estado TEXT NOT NULL DEFAULT 'Pagada',
      observaciones TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mobile_productos_nombre ON productos(activo, nombre);
    CREATE INDEX IF NOT EXISTS idx_mobile_productos_codigo ON productos(codigo);
    CREATE INDEX IF NOT EXISTS idx_mobile_clientes_nombre ON clientes(nombre);
    CREATE INDEX IF NOT EXISTS idx_mobile_creditos_cliente ON creditos(cliente_id, estado);

    CREATE TABLE IF NOT EXISTS ventas_locales (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL,
      cliente_id INTEGER,
      cliente_nombre TEXT,
      moneda_id TEXT NOT NULL,
      tipo_pago TEXT NOT NULL DEFAULT 'Contado',
      metodo_pago_id TEXT,
      caja_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      impuesto REAL NOT NULL DEFAULT 0,
      descuento REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      monto_pagado REAL NOT NULL DEFAULT 0,
      fecha TEXT NOT NULL,
      items_json TEXT NOT NULL,
      pagos_json TEXT,
      cobros_extra_json TEXT,
      observaciones TEXT,
      sincronizado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS abonos_locales (
      id TEXT PRIMARY KEY,
      credito_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      monto REAL NOT NULL,
      moneda_id TEXT NOT NULL,
      metodo_pago_id TEXT,
      caja_id TEXT,
      lineas_json TEXT,
      observaciones TEXT,
      sincronizado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL
    );
  `);

  // Safe migrations for existing installations
  const safeAlter = [
    `ALTER TABLE monedas ADD COLUMN decimales INTEGER NOT NULL DEFAULT 2`,
    `ALTER TABLE monedas ADD COLUMN tasa_ref_moneda_id TEXT`,
    `ALTER TABLE monedas ADD COLUMN usa_tasa_usd_directa INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE monedas ADD COLUMN tasa_usd_directa REAL`,
    `ALTER TABLE cajas ADD COLUMN saldo_actual REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE productos ADD COLUMN categoria_id INTEGER`,
    `ALTER TABLE productos ADD COLUMN categoria_nombre TEXT`,
    `ALTER TABLE productos ADD COLUMN marca_nombre TEXT`,
    `ALTER TABLE productos ADD COLUMN stock_minimo INTEGER NOT NULL DEFAULT 5`,
    `ALTER TABLE productos ADD COLUMN costo_base REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE productos ADD COLUMN moneda_costo_id TEXT`,
    `ALTER TABLE productos ADD COLUMN iva_incluido INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE productos ADD COLUMN imagen TEXT`,
    `ALTER TABLE ventas_locales ADD COLUMN cliente_id INTEGER`,
    `ALTER TABLE ventas_locales ADD COLUMN tipo_pago TEXT NOT NULL DEFAULT 'Contado'`,
    `ALTER TABLE ventas_locales ADD COLUMN subtotal REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ventas_locales ADD COLUMN impuesto REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ventas_locales ADD COLUMN descuento REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ventas_locales ADD COLUMN monto_pagado REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ventas_locales ADD COLUMN pagos_json TEXT`,
    `ALTER TABLE ventas_locales ADD COLUMN cobros_extra_json TEXT`,
    `ALTER TABLE ventas_locales ADD COLUMN observaciones TEXT`,
  ];
  for (const sql of safeAlter) {
    try {
      await dbInstance.execAsync(sql);
    } catch {
      // Column already exists
    }
  }

  // Si la versión de esquema en disco cambió, forzar re-descarga completa del catálogo y tasas
  try {
    const verRow = await dbInstance.getFirstAsync<{ valor: string }>(
      `SELECT valor FROM sync_meta WHERE clave = 'db_schema_version'`
    );
    if (verRow?.valor !== String(CURRENT_SCHEMA_VERSION)) {
      await dbInstance.runAsync(`DELETE FROM sync_meta WHERE clave = 'last_pull_iso'`);
      await dbInstance.runAsync(
        `INSERT INTO sync_meta (clave, valor) VALUES ('db_schema_version', ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
        [String(CURRENT_SCHEMA_VERSION)]
      );
    }
  } catch {
    // Ignore
  }

  schemaVersionApplied = CURRENT_SCHEMA_VERSION;
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
  configuracion_global?: any;
  monedas?: any[];
  cajas?: any[];
  metodos_pago?: any[];
  categorias?: any[];
  clientes?: any[];
  cliente_limites_credito?: any[];
  productos?: any[];
  producto_presentaciones?: any[];
  creditos?: any[];
  abonos?: any[];
  ventas?: any[];
  eliminados?: Array<{ tabla: string; registro_id: string }>;
}): Promise<void> {
  const db = await getMobileDb();

  await db.withTransactionAsync(async () => {
    if (data.configuracion_global) {
      const cfgObj = Array.isArray(data.configuracion_global)
        ? data.configuracion_global[0]
        : data.configuracion_global;
      if (cfgObj) {
        await db.runAsync(
          `INSERT INTO sync_meta (clave, valor) VALUES ('configuracion_global', ?)
           ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
          [JSON.stringify(cfgObj)]
        );
      }
    }

    if (Array.isArray(data.monedas)) {
      for (const m of data.monedas) {
        await db.runAsync(
          `INSERT INTO monedas (id, codigo, nombre, simbolo, tasa, es_base, decimales, tasa_ref_moneda_id, usa_tasa_usd_directa, tasa_usd_directa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             codigo = excluded.codigo,
             nombre = excluded.nombre,
             simbolo = excluded.simbolo,
             tasa = excluded.tasa,
             es_base = excluded.es_base,
             decimales = excluded.decimales,
             tasa_ref_moneda_id = excluded.tasa_ref_moneda_id,
             usa_tasa_usd_directa = excluded.usa_tasa_usd_directa,
             tasa_usd_directa = excluded.tasa_usd_directa`,
          [
            String(m.id),
            String(m.codigo),
            String(m.nombre),
            String(m.simbolo || "$"),
            Number(m.tasa) || 1,
            m.es_base ? 1 : 0,
            Number(m.decimales ?? 2),
            m.tasa_ref_moneda_id ? String(m.tasa_ref_moneda_id) : null,
            m.usa_tasa_usd_directa ? 1 : 0,
            m.tasa_usd_directa != null ? Number(m.tasa_usd_directa) : null,
          ]
        );
      }
    }

    if (Array.isArray(data.cajas)) {
      for (const c of data.cajas) {
        await db.runAsync(
          `INSERT INTO cajas (id, nombre, moneda_id, saldo_actual)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             nombre = excluded.nombre,
             moneda_id = excluded.moneda_id,
             saldo_actual = excluded.saldo_actual`,
          [
            String(c.id),
            String(c.nombre),
            String(c.moneda_id),
            Number(c.saldo_actual) || 0,
          ]
        );
      }
    }

    if (Array.isArray(data.metodos_pago)) {
      for (const mp of data.metodos_pago) {
        await db.runAsync(
          `INSERT INTO metodos_pago (id, nombre, tipo, caja_id)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             nombre = excluded.nombre,
             tipo = excluded.tipo,
             caja_id = excluded.caja_id`,
          [
            String(mp.id),
            String(mp.nombre),
            String(mp.tipo || "Efectivo"),
            mp.caja_id ? String(mp.caja_id) : null,
          ]
        );
      }
    }

    if (Array.isArray(data.categorias)) {
      for (const cat of data.categorias) {
        await db.runAsync(
          `INSERT INTO categorias (id, nombre)
           VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre`,
          [Number(cat.id), String(cat.nombre)]
        );
      }
    }

    if (Array.isArray(data.clientes)) {
      for (const cl of data.clientes) {
        await db.runAsync(
          `INSERT INTO clientes (id, nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito, limite_credito, activo, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             nombre = excluded.nombre,
             tipo = excluded.tipo,
             documento = excluded.documento,
             email = excluded.email,
             telefono = excluded.telefono,
             ciudad = excluded.ciudad,
             direccion = excluded.direccion,
             recibe_credito = excluded.recibe_credito,
             limite_credito = excluded.limite_credito,
             activo = excluded.activo,
             actualizado_en = excluded.actualizado_en`,
          [
            Number(cl.id),
            String(cl.nombre),
            String(cl.tipo || "Persona Natural"),
            cl.documento ? String(cl.documento) : null,
            cl.email ? String(cl.email) : null,
            cl.telefono ? String(cl.telefono) : null,
            cl.ciudad ? String(cl.ciudad) : null,
            cl.direccion ? String(cl.direccion) : null,
            cl.recibe_credito ? 1 : 0,
            Number(cl.limite_credito) || 0,
            cl.activo === false ? 0 : 1,
            cl.actualizado_en ? String(cl.actualizado_en) : new Date().toISOString(),
          ]
        );
        if (Array.isArray(cl.limites_credito)) {
          for (const lc of cl.limites_credito) {
            if (!lc || !lc.moneda_id) continue;
            await db.runAsync(
              `INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite)
               VALUES (?, ?, ?)
               ON CONFLICT(cliente_id, moneda_id) DO UPDATE SET limite = excluded.limite`,
              [Number(cl.id), String(lc.moneda_id), Number(lc.limite) || 0]
            );
          }
        }
      }
    }

    if (Array.isArray(data.cliente_limites_credito)) {
      for (const lc of data.cliente_limites_credito) {
        await db.runAsync(
          `INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite)
           VALUES (?, ?, ?)
           ON CONFLICT(cliente_id, moneda_id) DO UPDATE SET limite = excluded.limite`,
          [Number(lc.cliente_id), String(lc.moneda_id), Number(lc.limite) || 0]
        );
      }
    }

    if (Array.isArray(data.productos)) {
      for (const p of data.productos) {
        await db.runAsync(
          `INSERT INTO productos (id, codigo, nombre, categoria_id, categoria_nombre, marca_nombre, stock, stock_minimo, precio_base, costo_base, moneda_base_id, moneda_costo_id, iva_incluido, imagen, activo, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             codigo = excluded.codigo,
             nombre = excluded.nombre,
             categoria_id = COALESCE(excluded.categoria_id, productos.categoria_id),
             categoria_nombre = COALESCE(excluded.categoria_nombre, productos.categoria_nombre),
             marca_nombre = COALESCE(excluded.marca_nombre, productos.marca_nombre),
             stock = excluded.stock,
             stock_minimo = excluded.stock_minimo,
             precio_base = excluded.precio_base,
             costo_base = excluded.costo_base,
             moneda_base_id = excluded.moneda_base_id,
             moneda_costo_id = excluded.moneda_costo_id,
             iva_incluido = excluded.iva_incluido,
             imagen = COALESCE(excluded.imagen, productos.imagen),
             activo = excluded.activo,
             actualizado_en = excluded.actualizado_en`,
          [
            Number(p.id),
            String(p.codigo),
            String(p.nombre),
            p.categoria_id ? Number(p.categoria_id) : null,
            p.categoria_nombre ? String(p.categoria_nombre) : null,
            p.marca_nombre ? String(p.marca_nombre) : null,
            Number(p.stock) || 0,
            Number(p.stock_minimo ?? 5),
            Number(p.precio_base) || 0,
            Number(p.costo_base) || 0,
            p.moneda_base_id ? String(p.moneda_base_id) : null,
            p.moneda_costo_id ? String(p.moneda_costo_id) : null,
            p.iva_incluido === false ? 0 : 1,
            p.imagen ? String(p.imagen) : null,
            p.activo === false ? 0 : 1,
            p.actualizado_en ? String(p.actualizado_en) : new Date().toISOString(),
          ]
        );
      }
    }

    if (Array.isArray(data.producto_presentaciones)) {
      for (const pp of data.producto_presentaciones) {
        if (pp.activo === false) {
          await db.runAsync(`DELETE FROM producto_presentaciones WHERE id = ?`, [String(pp.id)]);
          continue;
        }
        await db.runAsync(
          `INSERT INTO producto_presentaciones (id, producto_id, nombre, unidades, codigo, modo_venta, precio_override, margen_override)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             producto_id = excluded.producto_id,
             nombre = excluded.nombre,
             unidades = excluded.unidades,
             codigo = excluded.codigo,
             modo_venta = excluded.modo_venta,
             precio_override = excluded.precio_override,
             margen_override = excluded.margen_override`,
          [
            String(pp.id),
            Number(pp.producto_id),
            String(pp.nombre),
            Number(pp.unidades) || 1,
            pp.codigo ? String(pp.codigo) : null,
            String(pp.modo_venta || "derivado"),
            pp.precio_override != null ? Number(pp.precio_override) : null,
            pp.margen_override != null ? Number(pp.margen_override) : null,
          ]
        );
      }
    }

    if (Array.isArray(data.creditos)) {
      for (const cr of data.creditos) {
        await db.runAsync(
          `INSERT INTO creditos (id, numero, venta_id, cliente_id, fecha, fecha_vencimiento, moneda_id, monto_total, saldo, estado, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             numero = excluded.numero,
             venta_id = excluded.venta_id,
             cliente_id = excluded.cliente_id,
             fecha = excluded.fecha,
             fecha_vencimiento = excluded.fecha_vencimiento,
             moneda_id = excluded.moneda_id,
             monto_total = excluded.monto_total,
             saldo = excluded.saldo,
             estado = excluded.estado,
             actualizado_en = excluded.actualizado_en`,
          [
            Number(cr.id),
            String(cr.numero),
            cr.venta_id ? Number(cr.venta_id) : null,
            Number(cr.cliente_id),
            String(cr.fecha || "").slice(0, 10),
            cr.fecha_vencimiento ? String(cr.fecha_vencimiento).slice(0, 10) : null,
            String(cr.moneda_id),
            Number(cr.monto_total) || 0,
            Number(cr.saldo) || 0,
            String(cr.estado || "Pendiente"),
            cr.actualizado_en ? String(cr.actualizado_en) : new Date().toISOString(),
          ]
        );
      }
    }

    if (Array.isArray(data.abonos)) {
      for (const ab of data.abonos) {
        await db.runAsync(
          `INSERT INTO abonos (id, credito_id, cliente_id, fecha, monto, moneda_id, metodo_pago_id, caja_id, observaciones)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             credito_id = excluded.credito_id,
             cliente_id = excluded.cliente_id,
             fecha = excluded.fecha,
             monto = excluded.monto,
             moneda_id = excluded.moneda_id,
             metodo_pago_id = excluded.metodo_pago_id,
             caja_id = excluded.caja_id,
             observaciones = excluded.observaciones`,
          [
            Number(ab.id),
            Number(ab.credito_id),
            Number(ab.cliente_id),
            String(ab.fecha || "").slice(0, 10),
            Number(ab.monto) || 0,
            String(ab.moneda_id),
            ab.metodo_pago_id ? String(ab.metodo_pago_id) : null,
            ab.caja_id ? String(ab.caja_id) : null,
            ab.observaciones ? String(ab.observaciones) : null,
          ]
        );
      }
    }

    if (Array.isArray(data.ventas)) {
      for (const v of data.ventas) {
        await db.runAsync(
          `INSERT INTO ventas_remotas (id, numero, cliente_id, cliente, fecha, subtotal, impuesto, descuento, total, moneda_id, tipo_pago, metodo_pago_id, estado, observaciones)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             numero = excluded.numero,
             cliente_id = excluded.cliente_id,
             cliente = excluded.cliente,
             fecha = excluded.fecha,
             subtotal = excluded.subtotal,
             impuesto = excluded.impuesto,
             descuento = excluded.descuento,
             total = excluded.total,
             moneda_id = excluded.moneda_id,
             tipo_pago = excluded.tipo_pago,
             metodo_pago_id = excluded.metodo_pago_id,
             estado = excluded.estado,
             observaciones = excluded.observaciones`,
          [
            Number(v.id),
            String(v.numero),
            v.cliente_id ? Number(v.cliente_id) : null,
            v.cliente ? String(v.cliente) : null,
            String(v.fecha || "").slice(0, 10),
            Number(v.subtotal) || 0,
            Number(v.impuesto) || 0,
            Number(v.descuento) || 0,
            Number(v.total) || 0,
            String(v.moneda_id),
            String(v.tipo_pago || "Contado"),
            v.metodo_pago_id ? String(v.metodo_pago_id) : null,
            String(v.estado || "Pagada"),
            v.observaciones ? String(v.observaciones) : null,
          ]
        );
      }
    }

    if (Array.isArray(data.eliminados)) {
      for (const del of data.eliminados) {
        if (del.tabla === "productos") {
          await db.runAsync(`DELETE FROM productos WHERE id = ?`, [Number(del.registro_id)]);
        } else if (del.tabla === "monedas") {
          await db.runAsync(`DELETE FROM monedas WHERE id = ?`, [String(del.registro_id)]);
        } else if (del.tabla === "clientes") {
          await db.runAsync(`DELETE FROM clientes WHERE id = ?`, [Number(del.registro_id)]);
        } else if (del.tabla === "creditos") {
          await db.runAsync(`DELETE FROM creditos WHERE id = ?`, [Number(del.registro_id)]);
        } else if (del.tabla === "producto_presentaciones") {
          await db.runAsync(`DELETE FROM producto_presentaciones WHERE id = ?`, [String(del.registro_id)]);
        }
      }
    }
  });
}

export async function getLocalConfiguracionGlobal(): Promise<LocalConfiguracionGlobal> {
  const raw = await getMeta("configuracion_global");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        metodo_conversion_compras:
          parsed.metodo_conversion_compras === "triangulacion" ? "triangulacion" : "directa",
        metodo_conversion_ventas:
          parsed.metodo_conversion_ventas === "triangulacion" ? "triangulacion" : "directa",
        moneda_transito_compras_id: parsed.moneda_transito_compras_id
          ? String(parsed.moneda_transito_compras_id)
          : null,
        moneda_transito_ventas_id: parsed.moneda_transito_ventas_id
          ? String(parsed.moneda_transito_ventas_id)
          : null,
        auto_precio_compra: Boolean(parsed.auto_precio_compra),
        redondeo_activo: Boolean(parsed.redondeo_activo),
        redondeo_multiplo: Number(parsed.redondeo_multiplo) || 0,
        redondeo_no_bajar_de_costo: parsed.redondeo_no_bajar_de_costo !== false,
      };
    } catch {
      // Fallback
    }
  }
  return {
    metodo_conversion_compras: "directa",
    metodo_conversion_ventas: "directa",
    moneda_transito_compras_id: null,
    moneda_transito_ventas_id: null,
  };
}

export async function getLocalMonedas(): Promise<LocalMoneda[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalMoneda>(
    `SELECT * FROM monedas ORDER BY es_base DESC, codigo ASC`
  );
}

export async function getLocalCajas(): Promise<LocalCaja[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalCaja>(`SELECT * FROM cajas ORDER BY nombre ASC`);
}

export async function getLocalMetodosPago(): Promise<LocalMetodoPago[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalMetodoPago>(`
    SELECT mp.*, c.moneda_id, m.codigo as moneda_codigo
    FROM metodos_pago mp
    LEFT JOIN cajas c ON mp.caja_id = c.id
    LEFT JOIN monedas m ON c.moneda_id = m.id
    ORDER BY mp.nombre ASC
  `);
}

export async function getLocalCategorias(): Promise<LocalCategoria[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalCategoria>(`SELECT * FROM categorias ORDER BY nombre ASC`);
}

export async function getLocalProductos(search = ""): Promise<LocalProducto[]> {
  const db = await getMobileDb();
  const q = search.trim();
  let rows: LocalProducto[];
  if (!q) {
    rows = await db.getAllAsync<LocalProducto>(
      `SELECT p.*, COALESCE(p.categoria_nombre, c.nombre) as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = 1
       ORDER BY p.nombre ASC
       LIMIT 300`
    );
  } else {
    const like = `%${q}%`;
    rows = await db.getAllAsync<LocalProducto>(
      `SELECT p.*, COALESCE(p.categoria_nombre, c.nombre) as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = 1 AND (p.nombre LIKE ? OR p.codigo LIKE ?)
       ORDER BY p.nombre ASC
       LIMIT 150`,
      [like, like]
    );
  }

  const presRows = await db.getAllAsync<LocalPresentacion>(
    `SELECT * FROM producto_presentaciones ORDER BY unidades ASC`
  );
  const presMap = new Map<number, LocalPresentacion[]>();
  for (const pr of presRows) {
    const list = presMap.get(pr.producto_id) || [];
    list.push(pr);
    presMap.set(pr.producto_id, list);
  }

  return rows.map((r) => ({
    ...r,
    presentaciones: presMap.get(r.id) || [],
  }));
}

export async function getLocalClientes(): Promise<LocalCliente[]> {
  const db = await getMobileDb();
  const [clientesRows, monedasRows, limitesRows, deudasRows, ventasCounts] = await Promise.all([
    db.getAllAsync<any>(`SELECT * FROM clientes ORDER BY nombre ASC`),
    db.getAllAsync<LocalMoneda>(`SELECT * FROM monedas ORDER BY es_base DESC, codigo ASC`),
    db.getAllAsync<{ cliente_id: number; moneda_id: string; limite: number }>(
      `SELECT * FROM cliente_limites_credito`
    ),
    db.getAllAsync<{ cliente_id: number; codigo: string; simbolo: string; total_saldo: number }>(`
      SELECT cr.cliente_id, m.codigo, m.simbolo, SUM(cr.saldo) as total_saldo
      FROM creditos cr
      JOIN monedas m ON cr.moneda_id = m.id
      WHERE cr.estado <> 'Pagado' AND cr.saldo > 0.009
      GROUP BY cr.cliente_id, m.codigo, m.simbolo
    `),
    db.getAllAsync<{ cliente_id: number; cnt: number }>(`
      SELECT cliente_id, COUNT(*) as cnt FROM ventas_remotas WHERE cliente_id IS NOT NULL GROUP BY cliente_id
    `),
  ]);

  const limitesMap = new Map<string, number>();
  for (const l of limitesRows) {
    limitesMap.set(`${l.cliente_id}::${l.moneda_id}`, Number(l.limite) || 0);
  }

  const deudasMap = new Map<number, LocalClienteDeuda[]>();
  for (const d of deudasRows) {
    if (d.total_saldo <= 0.009) continue;
    const list = deudasMap.get(d.cliente_id) || [];
    list.push({ codigo: d.codigo, simbolo: d.simbolo, monto: Number(d.total_saldo) });
    deudasMap.set(d.cliente_id, list);
  }

  const vCountMap = new Map<number, number>();
  for (const vc of ventasCounts) {
    vCountMap.set(vc.cliente_id, Number(vc.cnt) || 0);
  }

  return clientesRows.map((c) => ({
    id: Number(c.id),
    nombre: String(c.nombre),
    tipo: String(c.tipo || "Persona Natural"),
    documento: c.documento || null,
    email: c.email || null,
    telefono: c.telefono || null,
    ciudad: c.ciudad || null,
    direccion: c.direccion || null,
    recibe_credito: Number(c.recibe_credito) || 0,
    limite_credito: Number(c.limite_credito) || 0,
    activo: Number(c.activo ?? 1),
    limites_credito: monedasRows.map((m) => ({
      moneda_id: m.id,
      codigo: m.codigo,
      simbolo: m.simbolo,
      es_base: m.es_base,
      limite:
        limitesMap.get(`${c.id}::${m.id}`) ??
        (m.es_base ? Number(c.limite_credito) || 0 : 0),
    })),
    deuda_total: deudasMap.get(Number(c.id)) || [],
    ventas_count: vCountMap.get(Number(c.id)) || 0,
  }));
}

export async function getLocalCreditos(): Promise<{
  creditos: LocalCredito[];
  por_cobrar: Array<{ codigo: string; simbolo: string; monto: number }>;
  pendientes: number;
  pagados: number;
}> {
  const db = await getMobileDb();
  const rows = await db.getAllAsync<any>(`
    SELECT cr.*,
      COALESCE(cl.nombre, 'Cliente #' || cr.cliente_id) as cliente_nombre,
      cl.documento as cliente_documento,
      cl.telefono as cliente_telefono,
      v.numero as venta_numero,
      COALESCE(m.codigo, 'USD') as moneda_codigo,
      COALESCE(m.simbolo, '$') as moneda_simbolo,
      (SELECT COUNT(*) FROM abonos a WHERE a.credito_id = cr.id) as abonos_count
    FROM creditos cr
    LEFT JOIN clientes cl ON cr.cliente_id = cl.id
    LEFT JOIN ventas_remotas v ON cr.venta_id = v.id
    LEFT JOIN monedas m ON cr.moneda_id = m.id
    ORDER BY CASE cr.estado WHEN 'Pendiente' THEN 0 WHEN 'Parcial' THEN 1 ELSE 2 END, cr.fecha DESC, cr.id DESC
  `);

  const creditos: LocalCredito[] = rows.map((r) => {
    const montoTotal = Number(r.monto_total) || 0;
    const saldo = Number(r.saldo) || 0;
    return {
      id: Number(r.id),
      numero: String(r.numero),
      venta_id: r.venta_id ? Number(r.venta_id) : null,
      venta_numero: r.venta_numero || null,
      cliente_id: Number(r.cliente_id),
      cliente_nombre: String(r.cliente_nombre),
      cliente_documento: r.cliente_documento || null,
      cliente_telefono: r.cliente_telefono || null,
      fecha: String(r.fecha || "").slice(0, 10),
      fecha_vencimiento: r.fecha_vencimiento ? String(r.fecha_vencimiento).slice(0, 10) : null,
      moneda_id: String(r.moneda_id),
      moneda_codigo: String(r.moneda_codigo),
      moneda_simbolo: String(r.moneda_simbolo),
      monto_total: montoTotal,
      saldo,
      abonado: Math.max(0, montoTotal - saldo),
      estado: (r.estado as any) || "Pendiente",
      abonos_count: Number(r.abonos_count) || 0,
    };
  });

  const porCobrarMap = new Map<string, { codigo: string; simbolo: string; monto: number }>();
  let pendientes = 0;
  let pagados = 0;

  for (const cr of creditos) {
    if (cr.estado === "Pagado" || cr.saldo <= 0.009) {
      pagados++;
    } else {
      if (cr.estado === "Pendiente") pendientes++;
      const prev = porCobrarMap.get(cr.moneda_codigo) || {
        codigo: cr.moneda_codigo,
        simbolo: cr.moneda_simbolo,
        monto: 0,
      };
      prev.monto += cr.saldo;
      porCobrarMap.set(cr.moneda_codigo, prev);
    }
  }

  return {
    creditos,
    por_cobrar: Array.from(porCobrarMap.values()),
    pendientes,
    pagados,
  };
}

export async function getLocalAbonosByCredito(creditoId: number): Promise<LocalAbono[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalAbono>(
    `SELECT a.*, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo, mp.nombre as metodo_pago_nombre
     FROM abonos a
     LEFT JOIN monedas m ON a.moneda_id = m.id
     LEFT JOIN metodos_pago mp ON a.metodo_pago_id = mp.id
     WHERE a.credito_id = ?
     ORDER BY a.fecha DESC, a.id DESC`,
    [creditoId]
  );
}

export async function getLocalVentasRemotas(): Promise<LocalVentaRemota[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalVentaRemota>(`
    SELECT v.*, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo, mp.nombre as metodo_pago_nombre
    FROM ventas_remotas v
    LEFT JOIN monedas m ON v.moneda_id = m.id
    LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
    ORDER BY v.fecha DESC, v.id DESC
    LIMIT 150
  `);
}

export async function createOfflineSale(venta: {
  cliente_id?: number | null;
  cliente_nombre: string;
  moneda_id: string;
  tipo_pago?: string;
  metodo_pago_id: string | null;
  caja_id: string | null;
  subtotal?: number;
  impuesto?: number;
  descuento?: number;
  total: number;
  monto_pagado?: number;
  observaciones?: string;
  pagos?: any[];
  cobros_extra?: any[];
  items: Array<{
    producto_id: number;
    nombre: string;
    cantidad: number;
    precio_unit: number;
    subtotal: number;
    descuento?: number;
    presentacion_id?: string | null;
    presentacion_nombre?: string | null;
    presentacion_unidades?: number | null;
    cantidad_presentaciones?: number | null;
    precio_presentacion?: number | null;
  }>;
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
  const pagos_json = venta.pagos ? JSON.stringify(venta.pagos) : null;
  const cobros_extra_json = venta.cobros_extra ? JSON.stringify(venta.cobros_extra) : null;

  let cajaId = venta.caja_id;
  let metodoId = venta.metodo_pago_id;

  if (!cajaId || !metodoId) {
    const defaultCaja = await db.getFirstAsync<{ caja_id: string; metodo_id: string | null }>(
      `SELECT c.id AS caja_id, mp.id AS metodo_id
         FROM cajas c
         LEFT JOIN metodos_pago mp ON mp.caja_id = c.id
        WHERE c.moneda_id = ?
        LIMIT 1`,
      [venta.moneda_id]
    );
    if (defaultCaja) {
      if (!cajaId) cajaId = defaultCaja.caja_id;
      if (!metodoId) metodoId = defaultCaja.metodo_id;
    }
  }

  const tipoPago = venta.tipo_pago || "Contado";
  const subtotal = venta.subtotal ?? venta.total;
  const impuesto = venta.impuesto ?? 0;
  const descuento = venta.descuento ?? 0;
  const montoPagado =
    venta.monto_pagado !== undefined
      ? venta.monto_pagado
      : tipoPago === "Credito" || tipoPago === "Crédito"
      ? 0
      : venta.total;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO ventas_locales (
        id, numero, cliente_id, cliente_nombre, moneda_id, tipo_pago, metodo_pago_id, caja_id,
        subtotal, impuesto, descuento, total, monto_pagado, fecha, items_json, pagos_json, cobros_extra_json, observaciones, sincronizado, creado_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        numero,
        venta.cliente_id ?? null,
        venta.cliente_nombre || "Consumidor Final",
        venta.moneda_id,
        tipoPago,
        metodoId,
        cajaId,
        subtotal,
        impuesto,
        descuento,
        venta.total,
        montoPagado,
        fecha,
        items_json,
        pagos_json,
        cobros_extra_json,
        venta.observaciones || null,
        creado_en,
      ]
    );

    // Descontar stock localmente de forma optimista
    for (const item of venta.items) {
      await db.runAsync(
        `UPDATE productos SET stock = MAX(0, stock - ?) WHERE id = ?`,
        [item.cantidad, item.producto_id]
      );
    }

    // Si hay saldo pendiente a crédito y cliente seleccionado, reflejar crédito localmente de inmediato
    const saldoPendiente = Math.max(0, venta.total - montoPagado);
    if (saldoPendiente > 0.009 && venta.cliente_id) {
      const tempCreditoId = -Math.floor(100000 + Math.random() * 900000);
      await db.runAsync(
        `INSERT INTO creditos (id, numero, venta_id, cliente_id, fecha, fecha_vencimiento, moneda_id, monto_total, saldo, estado, actualizado_en)
         VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          tempCreditoId,
          `CRE-${numero}`,
          venta.cliente_id,
          fecha,
          venta.moneda_id,
          venta.total,
          saldoPendiente,
          montoPagado > 0.009 ? "Parcial" : "Pendiente",
          creado_en,
        ]
      );
    }
  });

  return {
    id,
    numero,
    cliente_id: venta.cliente_id ?? null,
    cliente_nombre: venta.cliente_nombre || "Consumidor Final",
    moneda_id: venta.moneda_id,
    tipo_pago: tipoPago,
    metodo_pago_id: metodoId,
    caja_id: cajaId,
    subtotal,
    impuesto,
    descuento,
    total: venta.total,
    monto_pagado: montoPagado,
    fecha,
    items_json,
    pagos_json,
    cobros_extra_json,
    observaciones: venta.observaciones || null,
    sincronizado: 0,
    creado_en,
  };
}

export async function getVentasLocales(): Promise<LocalVentaPendiente[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalVentaPendiente>(
    `SELECT * FROM ventas_locales ORDER BY creado_en DESC LIMIT 100`
  );
}

export async function markVentaSincronizada(id: string): Promise<void> {
  const db = await getMobileDb();
  await db.runAsync(`UPDATE ventas_locales SET sincronizado = 1 WHERE id = ?`, [id]);
}

export async function createOfflineAbono(payload: {
  credito_id: number;
  cliente_id: number;
  fecha: string;
  monto: number;
  moneda_id: string;
  monto_en_moneda_credito: number;
  metodo_pago_id: string | null;
  caja_id: string | null;
  lineas?: any[] | null;
  observaciones?: string | null;
}): Promise<void> {
  const db = await getMobileDb();
  const id = "abn-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
  const nowIso = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO abonos_locales (id, credito_id, fecha, monto, moneda_id, metodo_pago_id, caja_id, lineas_json, observaciones, sincronizado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        payload.credito_id,
        payload.fecha,
        payload.monto,
        payload.moneda_id,
        payload.metodo_pago_id,
        payload.caja_id,
        payload.lineas ? JSON.stringify(payload.lineas) : null,
        payload.observaciones || null,
        nowIso,
      ]
    );

    const cr = await db.getFirstAsync<{ saldo: number }>(
      `SELECT saldo FROM creditos WHERE id = ?`,
      [payload.credito_id]
    );
    if (cr) {
      const nuevoSaldo = Math.max(0, Number(cr.saldo) - payload.monto_en_moneda_credito);
      const nuevoEstado = nuevoSaldo <= 0.01 ? "Pagado" : "Parcial";
      await db.runAsync(
        `UPDATE creditos SET saldo = ?, estado = ? WHERE id = ?`,
        [nuevoSaldo, nuevoEstado, payload.credito_id]
      );
    }

    const tempAbonoId = -Math.floor(100000 + Math.random() * 900000);
    await db.runAsync(
      `INSERT INTO abonos (id, credito_id, cliente_id, fecha, monto, moneda_id, metodo_pago_id, caja_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tempAbonoId,
        payload.credito_id,
        payload.cliente_id,
        payload.fecha,
        payload.monto,
        payload.moneda_id,
        payload.metodo_pago_id,
        payload.caja_id,
        payload.observaciones || null,
      ]
    );
  });
}

export async function getAbonosLocalesPendientes(): Promise<LocalAbonoPendiente[]> {
  const db = await getMobileDb();
  return await db.getAllAsync<LocalAbonoPendiente>(
    `SELECT * FROM abonos_locales WHERE sincronizado = 0 ORDER BY creado_en ASC`
  );
}

export async function markAbonoSincronizado(id: string): Promise<void> {
  const db = await getMobileDb();
  await db.runAsync(`UPDATE abonos_locales SET sincronizado = 1 WHERE id = ?`, [id]);
}
