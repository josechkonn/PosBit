-- ============================================================================
-- POSBIT - Esquema completo de base de datos
-- ============================================================================

-- ============================================================================
-- 0. TABLAS DE BETTER AUTH
--    Se crean aquí para que el esquema sea autocontenido y funcione sobre una
--    base de datos recién creada (la tabla "user" la referencia kardex).
--    Idempotente: no interfiere con `npx @better-auth/cli migrate`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL,
    image TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
    id TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    scope TEXT,
    password TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" (identifier);

-- ============================================================================
-- 1. MONEDAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS monedas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    codigo VARCHAR(3) NOT NULL UNIQUE,
    simbolo VARCHAR(5) NOT NULL,
    tasa DECIMAL(18, 6) NOT NULL DEFAULT 1.000000,
    tasa_ref_moneda_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL,
    decimales INT NOT NULL DEFAULT 2,
    es_base BOOLEAN NOT NULL DEFAULT false,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migración: agregar columna decimales si no existe (para BD existentes)
ALTER TABLE monedas ADD COLUMN IF NOT EXISTS decimales INT NOT NULL DEFAULT 2;

-- Migración: la tasa pasa a referirse a otra moneda (NULL = USD, la base).
-- Ej.: COP tasa 3.2 referida a BS → 1 COP = 3.2/892.2342 USD (ver src/lib/money.ts)
ALTER TABLE monedas ADD COLUMN IF NOT EXISTS tasa_ref_moneda_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL;

-- Garantizar que solo una moneda sea la base
CREATE UNIQUE INDEX IF NOT EXISTS idx_monedas_es_base ON monedas (es_base) WHERE es_base = true;

-- ============================================================================
-- 2. CATEGORIAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. MARCAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS marcas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    pais VARCHAR(100),
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. PROVEEDORES
-- ============================================================================
CREATE TABLE IF NOT EXISTS proveedores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    contacto VARCHAR(200),
    email VARCHAR(200),
    telefono VARCHAR(50),
    ciudad VARCHAR(100),
    direccion TEXT,
    rif VARCHAR(50),
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migración: renombrar columna ruc_nit a rif si existe (para BD existentes)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'proveedores' AND column_name = 'ruc_nit') THEN
        ALTER TABLE proveedores RENAME COLUMN ruc_nit TO rif;
    END IF;
END $$;

-- Impedir duplicados por nombre (insensible a mayúsculas y espacios)
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores (LOWER(TRIM(nombre)));

-- ============================================================================
-- 4.5 CLIENTES
-- ============================================================================
CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'Persona Natural',
    documento VARCHAR(50),
    email VARCHAR(200),
    telefono VARCHAR(50),
    ciudad VARCHAR(100),
    direccion TEXT,
    recibe_credito BOOLEAN NOT NULL DEFAULT false,
    limite_credito DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Limites de credito de cada cliente por moneda.
-- limite = 0 significa que el cliente NO puede recibir credito en esa moneda.
CREATE TABLE IF NOT EXISTS cliente_limites_credito (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE CASCADE,
    limite DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(cliente_id, moneda_id)
);

CREATE INDEX IF NOT EXISTS idx_cliente_limites_credito
    ON cliente_limites_credito(cliente_id, moneda_id);

-- ============================================================================
-- 5. PRODUCTOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    marca_id INTEGER REFERENCES marcas(id) ON DELETE SET NULL,
    proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
    imagen VARCHAR(255),
    stock INTEGER NOT NULL DEFAULT 0,
    stock_minimo INTEGER NOT NULL DEFAULT 5,
    precio_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    costo_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    moneda_base_id INTEGER REFERENCES monedas(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    iva_incluido BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. PRODUCTO PRECIOS (precios calculados por moneda)
-- ============================================================================
CREATE TABLE IF NOT EXISTS producto_precios (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE CASCADE,
    precio DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    costo DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    UNIQUE(producto_id, moneda_id)
);

-- ============================================================================
-- 7. CAJAS (una caja por moneda)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cajas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    saldo_actual DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(20) NOT NULL DEFAULT 'Abierta',
    fecha_apertura TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_cierre TIMESTAMP,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. METODOS DE PAGO (asociados a una caja)
-- ============================================================================
CREATE TABLE IF NOT EXISTS metodos_pago (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(nombre, caja_id)
);

-- ============================================================================
-- 9. COMPRAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS compras (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) NOT NULL UNIQUE,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    metodo_pago_id INTEGER REFERENCES metodos_pago(id) ON DELETE SET NULL,
    caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
    subtotal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    tasa DECIMAL(18, 6),
    estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
    observaciones TEXT,
    referencia VARCHAR(100),
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migración: agregar columna referencia si no existe (para BD existentes)
ALTER TABLE compras ADD COLUMN IF NOT EXISTS referencia VARCHAR(100);

-- Migración: tasa aplicada en la compra (NULL = tasa por defecto de la moneda)
ALTER TABLE compras ADD COLUMN IF NOT EXISTS tasa DECIMAL(18, 6);

-- Migración: eliminar proveedores duplicados conservando el de menor id
-- y reasignando las compras al proveedor conservado (requiere tabla compras)
WITH duplicados AS (
    SELECT LOWER(TRIM(nombre)) AS nombre_key, MIN(id) AS keep_id
    FROM proveedores
    GROUP BY LOWER(TRIM(nombre))
    HAVING COUNT(*) > 1
),
a_eliminar AS (
    SELECT p.id AS del_id, d.keep_id
    FROM proveedores p
    JOIN duplicados d ON LOWER(TRIM(p.nombre)) = d.nombre_key
    WHERE p.id <> d.keep_id
),
reasignar AS (
    UPDATE compras c
    SET proveedor_id = ae.keep_id
    FROM a_eliminar ae
    WHERE c.proveedor_id = ae.del_id
)
DELETE FROM proveedores p
USING a_eliminar ae
WHERE p.id = ae.del_id;

-- ============================================================================
-- 10. COMPRA ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS compra_items (
    id SERIAL PRIMARY KEY,
    compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL,
    costo_unit DECIMAL(18, 2) NOT NULL,
    costo_unit_base DECIMAL(18, 2) NOT NULL,
    subtotal DECIMAL(18, 2) NOT NULL,
    subtotal_base DECIMAL(18, 2) NOT NULL
);

-- ============================================================================
-- 11. VENTAS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ventas (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) NOT NULL UNIQUE,
    cliente VARCHAR(200),
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    tipo_pago VARCHAR(20) NOT NULL DEFAULT 'Contado',
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    metodo_pago_id INTEGER REFERENCES metodos_pago(id) ON DELETE SET NULL,
    caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
    subtotal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    descuento DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    impuesto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    descuento_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    tasa DECIMAL(18, 6),
    estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
    observaciones TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migración: tasa aplicada en la venta (NULL = tasa por defecto de la moneda)
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tasa DECIMAL(18, 6);

-- Migración: integrar clientes en las ventas (BD existentes)
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS tipo_pago VARCHAR(20) NOT NULL DEFAULT 'Contado';
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS descuento_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

-- ============================================================================
-- 12. VENTA ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS venta_items (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL,
    precio_unit DECIMAL(18, 2) NOT NULL,
    precio_unit_base DECIMAL(18, 2) NOT NULL,
    subtotal DECIMAL(18, 2) NOT NULL,
    subtotal_base DECIMAL(18, 2) NOT NULL
);

-- ============================================================================
-- 12.5 CREDITOS (cuentas por cobrar a clientes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS creditos (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) NOT NULL UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    monto_total DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    saldo DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    total_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    saldo_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 12.6 RETORNOS (devoluciones de clientes y a proveedores)
-- ============================================================================
CREATE TABLE IF NOT EXISTS retornos (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(50) NOT NULL UNIQUE,
    tipo VARCHAR(20) NOT NULL DEFAULT 'Cliente',
    venta_id INTEGER REFERENCES ventas(id) ON DELETE SET NULL,
    compra_id INTEGER REFERENCES compras(id) ON DELETE SET NULL,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    motivo TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'Procesado',
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retorno_items (
    id SERIAL PRIMARY KEY,
    retorno_id INTEGER NOT NULL REFERENCES retornos(id) ON DELETE CASCADE,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL,
    precio_unit DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    precio_unit_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    subtotal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    subtotal_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00
);

-- ============================================================================
-- 12.7 ABONOS (pagos realizados sobre creditos / retornos a clientes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS abonos (
    id SERIAL PRIMARY KEY,
    credito_id INTEGER NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    retorno_id INTEGER REFERENCES retornos(id) ON DELETE SET NULL,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    monto DECIMAL(18, 2) NOT NULL,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    metodo_pago_id INTEGER REFERENCES metodos_pago(id) ON DELETE SET NULL,
    caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
    observaciones TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 12.8 PAGOS DE VENTAS (permite pago mixto: una venta cobrada en varias monedas)
-- ============================================================================
-- Una venta puede tener varios pagos; cada línea guarda lo entregado en la
-- moneda de SU método de pago y cuánto de eso aplicó a la venta (convertido a
-- la moneda de la venta). El excedente queda en `vuelto` (en la moneda del
-- método). Ej.: venta 40.000 COP → línea COP 20.000 + línea BS 5.000
-- (= 16.000 COP) y la deuda restante es 4.000 COP.
CREATE TABLE IF NOT EXISTS venta_pagos (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    metodo_pago_id INTEGER REFERENCES metodos_pago(id) ON DELETE SET NULL,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    monto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,          -- entregado en la moneda del método
    monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,     -- entregado en USD
    monto_aplicado DECIMAL(18, 2) NOT NULL DEFAULT 0.00, -- aplicado a la venta (moneda de la venta)
    vuelto DECIMAL(18, 2) NOT NULL DEFAULT 0.00,         -- devuelto en la moneda del método
    tasa DECIMAL(18, 6),                                 -- tasa usada: unidades del método por 1 unidad de la venta
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venta_pagos_venta ON venta_pagos(venta_id);

-- ============================================================================
-- 13. KARDEX (movimientos de inventario)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kardex (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    fecha TIMESTAMP NOT NULL DEFAULT NOW(),
    tipo VARCHAR(20) NOT NULL,
    motivo VARCHAR(200),
    referencia_tipo VARCHAR(50),
    referencia_id INTEGER,
    cantidad INTEGER NOT NULL,
    costo_unit DECIMAL(18, 2) NOT NULL,
    costo_unit_base DECIMAL(18, 2) NOT NULL,
    saldo_anterior INTEGER NOT NULL,
    saldo_actual INTEGER NOT NULL,
    creado_por TEXT REFERENCES "user"(id) ON DELETE SET NULL
);

-- ============================================================================
-- 14. TRANSACCIONES (movimientos de dinero por caja)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transacciones (
    id SERIAL PRIMARY KEY,
    caja_id INTEGER NOT NULL REFERENCES cajas(id) ON DELETE RESTRICT,
    fecha TIMESTAMP NOT NULL DEFAULT NOW(),
    tipo VARCHAR(30) NOT NULL,
    monto DECIMAL(18, 2) NOT NULL,
    moneda_id INTEGER NOT NULL REFERENCES monedas(id) ON DELETE RESTRICT,
    monto_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    tasa DECIMAL(18, 6),
    descripcion TEXT,
    referencia_tipo VARCHAR(50),
    referencia_id INTEGER,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migración: tasa usada para el pase a base (puede ser personalizada en la venta/compra)
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS tasa DECIMAL(18, 6);

-- ============================================================================
-- 15. CIERRES DE CAJA
-- ============================================================================
CREATE TABLE IF NOT EXISTS cierres_caja (
    id SERIAL PRIMARY KEY,
    caja_id INTEGER NOT NULL REFERENCES cajas(id) ON DELETE RESTRICT,
    fecha_apertura TIMESTAMP NOT NULL,
    fecha_cierre TIMESTAMP NOT NULL DEFAULT NOW(),
    saldo_apertura DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_entradas DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_salidas DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    saldo_cierre DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_entradas_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    total_salidas_base DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
    observaciones TEXT,
    creado_por INTEGER,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 16. CONFIGURACION (ajustes generales del sistema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS configuracion (
    id SERIAL PRIMARY KEY,
    clave VARCHAR(100) NOT NULL UNIQUE,
    valor TEXT,
    tipo VARCHAR(50) NOT NULL,
    descripcion TEXT,
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TRIGGER PARA ACTUALIZAR actualizado_en
--   La función se define aquí, antes del primer trigger que la usa.
-- ============================================================================
CREATE OR REPLACE FUNCTION actualizar_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_configuracion_actualizado ON configuracion;
CREATE TRIGGER trg_configuracion_actualizado BEFORE UPDATE ON configuracion
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

-- Datos iniciales de configuracion
INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
    ('empresa_nombre', 'PosBit', 'empresa', 'Nombre de la empresa'),
    ('empresa_nit', '', 'empresa', 'RIF de la empresa'),
    ('empresa_direccion', '', 'empresa', 'Direccion de la empresa'),
    ('empresa_ciudad', '', 'empresa', 'Ciudad'),
    ('empresa_telefono', '', 'empresa', 'Telefono de contacto'),
    ('empresa_email', '', 'empresa', 'Email de contacto'),
    ('inventario_stock_minimo', '5', 'inventario', 'Stock minimo por defecto'),
    ('inventario_alertas_stock', 'true', 'inventario', 'Activar alertas de stock bajo'),
    ('inventario_metodo_costeo', 'FIFO', 'inventario', 'Metodo de costeo (FIFO, LIFO, Promedio)'),
    ('impuesto_iva', '16.00', 'impuesto', 'Porcentaje de IVA aplicado a productos con IVA excluido')
ON CONFLICT (clave) DO NOTHING;

-- ============================================================================
-- INDICES PARA RENDIMIENTO
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_marca ON productos(marca_id);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo);
CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);

CREATE INDEX IF NOT EXISTS idx_producto_precios_producto ON producto_precios(producto_id);
CREATE INDEX IF NOT EXISTS idx_producto_precios_moneda ON producto_precios(moneda_id);

CREATE INDEX IF NOT EXISTS idx_cajas_moneda ON cajas(moneda_id);
CREATE INDEX IF NOT EXISTS idx_cajas_estado ON cajas(estado);

CREATE INDEX IF NOT EXISTS idx_metodos_pago_caja ON metodos_pago(caja_id);

CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_moneda ON compras(moneda_id);
CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras(fecha);
CREATE INDEX IF NOT EXISTS idx_compras_estado ON compras(estado);
CREATE INDEX IF NOT EXISTS idx_compras_caja ON compras(caja_id);

CREATE INDEX IF NOT EXISTS idx_compra_items_compra ON compra_items(compra_id);
CREATE INDEX IF NOT EXISTS idx_compra_items_producto ON compra_items(producto_id);

CREATE INDEX IF NOT EXISTS idx_ventas_moneda ON ventas(moneda_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_caja ON ventas(caja_id);

CREATE INDEX IF NOT EXISTS idx_venta_items_venta ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_producto ON venta_items(producto_id);

CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
CREATE INDEX IF NOT EXISTS idx_clientes_documento ON clientes(documento);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(activo);

CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);

CREATE INDEX IF NOT EXISTS idx_creditos_cliente ON creditos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_creditos_estado ON creditos(estado);
CREATE INDEX IF NOT EXISTS idx_creditos_venta ON creditos(venta_id);

CREATE INDEX IF NOT EXISTS idx_abonos_credito ON abonos(credito_id);
CREATE INDEX IF NOT EXISTS idx_abonos_cliente ON abonos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_abonos_retorno ON abonos(retorno_id);

CREATE INDEX IF NOT EXISTS idx_retornos_tipo ON retornos(tipo);
CREATE INDEX IF NOT EXISTS idx_retornos_cliente ON retornos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_retornos_proveedor ON retornos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_retornos_venta ON retornos(venta_id);
CREATE INDEX IF NOT EXISTS idx_retornos_compra ON retornos(compra_id);

CREATE INDEX IF NOT EXISTS idx_retorno_items_retorno ON retorno_items(retorno_id);
CREATE INDEX IF NOT EXISTS idx_retorno_items_producto ON retorno_items(producto_id);

CREATE INDEX IF NOT EXISTS idx_kardex_producto ON kardex(producto_id);
CREATE INDEX IF NOT EXISTS idx_kardex_fecha ON kardex(fecha);
CREATE INDEX IF NOT EXISTS idx_kardex_tipo ON kardex(tipo);

CREATE INDEX IF NOT EXISTS idx_transacciones_caja ON transacciones(caja_id);
CREATE INDEX IF NOT EXISTS idx_transacciones_fecha ON transacciones(fecha);
CREATE INDEX IF NOT EXISTS idx_transacciones_tipo ON transacciones(tipo);
CREATE INDEX IF NOT EXISTS idx_transacciones_moneda ON transacciones(moneda_id);

CREATE INDEX IF NOT EXISTS idx_cierres_caja_caja ON cierres_caja(caja_id);
CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha ON cierres_caja(fecha_cierre);

-- ============================================================================
-- TRIGGER PARA ACTUALIZAR actualizado_en
-- ============================================================================
DROP TRIGGER IF EXISTS trg_monedas_actualizado ON monedas;
CREATE TRIGGER trg_monedas_actualizado BEFORE UPDATE ON monedas
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_categorias_actualizado ON categorias;
CREATE TRIGGER trg_categorias_actualizado BEFORE UPDATE ON categorias
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_marcas_actualizado ON marcas;
CREATE TRIGGER trg_marcas_actualizado BEFORE UPDATE ON marcas
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_proveedores_actualizado ON proveedores;
CREATE TRIGGER trg_proveedores_actualizado BEFORE UPDATE ON proveedores
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_productos_actualizado ON productos;
CREATE TRIGGER trg_productos_actualizado BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_cajas_actualizado ON cajas;
CREATE TRIGGER trg_cajas_actualizado BEFORE UPDATE ON cajas
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_metodos_pago_actualizado ON metodos_pago;
CREATE TRIGGER trg_metodos_pago_actualizado BEFORE UPDATE ON metodos_pago
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_compras_actualizado ON compras;
CREATE TRIGGER trg_compras_actualizado BEFORE UPDATE ON compras
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_ventas_actualizado ON ventas;
CREATE TRIGGER trg_ventas_actualizado BEFORE UPDATE ON ventas
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_clientes_actualizado ON clientes;
CREATE TRIGGER trg_clientes_actualizado BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_creditos_actualizado ON creditos;
CREATE TRIGGER trg_creditos_actualizado BEFORE UPDATE ON creditos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();
DROP TRIGGER IF EXISTS trg_retornos_actualizado ON retornos;
CREATE TRIGGER trg_retornos_actualizado BEFORE UPDATE ON retornos
    FOR EACH ROW EXECUTE FUNCTION actualizar_actualizado_en();

-- ============================================================================
-- DATOS INICIALES
-- ============================================================================

-- Monedas (USD como base).
-- La tasa es "cuántas unidades de la moneda por 1 unidad de SU REFERENCIA"
-- (NULL = USD). Ver src/lib/money.ts para la cadena completa.
--   USD: 1 por USD · BS: 892.2342 por USD · COP: 3.2 por BS
INSERT INTO monedas (nombre, codigo, simbolo, tasa, es_base, activo) VALUES
    ('Dólar Estadounidense', 'USD', '$', 1.000000, true, true),
    ('Bolivar Soberano', 'VES', 'Bs.', 892.234200, false, true),
    ('Peso Colombiano', 'COP', '$', 3.200000, false, true)
ON CONFLICT (codigo) DO NOTHING;

-- Migración de tasas legacy (36.5 BS/USD y 4200 COP/USD) al modelo encadenado.
-- Solo toca las que siguen con los valores antiguos: no pisa tasas ya editadas.
UPDATE monedas SET tasa = 892.234200 WHERE codigo = 'VES' AND tasa = 36.500000;
UPDATE monedas SET tasa = 3.200000 WHERE codigo = 'COP' AND tasa = 4200.000000;

-- COP pasa a referenciar a BS (NULL = USD)
UPDATE monedas
SET tasa_ref_moneda_id = (SELECT id FROM monedas WHERE codigo = 'VES')
WHERE codigo = 'COP' AND tasa = 3.200000 AND tasa_ref_moneda_id IS NULL;

-- Migracion unica: el limite de credito antiguo (un solo numero) pasa a ser
-- el limite en la moneda base. No se pisa si ya se edito en la nueva tabla.
INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite)
SELECT cl.id, mo.id, cl.limite_credito
FROM clientes cl
JOIN monedas mo ON mo.es_base = true
WHERE cl.limite_credito > 0
ON CONFLICT (cliente_id, moneda_id) DO NOTHING;

-- Cajas (una por moneda activa)
INSERT INTO cajas (nombre, moneda_id, saldo_actual, estado)
SELECT
    'Caja ' || m.codigo,
    m.id,
    0.00,
    'Abierta'
FROM monedas m
WHERE m.activo = true
ON CONFLICT (nombre) DO NOTHING;

-- Metodos de pago iniciales (uno por tipo por caja)
-- Exclusiones del negocio: no se crean "Transferencia USD" ni "Efectivo VES"
-- (efectivo en Bs.); esos métodos se usan en cajas que ya existan o se
-- agregan manualmente desde el módulo de Métodos de Pago.
INSERT INTO metodos_pago (nombre, tipo, caja_id)
SELECT
    t.tipo_nombre || ' ' || m.codigo,
    t.tipo,
    c.id
FROM (VALUES ('Efectivo', 'Efectivo'), ('Transferencia', 'Electronico'), ('Tarjeta', 'Tarjeta')) AS t(tipo_nombre, tipo)
CROSS JOIN monedas m
JOIN cajas c ON c.moneda_id = m.id
WHERE m.activo = true
  AND NOT (t.tipo_nombre = 'Transferencia' AND m.codigo = 'USD')
  AND NOT (t.tipo_nombre = 'Efectivo' AND m.codigo = 'VES')
ON CONFLICT (nombre, caja_id) DO NOTHING;

-- Exclusiones del negocio: se eliminan si existieran de una version anterior
-- (las referencias en ventas/abonos quedan en NULL, no se borra historial)
DELETE FROM metodos_pago
WHERE nombre IN ('Transferencia USD', 'Efectivo VES');
