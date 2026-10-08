// ============================================================================
// POSBIT - Seed de datos de demostración
// Llena TODAS las tablas del negocio con datos realistas y coherentes:
//   - Stock de productos <-> Kardex <-> Compras/Ventas/Retornos
//   - Saldos de caja <-> Transacciones
//   - Créditos <-> Abonos
// Uso: node scripts/seed-demo.cjs
// ============================================================================
require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env.local") });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().split("T")[0];

let creditoSeq = 0;
function numeroCredito() {
  creditoSeq += 1;
  return `CRE-2026-${String(creditoSeq).padStart(4, "0")}`;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- Asegurar columna proveedor_id en productos (la usa la app, faltaba en el esquema) ---
    await client.query(
      `ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL`
    );

    // --- 0. Reset de tablas de negocio (conserva monedas, cajas, metodos_pago, config, users) ---
    await client.query(`
      TRUNCATE TABLE cierres_caja, transacciones, abonos, retorno_items, retornos,
        creditos, venta_items, ventas, compra_items, compras,
        producto_precios, kardex, productos, clientes, proveedores, marcas,
        categorias, metodos_pago
      RESTART IDENTITY CASCADE
    `);

    await client.query(
      `UPDATE cajas SET saldo_actual = 0.00, estado = 'Abierta', fecha_apertura = NOW() - INTERVAL '30 days', fecha_cierre = NULL`
    );

    // --- 1. Monedas ---
    const monedas = {};
    const monedasArr = [];
    const { rows: monedasRows } = await client.query(
      `SELECT id, codigo, tasa, es_base, simbolo FROM monedas WHERE activo = true`
    );
    for (const m of monedasRows) {
      monedas[m.codigo] = m;
      monedasArr.push(m);
    }
    const USD = monedas["USD"];
    const VES = monedas["VES"];

    // --- 2. Cajas + Métodos de pago ---
    const { rows: cajasRows } = await client.query(`SELECT id, moneda_id FROM cajas ORDER BY moneda_id`);
    for (const c of cajasRows) {
      const mon = monedasArr.find((m) => m.id === c.moneda_id);
      for (const [tipoNombre, tipo] of [["Efectivo", "Efectivo"], ["Transferencia", "Electronico"], ["Tarjeta", "Tarjeta"]]) {
        await client.query(
          `INSERT INTO metodos_pago (nombre, tipo, caja_id, activo) VALUES ($1, $2, $3, true)`,
          [`${tipoNombre} ${mon.codigo}`, tipo, c.id]
        );
      }
    }
    const { rows: metodosRows } = await client.query(`SELECT id, nombre, caja_id FROM metodos_pago`);
    const metodos = {};
    for (const mp of metodosRows) metodos[mp.nombre] = mp;

    // --- 3. Categorías ---
    const categorias = [
      ["Abarrotes", "Productos básicos de despensa"],
      ["Bebidas", "Refrescos, aguas y jugos"],
      ["Lácteos y Huevos", "Leche, quesos, yogurt y huevos"],
      ["Carnes y Embutidos", "Carnes, embutidos y productos fríos"],
      ["Panadería y Repostería", "Panes y productos de panadería"],
      ["Limpieza", "Productos de limpieza del hogar"],
      ["Cuidado Personal", "Artículos de higiene personal"],
      ["Snacks y Galletas", "Golosinas, snacks y galletas"],
      ["Conservas y Enlatados", "Alimentos enlatados y conservas"],
      ["Condimentos y Salsas", "Salsas y condimentos"],
      ["Bebidas Alcohólicas", "Cervezas, licores y vinos"],
      ["Mascotas", "Alimentos y accesorios para mascotas"],
    ];
    const catMap = {};
    for (const [nombre, descripcion] of categorias) {
      const r = await client.query(
        `INSERT INTO categorias (nombre, descripcion, activo) VALUES ($1, $2, true) RETURNING id`,
        [nombre, descripcion]
      );
      catMap[nombre] = r.rows[0].id;
    }

    // --- 4. Marcas ---
    const marcas = [
      ["Polar", "Venezuela"],
      ["Nestlé", "Suiza"],
      ["Kraft Heinz", "Estados Unidos"],
      ["Mondelez", "Estados Unidos"],
      ["Coca-Cola", "Estados Unidos"],
      ["PepsiCo", "Estados Unidos"],
      ["Alpina", "Colombia"],
      ["Danone", "Francia"],
      ["Kimberly-Clark", "Estados Unidos"],
      ["Colgate-Palmolive", "Estados Unidos"],
      ["Bimbo", "México"],
      ["Unilever", "Países Bajos"],
      ["Diageo", "Reino Unido"],
      ["Purina", "Estados Unidos"],
      ["Incalsa", "Venezuela"],
      ["Plumrose", "Venezuela"],
    ];
    const marcaMap = {};
    for (const [nombre, pais] of marcas) {
      const r = await client.query(
        `INSERT INTO marcas (nombre, pais, activo) VALUES ($1, $2, true) RETURNING id`,
        [nombre, pais]
      );
      marcaMap[nombre] = r.rows[0].id;
    }

    // --- 5. Proveedores ---
    const proveedores = [
      ["Distribuidora Polar C.A.", "Juan Pérez", "compras@polar.com.ve", "+58 212-555-0101", "Caracas", "Av. Principal, Zona Industrial La Yaguara", "J-00012345-6"],
      ["Nestlé Venezuela S.A.", "María López", "ventas@nestle.com.ve", "+58 212-555-0102", "Caracas", "Av. Vollmer, San Bernardino", "J-00023456-7"],
      ["Cervecería Regional C.A.", "Carlos González", "pedidos@regional.com.ve", "+58 261-555-0103", "Maracaibo", "Carretera La Cañada, Zona Industrial", "J-00034567-8"],
      ["Distribuidora Maxi Alimentos", "Ana Martínez", "contacto@maxialimentos.com", "+58 241-555-0104", "Valencia", "Av. Bolívar Norte, Centro Comercial", "J-00045678-9"],
      ["Almacén San Miguel C.A.", "Pedro Rodríguez", "info@sanmiguel.com.ve", "+58 251-555-0105", "Barquisimeto", "Carrera 19 entre Calles 27 y 28", "J-00056789-0"],
      ["Suministros Industriales JL", "Rosa Hernández", "ventas@sumijl.com", "+58 243-555-0106", "Maracay", "Av. Constitución, Zona Industrial", "J-00067890-1"],
      ["Distribuidora El Águila", "Luis Fernández", "pedidos@elaguila.com.ve", "+58 212-555-0107", "Caracas", "Calle 10, Los Ruices", "J-00078901-2"],
      ["Grupo Santa Elena C.A.", "Carmen Díaz", "comercial@santaelena.com", "+58 241-555-0108", "Valencia", "Urb. El Viñedo, Av. Principal", "J-00089012-3"],
      ["Importadora Panamá S.A.", "Jorge Salas", "contacto@importadorapanama.com", "+58 261-555-0109", "Maracaibo", "Av. El Milagro, Sector Centro", "J-00090123-4"],
      ["Bodegas del Este C.A.", "Laura Rivas", "ventas@bodegasdeleste.com", "+58 212-555-0110", "Caracas", "Av. Francisco de Miranda, El Rosal", "J-00101234-5"],
    ];
    const provMap = {};
    for (const [nombre, contacto, email, telefono, ciudad, direccion, rif] of proveedores) {
      const r = await client.query(
        `INSERT INTO proveedores (nombre, contacto, email, telefono, ciudad, direccion, rif, activo) VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
        [nombre, contacto, email, telefono, ciudad, direccion, rif]
      );
      provMap[nombre] = r.rows[0].id;
    }

    // --- 6. Clientes ---
    const clientes = [
      ["José Luis Rodríguez", "Persona Natural", "V-12345678", "jose.rodriguez@gmail.com", "+58 412-111-2233", "Caracas", "Urb. Las Mercedes, Calle Veracruz", false, 0],
      ["María Fernanda Gómez", "Persona Natural", "V-23456789", "mafer.gomez@hotmail.com", "+58 414-222-3344", "Valencia", "Urb. Prebo, Av. 108", true, 500],
      ["Comercial Los Andes C.A.", "Persona Jurídica", "J-30123456-7", "ventas@losandes.com.ve", "+58 243-333-4455", "Maracay", "Zona Industrial San Vicente", true, 2000],
      ["Ana Carolina Pérez", "Persona Natural", "V-14567890", "ana.perez@gmail.com", "+58 416-444-5566", "Maracaibo", "Urb. San Francisco, Av. 5", false, 0],
      ["Distribuidora El Progreso C.A.", "Persona Jurídica", "J-30456789-1", "compras@elprogreso.com", "+58 251-555-6677", "Barquisimeto", "Av. Vargas, Sector Centro", true, 3000],
      ["Carlos Eduardo Méndez", "Persona Natural", "V-16789012", "carlos.mendez@yahoo.com", "+58 424-666-7788", "Caracas", "Parroquia El Valle, Av. Intercomunal", false, 0],
      ["Supermercado La Colina S.A.", "Persona Jurídica", "J-31012345-4", "pedidos@lacolina.com", "+58 212-777-8899", "Caracas", "Av. Andrés Bello, Los Palos Grandes", true, 5000],
      ["Rosa María Castillo", "Persona Natural", "V-18901234", "rosa.castillo@gmail.com", "+58 414-888-9900", "Valencia", "Urb. La Alegría, Calle 90", false, 0],
      ["Ferretería El Tornillo C.A.", "Persona Jurídica", "J-31234567-9", "info@eltornillo.com", "+58 261-999-0011", "Maracaibo", "Av. 15 La Delicias", true, 1500],
      ["Pedro José Herrera", "Persona Natural", "V-20123456", "pedro.herrera@outlook.com", "+58 412-000-1122", "Caracas", "Catia, Av. Principal de Propatria", false, 0],
    ];
    const clienteMap = {};
    for (const [nombre, tipo, documento, email, telefono, ciudad, direccion, recibeCredito, limite] of clientes) {
      const r = await client.query(
        `INSERT INTO clientes (nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito, limite_credito, activo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
        [nombre, tipo, documento, email, telefono, ciudad, direccion, recibeCredito, limite]
      );
      clienteMap[nombre] = r.rows[0].id;
    }

    // --- 7. Productos (68) ---
    // [codigo, nombre, descripcion, categoria, marca, proveedor, stock_comprado, stock_minimo, precio_base, costo_base]
    const P = [
      ["PR-0001", "Arroz Blanco Polar 1kg", "Arroz blanco de primera calidad, bolsa 1kg", "Abarrotes", "Polar", "Distribuidora Polar C.A.", 120, 20, 1.85, 1.30],
      ["PR-0002", "Harina de Maíz Precocida 1kg", "Harina de maíz precocida para arepas", "Abarrotes", "Polar", "Distribuidora Polar C.A.", 90, 20, 2.10, 1.50],
      ["PR-0003", "Aceite Vegetal 1L", "Aceite vegetal comestible, botella 1L", "Abarrotes", "Kraft Heinz", "Distribuidora Maxi Alimentos", 60, 15, 3.50, 2.40],
      ["PR-0004", "Azúcar Refinada 1kg", "Azúcar refinada blanca, bolsa 1kg", "Abarrotes", "Kraft Heinz", "Distribuidora Maxi Alimentos", 150, 25, 1.60, 1.10],
      ["PR-0005", "Sal Fina 1kg", "Sal fina de mesa, paquete 1kg", "Abarrotes", "Kraft Heinz", "Almacén San Miguel C.A.", 200, 30, 0.90, 0.60],
      ["PR-0006", "Pasta Espagueti 500g", "Espagueti de sémola, paquete 500g", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 100, 20, 1.20, 0.80],
      ["PR-0007", "Café Molido 250g", "Café 100% arábica tostado y molido", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 45, 10, 4.50, 3.20],
      ["PR-0008", "Fideos Tirabuzón 500g", "Pasta corta tipo tirabuzón 500g", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 80, 20, 1.30, 0.85],
      ["PR-0009", "Leche en Polvo Entera 400g", "Leche entera en polvo instantánea", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 35, 10, 5.90, 4.10],
      ["PR-0010", "Sopa Instantánea 4 Sobres", "Sopa instantánea de pollo, caja x4", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 70, 15, 1.10, 0.75],
      ["PR-0011", "Cereal Corn Flakes 300g", "Hojuelas de maíz, caja 300g", "Abarrotes", "Nestlé", "Nestlé Venezuela S.A.", 55, 12, 3.40, 2.30],
      ["PR-0012", "Mayonesa 445g", "Mayonesa cremosa, frasco 445g", "Abarrotes", "Kraft Heinz", "Distribuidora Maxi Alimentos", 65, 15, 2.80, 1.90],
      ["PR-0013", "Agua Mineral 5L", "Agua mineral sin gas, botellón 5L", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 80, 15, 2.60, 1.70],
      ["PR-0014", "Gaseosa Cola 2L", "Refresco sabor cola, botella 2L", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 130, 25, 2.40, 1.60],
      ["PR-0015", "Gaseosa Sabor Naranja 2L", "Refresco sabor naranja, botella 2L", "Bebidas", "PepsiCo", "Distribuidora El Águila", 75, 15, 2.20, 1.45],
      ["PR-0016", "Jugo de Naranja 1L", "Jugo de naranja 100% natural, caja 1L", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 40, 10, 3.10, 2.10],
      ["PR-0017", "Malta 355ml", "Malta refrescante, lata 355ml", "Bebidas", "Polar", "Distribuidora Polar C.A.", 200, 40, 1.15, 0.78],
      ["PR-0018", "Refresco Cero Azúcar 2L", "Refresco sabor cola sin azúcar, 2L", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 60, 12, 2.40, 1.60],
      ["PR-0019", "Té Helado Limón 1L", "Té helado sabor limón, botella 1L", "Bebidas", "PepsiCo", "Distribuidora El Águila", 45, 10, 2.30, 1.55],
      ["PR-0020", "Agua Mineral Personal (Pack x6)", "Pack x6 botellas de agua 500ml", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 90, 18, 3.90, 2.60],
      ["PR-0021", "Bebida Isotónica 750ml", "Bebida isotónica sabor naranja", "Bebidas", "PepsiCo", "Distribuidora El Águila", 50, 12, 2.10, 1.40],
      ["PR-0022", "Soda Club Soda 1.5L", "Agua carbonatada, botella 1.5L", "Bebidas", "Coca-Cola", "Distribuidora El Águila", 55, 12, 2.50, 1.65],
      ["PR-0023", "Leche Entera 1L", "Leche entera pasteurizada, tetra 1L", "Lácteos y Huevos", "Alpina", "Distribuidora Maxi Alimentos", 110, 20, 1.95, 1.35],
      ["PR-0024", "Queso Blanco Duro 500g", "Queso blanco duro artesanal", "Lácteos y Huevos", "Alpina", "Distribuidora Maxi Alimentos", 5, 8, 4.20, 3.00],
      ["PR-0025", "Mantequilla 500g", "Mantequilla con sal, barra 500g", "Lácteos y Huevos", "Alpina", "Distribuidora Maxi Alimentos", 35, 8, 3.80, 2.70],
      ["PR-0026", "Yogur Batido 1L", "Yogur batido sabor fresa, 1L", "Lácteos y Huevos", "Danone", "Distribuidora Maxi Alimentos", 40, 10, 3.20, 2.20],
      ["PR-0027", "Leche Condensada 397g", "Leche condensada dulce, lata 397g", "Lácteos y Huevos", "Nestlé", "Nestlé Venezuela S.A.", 85, 15, 2.50, 1.70],
      ["PR-0028", "Crema de Leche 250ml", "Crema de leche para cocinar, 250ml", "Lácteos y Huevos", "Alpina", "Distribuidora Maxi Alimentos", 60, 12, 2.10, 1.45],
      ["PR-0029", "Queso Mozzarella Rallado 300g", "Queso mozzarella rallado, bolsa 300g", "Lácteos y Huevos", "Danone", "Distribuidora Maxi Alimentos", 6, 8, 3.60, 2.50],
      ["PR-0030", "Huevos Blancos Docena", "Docena de huevos blancos de granja", "Lácteos y Huevos", "Danone", "Almacén San Miguel C.A.", 95, 20, 3.90, 2.80],
      ["PR-0031", "Jamón Planchado 400g", "Jamón planchado, empaque 400g", "Carnes y Embutidos", "Plumrose", "Grupo Santa Elena C.A.", 40, 10, 3.95, 2.80],
      ["PR-0032", "Salchichas de Pollo 350g", "Salchichas de pollo, empaque 350g", "Carnes y Embutidos", "Plumrose", "Grupo Santa Elena C.A.", 70, 15, 2.30, 1.60],
      ["PR-0033", "Mortadela 500g", "Mortadela clásica, empaque 500g", "Carnes y Embutidos", "Plumrose", "Grupo Santa Elena C.A.", 65, 15, 2.10, 1.45],
      ["PR-0034", "Pollo Entero Congelado 1.5kg", "Pollo entero congelado, pieza 1.5kg", "Carnes y Embutidos", "Incalsa", "Grupo Santa Elena C.A.", 30, 8, 5.50, 4.00],
      ["PR-0035", "Carne Molida de Res 500g", "Carne molida de res de primera, 500g", "Carnes y Embutidos", "Incalsa", "Grupo Santa Elena C.A.", 7, 10, 6.20, 4.60],
      ["PR-0036", "Pan Blanco Grande", "Pan blanco de molde grande", "Panadería y Repostería", "Bimbo", "Importadora Panamá S.A.", 45, 10, 2.90, 2.00],
      ["PR-0037", "Pan Integral Rebanado", "Pan integral rebanado, paquete 500g", "Panadería y Repostería", "Bimbo", "Importadora Panamá S.A.", 40, 10, 3.20, 2.25],
      ["PR-0038", "Tostadas de Pan 300g", "Galletas tostadas de pan, 300g", "Panadería y Repostería", "Bimbo", "Importadora Panamá S.A.", 75, 15, 1.90, 1.30],
      ["PR-0039", "Galletas de Soda", "Galletas de soda clásicas, paquete", "Panadería y Repostería", "Bimbo", "Importadora Panamá S.A.", 90, 18, 1.75, 1.20],
      ["PR-0040", "Pan Hot Dog", "Pan para hot dog, paquete x8", "Panadería y Repostería", "Bimbo", "Importadora Panamá S.A.", 60, 12, 2.10, 1.45],
      ["PR-0041", "Papel Higiénico x4", "Rollo de papel higiénico, paquete x4", "Limpieza", "Kimberly-Clark", "Suministros Industriales JL", 55, 15, 4.90, 3.40],
      ["PR-0042", "Jabón en Barra x3", "Jabón de tocador, paquete x3", "Limpieza", "Colgate-Palmolive", "Suministros Industriales JL", 130, 25, 1.60, 1.10],
      ["PR-0043", "Detergente en Polvo 1kg", "Detergente en polvo multiusos, 1kg", "Limpieza", "Unilever", "Suministros Industriales JL", 60, 15, 3.80, 2.60],
      ["PR-0044", "Suavizante 1L", "Suavizante de telas, botella 1L", "Limpieza", "Unilever", "Suministros Industriales JL", 45, 10, 3.10, 2.10],
      ["PR-0045", "Cloro 1L", "Cloro desinfectante, botella 1L", "Limpieza", "Unilever", "Suministros Industriales JL", 100, 20, 1.20, 0.80],
      ["PR-0046", "Limpiador Multiusos 1L", "Limpiador multiusos cítrico, 1L", "Limpieza", "Colgate-Palmolive", "Suministros Industriales JL", 70, 15, 2.20, 1.50],
      ["PR-0047", "Pasta Dental 90ml", "Pasta dental blanqueadora, tubo 90ml", "Cuidado Personal", "Colgate-Palmolive", "Suministros Industriales JL", 140, 30, 1.80, 1.25],
      ["PR-0048", "Jabón Líquido 1L", "Jabón líquido para manos, 1L", "Cuidado Personal", "Unilever", "Suministros Industriales JL", 55, 12, 3.30, 2.30],
      ["PR-0049", "Champú 400ml", "Champú para cabello normal, 400ml", "Cuidado Personal", "Unilever", "Suministros Industriales JL", 48, 10, 3.60, 2.50],
      ["PR-0050", "Desodorante Spray", "Desodorante spray protección 48h", "Cuidado Personal", "Unilever", "Suministros Industriales JL", 52, 12, 3.10, 2.15],
      ["PR-0051", "Cepillo Dental", "Cepillo dental suave, unidad", "Cuidado Personal", "Colgate-Palmolive", "Suministros Industriales JL", 110, 22, 1.45, 1.00],
      ["PR-0052", "Galletas Rellenas Chocolate", "Galletas rellenas de crema de chocolate", "Snacks y Galletas", "Mondelez", "Almacén San Miguel C.A.", 120, 25, 1.95, 1.35],
      ["PR-0053", "Papas Fritas 120g", "Papas fritas clásicas, bolsa 120g", "Snacks y Galletas", "PepsiCo", "Distribuidora El Águila", 95, 20, 1.70, 1.15],
      ["PR-0054", "Palitos Salados 200g", "Palitos salados estilo pretzel, 200g", "Snacks y Galletas", "Mondelez", "Almacén San Miguel C.A.", 80, 15, 1.25, 0.85],
      ["PR-0055", "Barra de Cereal x6", "Barra de cereal con chocolate, x6", "Snacks y Galletas", "Mondelez", "Almacén San Miguel C.A.", 5, 8, 2.40, 1.65],
      ["PR-0056", "Chocolatina x12", "Chocolatina con maní, paquete x12", "Snacks y Galletas", "Nestlé", "Nestlé Venezuela S.A.", 65, 12, 3.90, 2.70],
      ["PR-0057", "Sardinas en Salsa 425g", "Sardinas en salsa de tomate, lata 425g", "Conservas y Enlatados", "Incalsa", "Bodegas del Este C.A.", 85, 18, 3.20, 2.25],
      ["PR-0058", "Maíz Dulce Lata 300g", "Maíz dulce en grano, lata 300g", "Conservas y Enlatados", "Kraft Heinz", "Distribuidora Maxi Alimentos", 95, 20, 1.85, 1.28],
      ["PR-0059", "Frijoles Negros Refritos 400g", "Frijoles negros refritos, lata 400g", "Conservas y Enlatados", "Kraft Heinz", "Distribuidora Maxi Alimentos", 100, 20, 1.95, 1.35],
      ["PR-0060", "Salsa de Tomate 350g", "Salsa de tomate condimentada, 350g", "Conservas y Enlatados", "Kraft Heinz", "Distribuidora Maxi Alimentos", 140, 25, 1.50, 1.05],
      ["PR-0061", "Cerveza Lata x6 355ml", "Pack x6 latas de cerveza 355ml", "Bebidas Alcohólicas", "Polar", "Distribuidora Polar C.A.", 90, 18, 5.60, 4.00],
      ["PR-0062", "Ron Añejo 750ml", "Ron añejo premium, botella 750ml", "Bebidas Alcohólicas", "Diageo", "Cervecería Regional C.A.", 30, 8, 14.90, 11.50],
      ["PR-0063", "Whisky Escocés 750ml", "Whisky escocés mezclado, 750ml", "Bebidas Alcohólicas", "Diageo", "Cervecería Regional C.A.", 20, 5, 24.50, 19.90],
      ["PR-0064", "Vino Tinto 750ml", "Vino tinto de mesa, botella 750ml", "Bebidas Alcohólicas", "Diageo", "Cervecería Regional C.A.", 35, 10, 8.90, 6.80],
      ["PR-0065", "Comida para Perros 2kg", "Alimento balanceado para perros, 2kg", "Mascotas", "Purina", "Bodegas del Este C.A.", 50, 12, 6.40, 4.70],
      ["PR-0066", "Arena para Gatos 5kg", "Arena sanitaria aglomerante, 5kg", "Mascotas", "Purina", "Bodegas del Este C.A.", 45, 10, 4.80, 3.50],
      ["PR-0067", "Comida para Gatos 1.5kg", "Alimento balanceado para gatos, 1.5kg", "Mascotas", "Purina", "Bodegas del Este C.A.", 40, 10, 5.90, 4.30],
      ["PR-0068", "Snacks para Perro 500g", "Galletas premio para perros, 500g", "Mascotas", "Purina", "Bodegas del Este C.A.", 60, 12, 3.50, 2.50],
    ];

    const prodIds = {};
    for (const [codigo, nombre, descripcion, cat, marca, prov, stock, stockMin, precio, costo] of P) {
      const r = await client.query(
        `INSERT INTO productos (codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, moneda_base_id, activo, iva_incluido)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, true, true) RETURNING id`,
        [codigo, nombre, descripcion, catMap[cat], marcaMap[marca], provMap[prov], stockMin, precio, costo, USD.id]
      );
      const pid = r.rows[0].id;
      prodIds[codigo] = { id: pid, precio: precio, costo: costo, stockComprado: stock };

      for (const m of monedasArr) {
        const p = m.es_base ? precio : Math.round(precio * Number(m.tasa) * 100) / 100;
        const c = m.es_base ? costo : Math.round(costo * Number(m.tasa) * 100) / 100;
        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo) VALUES ($1, $2, $3, $4)`,
          [pid, m.id, p, c]
        );
      }
    }
    const pid = (codigo) => prodIds[codigo].id;

    // --- Helpers (replican la lógica de las rutas de la app) ---
    async function crearCompra({ numero, proveedor, fecha, moneda, metodo, caja, items, estado = "Recibida", observaciones, conStock = true }) {
      const mon = monedas[moneda];
      const tasa = Number(mon.tasa);
      const esBase = mon.es_base;
      let subtotalTotal = 0;
      for (const it of items) subtotalTotal += it.cantidad * it.costo_unit;
      const totalBase = esBase ? subtotalTotal : Math.round((subtotalTotal / tasa) * 100) / 100;

      const metodoId = metodo ? metodos[metodo].id : null;
      const r = await client.query(
        `INSERT INTO compras (numero, proveedor_id, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, total, total_base, estado, observaciones, referencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [numero, provMap[proveedor], fecha, mon.id, metodoId, caja || null, subtotalTotal, subtotalTotal, totalBase, estado, observaciones || null, numero]
      );
      const compraId = r.rows[0].id;

      for (const it of items) {
        const costoUnitBase = esBase ? it.costo_unit : Math.round((it.costo_unit / tasa) * 100) / 100;
        const subtotal = it.cantidad * it.costo_unit;
        const subtotalBase = esBase ? subtotal : Math.round((subtotal / tasa) * 100) / 100;
        await client.query(
          `INSERT INTO compra_items (compra_id, producto_id, cantidad, costo_unit, costo_unit_base, subtotal, subtotal_base) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [compraId, it.producto_id, it.cantidad, it.costo_unit, costoUnitBase, subtotal, subtotalBase]
        );
        if (conStock) {
          const prod = (await client.query(`SELECT stock FROM productos WHERE id = $1`, [it.producto_id])).rows[0];
          const stockAnterior = Number(prod.stock);
          const nuevoStock = stockAnterior + it.cantidad;
          await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, it.producto_id]);
          await client.query(
            `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
             VALUES ($1, $2, 'Entrada', $3, 'compra', $4, $5, $6, $7, $8, $9)`,
            [it.producto_id, `${fecha} 10:00:00`, `Compra ${numero}`, compraId, it.cantidad, it.costo_unit, costoUnitBase, stockAnterior, nuevoStock]
          );
        }
      }

      if (conStock && caja && metodo) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
           VALUES ($1, $2, 'Salida', $3, $4, $5, $6, 'compra', $7)`,
          [caja, `${fecha} 10:00:00`, subtotalTotal, mon.id, totalBase, `Pago compra ${numero}`, compraId]
        );
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [subtotalTotal, caja]);
      }
      return compraId;
    }

    async function crearVenta({ numero, cliente, cliente_id, tipo_pago, fecha, moneda, metodo, caja, items, observaciones, descuento = 0 }) {
      const esCredito = tipo_pago === "Credito";
      const mon = monedas[moneda];
      const tasa = Number(mon.tasa);
      const esBase = mon.es_base;
      let subtotalTotal = 0;
      let impuestoTotal = 0;
      for (const it of items) {
        const prod = (await client.query(`SELECT * FROM productos WHERE id = $1`, [it.producto_id])).rows[0];
        it.precio_unit = it.precio_unit ?? Number(prod.precio_base);
        const lineTotal = it.cantidad * it.precio_unit;
        subtotalTotal += lineTotal;
        if (!prod.iva_incluido) impuestoTotal += Math.round(lineTotal * 0.16 * 100) / 100;
      }
      const total = Math.max(0, subtotalTotal - descuento + impuestoTotal);
      const totalBase = esBase ? total : Math.round((total / tasa) * 100) / 100;
      const descuentoBase = esBase ? descuento : Math.round((descuento / tasa) * 100) / 100;
      const estadoVenta = esCredito ? "Credito" : "Pagada";
      const metodoId = metodo ? metodos[metodo].id : null;

      const r = await client.query(
        `INSERT INTO ventas (numero, cliente, cliente_id, tipo_pago, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, descuento, impuesto, total, total_base, descuento_base, estado, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [numero, cliente || null, cliente_id || null, esCredito ? "Credito" : "Contado", fecha, mon.id, esCredito ? null : metodoId, esCredito ? null : (caja || null), subtotalTotal, descuento, impuestoTotal, total, totalBase, descuentoBase, estadoVenta, observaciones || null]
      );
      const ventaId = r.rows[0].id;

      for (const it of items) {
        const prod = (await client.query(`SELECT * FROM productos WHERE id = $1`, [it.producto_id])).rows[0];
        const precioUnitBase = esBase ? it.precio_unit : Math.round((it.precio_unit / tasa) * 100) / 100;
        const subtotal = it.cantidad * it.precio_unit;
        const subtotalBase = esBase ? subtotal : Math.round((subtotal / tasa) * 100) / 100;
        await client.query(
          `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, precio_unit_base, subtotal, subtotal_base) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ventaId, it.producto_id, it.cantidad, it.precio_unit, precioUnitBase, subtotal, subtotalBase]
        );
        const stockAnterior = Number(prod.stock);
        const nuevoStock = stockAnterior - it.cantidad;
        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, it.producto_id]);
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
           VALUES ($1, $2, 'Salida', $3, 'venta', $4, $5, $6, $7, $8, $9)`,
          [it.producto_id, `${fecha} 15:00:00`, `Venta ${numero}`, ventaId, it.cantidad, Number(prod.costo_base), Number(prod.costo_base), stockAnterior, nuevoStock]
        );
      }

      if (esCredito) {
        await client.query(
          `INSERT INTO creditos (numero, cliente_id, venta_id, fecha, monto_total, saldo, estado, moneda_id, total_base, saldo_base)
           VALUES ($1, $2, $3, $4, $5, $5, 'Pendiente', $6, $7, $7)`,
          [numeroCredito(), cliente_id, ventaId, fecha, total, mon.id, totalBase]
        );
      } else if (caja && metodo) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
           VALUES ($1, $2, 'Entrada', $3, $4, $5, $6, 'venta', $7)`,
          [caja, `${fecha} 15:00:00`, total, mon.id, totalBase, `Cobro venta ${numero}`, ventaId]
        );
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [total, caja]);
      }
      return ventaId;
    }

    async function crearAbono({ credito, monto, fecha, moneda, metodo, caja, observaciones }) {
      const cred = (await client.query(`SELECT * FROM creditos WHERE id = $1`, [credito])).rows[0];
      const monCredito = monedasArr.find((m) => m.id === cred.moneda_id);
      const monAbono = moneda ? monedas[moneda] : monCredito;
      const tasaAbono = Number(monAbono.tasa);
      const esBaseAbono = monAbono.es_base;
      const tasaCredito = Number(monCredito.tasa);
      const esBaseCredito = monCredito.es_base;
      const montoAbono = Math.round(monto * 100) / 100;

      let montoEnMonedaCredito;
      if (monAbono.id === monCredito.id) {
        montoEnMonedaCredito = montoAbono;
      } else {
        const montoUsd = esBaseAbono ? montoAbono : montoAbono / tasaAbono;
        montoEnMonedaCredito = esBaseCredito ? montoUsd : Math.round(montoUsd * tasaCredito * 100) / 100;
      }
      const montoBase = esBaseAbono ? montoAbono : Math.round((montoAbono / tasaAbono) * 100) / 100;
      const nuevoSaldo = Math.max(0, Number(cred.saldo) - montoEnMonedaCredito);
      const nuevoSaldoBase = Math.max(0, Number(cred.saldo_base) - montoBase);
      const nuevoEstado = nuevoSaldo <= 0.01 ? "Pagado" : "Parcial";

      await client.query(
        `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [cred.id, cred.cliente_id, null, fecha, montoAbono, monAbono.id, montoBase, metodo ? metodos[metodo].id : null, caja || null, observaciones || null]
      );
      await client.query(`UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`, [nuevoSaldo, nuevoSaldoBase, nuevoEstado, cred.id]);

      if (caja) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
           VALUES ($1, $2, 'Entrada', $3, $4, $5, $6, 'abono', $7)`,
          [caja, `${fecha} 16:00:00`, montoAbono, monAbono.id, montoBase, `Abono crédito ${cred.numero}`, cred.id]
        );
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [montoAbono, caja]);
      }
    }

    async function crearRetorno({ numero, tipo, venta_id, compra_id, cliente, proveedor, fecha, motivo, abonar_credito, items }) {
      const r = await client.query(
        `INSERT INTO retornos (numero, tipo, venta_id, compra_id, cliente_id, proveedor_id, fecha, motivo, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Procesado') RETURNING id`,
        [numero, tipo, venta_id || null, compra_id || null, cliente || null, proveedor || null, fecha, motivo || null]
      );
      const retornoId = r.rows[0].id;
      let totalRetorno = 0;

      for (const item of items) {
        const prod = (await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id])).rows[0];
        const stockAnterior = Number(prod.stock);
        let precioUnit = Number(prod.precio_base) || 0;

        if (tipo === "Cliente" && venta_id) {
          const vi = (await client.query(
            `SELECT precio_unit_base FROM venta_items WHERE venta_id = $1 AND producto_id = $2 ORDER BY id LIMIT 1`,
            [venta_id, item.producto_id]
          )).rows;
          if (vi.length > 0) precioUnit = Number(vi[0].precio_unit_base) || precioUnit;
        } else if (tipo === "Proveedor" && compra_id) {
          const ci = (await client.query(
            `SELECT costo_unit_base FROM compra_items WHERE compra_id = $1 AND producto_id = $2 ORDER BY id LIMIT 1`,
            [compra_id, item.producto_id]
          )).rows;
          if (ci.length > 0) precioUnit = Number(ci[0].costo_unit_base) || Number(prod.costo_base) || 0;
          else precioUnit = Number(prod.costo_base) || 0;
        } else if (tipo === "Proveedor") {
          precioUnit = Number(prod.costo_base) || 0;
        }

        let nuevoStock;
        if (tipo === "Cliente") nuevoStock = stockAnterior + item.cantidad;
        else nuevoStock = stockAnterior - item.cantidad;
        const subtotal = Math.round(precioUnit * item.cantidad * 100) / 100;

        await client.query(
          `INSERT INTO retorno_items (retorno_id, producto_id, cantidad, precio_unit, precio_unit_base, subtotal, subtotal_base)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [retornoId, item.producto_id, item.cantidad, precioUnit, precioUnit, subtotal]
        );
        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
           VALUES ($1, $2, $3, $4, 'retorno', $5, $6, $7, $7, $8, $9)`,
          [item.producto_id, `${fecha} 14:00:00`, tipo === "Cliente" ? "Entrada" : "Salida", `Retorno ${numero}`, retornoId, item.cantidad, precioUnit, stockAnterior, nuevoStock]
        );
        totalRetorno += subtotal;
      }
      totalRetorno = Math.round(totalRetorno * 100) / 100;

      if (tipo === "Cliente" && venta_id && abonar_credito === true && totalRetorno > 0) {
        const cred = (await client.query(
          `SELECT * FROM creditos WHERE venta_id = $1 AND estado <> 'Pagado' ORDER BY id LIMIT 1`,
          [venta_id]
        )).rows[0];
        if (cred) {
          const mon = (await client.query(`SELECT * FROM monedas WHERE id = $1`, [cred.moneda_id])).rows[0];
          const monto = mon.es_base ? totalRetorno : Math.round(totalRetorno * Number(mon.tasa) * 100) / 100;
          const nuevoSaldo = Math.max(0, Number(cred.saldo) - monto);
          const nuevoSaldoBase = Math.max(0, Number(cred.saldo_base) - totalRetorno);
          const nuevoEstado = nuevoSaldo <= 0 ? "Pagado" : "Parcial";
          await client.query(
            `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, observaciones)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [cred.id, cred.cliente_id, retornoId, fecha, monto, mon.id, totalRetorno, `Retorno ${numero}`]
          );
          await client.query(`UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`, [nuevoSaldo, nuevoSaldoBase, nuevoEstado, cred.id]);
        }
      }
      return retornoId;
    }

    // --- 8. Compras (crean stock + kardex Entrada) ---
    const cajaUSD = cajasRows.find((c) => c.moneda_id === USD.id).id;
    const cajaVES = cajasRows.find((c) => c.moneda_id === VES.id).id;
    const cajaCOP = cajasRows.find((c) => c.moneda_id !== USD.id && c.moneda_id !== VES.id).id;

    await crearCompra({
      numero: "OC-2026-0001", proveedor: "Distribuidora Polar C.A.", fecha: daysAgo(25),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0001"), cantidad: 120, costo_unit: 1.30 },
        { producto_id: pid("PR-0002"), cantidad: 90, costo_unit: 1.50 },
        { producto_id: pid("PR-0017"), cantidad: 200, costo_unit: 0.78 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0002", proveedor: "Distribuidora Polar C.A.", fecha: daysAgo(18),
      moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD,
      items: [{ producto_id: pid("PR-0061"), cantidad: 90, costo_unit: 4.00 }],
      observaciones: "Compra de bebidas alcohólicas",
    });
    await crearCompra({
      numero: "OC-2026-0003", proveedor: "Nestlé Venezuela S.A.", fecha: daysAgo(24),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0006"), cantidad: 100, costo_unit: 0.80 },
        { producto_id: pid("PR-0007"), cantidad: 45, costo_unit: 3.20 },
        { producto_id: pid("PR-0008"), cantidad: 80, costo_unit: 0.85 },
        { producto_id: pid("PR-0009"), cantidad: 35, costo_unit: 4.10 },
        { producto_id: pid("PR-0010"), cantidad: 70, costo_unit: 0.75 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0004", proveedor: "Nestlé Venezuela S.A.", fecha: daysAgo(19),
      moneda: "VES", metodo: "Transferencia VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0011"), cantidad: 55, costo_unit: 2.30 * 36.5 },
        { producto_id: pid("PR-0027"), cantidad: 85, costo_unit: 1.70 * 36.5 },
        { producto_id: pid("PR-0056"), cantidad: 65, costo_unit: 2.70 * 36.5 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0005", proveedor: "Cervecería Regional C.A.", fecha: daysAgo(20),
      moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0062"), cantidad: 30, costo_unit: 11.50 },
        { producto_id: pid("PR-0063"), cantidad: 20, costo_unit: 19.90 },
        { producto_id: pid("PR-0064"), cantidad: 35, costo_unit: 6.80 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0006", proveedor: "Distribuidora Maxi Alimentos", fecha: daysAgo(23),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0003"), cantidad: 60, costo_unit: 2.40 },
        { producto_id: pid("PR-0004"), cantidad: 150, costo_unit: 1.10 },
        { producto_id: pid("PR-0012"), cantidad: 65, costo_unit: 1.90 },
        { producto_id: pid("PR-0023"), cantidad: 110, costo_unit: 1.35 },
        { producto_id: pid("PR-0024"), cantidad: 5, costo_unit: 3.00 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0007", proveedor: "Distribuidora Maxi Alimentos", fecha: daysAgo(15),
      moneda: "USD", metodo: "Tarjeta USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0025"), cantidad: 35, costo_unit: 2.70 },
        { producto_id: pid("PR-0026"), cantidad: 40, costo_unit: 2.20 },
        { producto_id: pid("PR-0028"), cantidad: 60, costo_unit: 1.45 },
        { producto_id: pid("PR-0029"), cantidad: 6, costo_unit: 2.50 },
        { producto_id: pid("PR-0058"), cantidad: 95, costo_unit: 1.28 },
        { producto_id: pid("PR-0059"), cantidad: 100, costo_unit: 1.35 },
        { producto_id: pid("PR-0060"), cantidad: 140, costo_unit: 1.05 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0008", proveedor: "Almacén San Miguel C.A.", fecha: daysAgo(22),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0005"), cantidad: 200, costo_unit: 0.60 },
        { producto_id: pid("PR-0030"), cantidad: 95, costo_unit: 2.80 },
        { producto_id: pid("PR-0052"), cantidad: 120, costo_unit: 1.35 },
        { producto_id: pid("PR-0054"), cantidad: 80, costo_unit: 0.85 },
        { producto_id: pid("PR-0055"), cantidad: 5, costo_unit: 1.65 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0009", proveedor: "Suministros Industriales JL", fecha: daysAgo(19),
      moneda: "VES", metodo: "Efectivo VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0041"), cantidad: 55, costo_unit: 3.40 * 36.5 },
        { producto_id: pid("PR-0042"), cantidad: 130, costo_unit: 1.10 * 36.5 },
        { producto_id: pid("PR-0043"), cantidad: 60, costo_unit: 2.60 * 36.5 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0010", proveedor: "Suministros Industriales JL", fecha: daysAgo(21),
      moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0044"), cantidad: 45, costo_unit: 2.10 },
        { producto_id: pid("PR-0045"), cantidad: 100, costo_unit: 0.80 },
        { producto_id: pid("PR-0046"), cantidad: 70, costo_unit: 1.50 },
        { producto_id: pid("PR-0047"), cantidad: 140, costo_unit: 1.25 },
        { producto_id: pid("PR-0048"), cantidad: 55, costo_unit: 2.30 },
        { producto_id: pid("PR-0049"), cantidad: 48, costo_unit: 2.50 },
        { producto_id: pid("PR-0050"), cantidad: 52, costo_unit: 2.15 },
        { producto_id: pid("PR-0051"), cantidad: 110, costo_unit: 1.00 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0011", proveedor: "Distribuidora El Águila", fecha: daysAgo(21),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0013"), cantidad: 80, costo_unit: 1.70 },
        { producto_id: pid("PR-0014"), cantidad: 130, costo_unit: 1.60 },
        { producto_id: pid("PR-0015"), cantidad: 75, costo_unit: 1.45 },
        { producto_id: pid("PR-0016"), cantidad: 40, costo_unit: 2.10 },
        { producto_id: pid("PR-0018"), cantidad: 60, costo_unit: 1.60 },
        { producto_id: pid("PR-0019"), cantidad: 45, costo_unit: 1.55 },
        { producto_id: pid("PR-0020"), cantidad: 90, costo_unit: 2.60 },
        { producto_id: pid("PR-0021"), cantidad: 50, costo_unit: 1.40 },
        { producto_id: pid("PR-0022"), cantidad: 55, costo_unit: 1.65 },
        { producto_id: pid("PR-0053"), cantidad: 95, costo_unit: 1.15 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0012", proveedor: "Grupo Santa Elena C.A.", fecha: daysAgo(17),
      moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0031"), cantidad: 40, costo_unit: 2.80 },
        { producto_id: pid("PR-0032"), cantidad: 70, costo_unit: 1.60 },
        { producto_id: pid("PR-0033"), cantidad: 65, costo_unit: 1.45 },
        { producto_id: pid("PR-0034"), cantidad: 30, costo_unit: 4.00 },
        { producto_id: pid("PR-0035"), cantidad: 7, costo_unit: 4.60 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0013", proveedor: "Importadora Panamá S.A.", fecha: daysAgo(20),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0036"), cantidad: 45, costo_unit: 2.00 },
        { producto_id: pid("PR-0037"), cantidad: 40, costo_unit: 2.25 },
        { producto_id: pid("PR-0038"), cantidad: 75, costo_unit: 1.30 },
        { producto_id: pid("PR-0039"), cantidad: 90, costo_unit: 1.20 },
        { producto_id: pid("PR-0040"), cantidad: 60, costo_unit: 1.45 },
      ],
    });
    await crearCompra({
      numero: "OC-2026-0014", proveedor: "Bodegas del Este C.A.", fecha: daysAgo(20),
      moneda: "USD", metodo: "Tarjeta USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0057"), cantidad: 85, costo_unit: 2.25 },
        { producto_id: pid("PR-0065"), cantidad: 50, costo_unit: 4.70 },
        { producto_id: pid("PR-0066"), cantidad: 45, costo_unit: 3.50 },
        { producto_id: pid("PR-0067"), cantidad: 40, costo_unit: 4.30 },
        { producto_id: pid("PR-0068"), cantidad: 60, costo_unit: 2.50 },
      ],
    });

    // Compras en tránsito / pendientes (sin impacto de stock) para notificaciones
    await crearCompra({
      numero: "OC-2026-0015", proveedor: "Nestlé Venezuela S.A.", fecha: daysAgo(5),
      moneda: "USD", metodo: null, caja: null, estado: "En Camino", conStock: false,
      items: [
        { producto_id: pid("PR-0006"), cantidad: 50, costo_unit: 0.80 },
        { producto_id: pid("PR-0010"), cantidad: 40, costo_unit: 0.75 },
      ],
      observaciones: "Pedido en tránsito",
    });
    await crearCompra({
      numero: "OC-2026-0016", proveedor: "Suministros Industriales JL", fecha: daysAgo(2),
      moneda: "USD", metodo: null, caja: null, estado: "Pendiente", conStock: false,
      items: [
        { producto_id: pid("PR-0041"), cantidad: 30, costo_unit: 3.40 },
        { producto_id: pid("PR-0047"), cantidad: 50, costo_unit: 1.25 },
      ],
      observaciones: "Esperando confirmación del proveedor",
    });

    // --- 9. Ventas ---
    const cli = (name) => clienteMap[name];
    const met = (name) => metodos[name].id;

    await crearVenta({
      numero: "VTA-2026-0001", cliente: "María Fernanda Gómez", cliente_id: cli("María Fernanda Gómez"),
      tipo_pago: "Contado", fecha: daysAgo(20), moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0001"), cantidad: 5 },
        { producto_id: pid("PR-0014"), cantidad: 6 },
        { producto_id: pid("PR-0023"), cantidad: 4 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0002", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(18), moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0006"), cantidad: 10 },
        { producto_id: pid("PR-0027"), cantidad: 4 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0003", cliente: "José Luis Rodríguez", cliente_id: cli("José Luis Rodríguez"),
      tipo_pago: "Contado", fecha: daysAgo(16), moneda: "USD", metodo: "Tarjeta USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0041"), cantidad: 2 },
        { producto_id: pid("PR-0047"), cantidad: 3 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0004", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(14), moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0017"), cantidad: 12 },
        { producto_id: pid("PR-0052"), cantidad: 6 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0005", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(12), moneda: "VES", metodo: "Efectivo VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0007"), cantidad: 2, precio_unit: 4.50 * 36.5 },
        { producto_id: pid("PR-0009"), cantidad: 1, precio_unit: 5.90 * 36.5 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0006", cliente: "María Fernanda Gómez", cliente_id: cli("María Fernanda Gómez"),
      tipo_pago: "Contado", fecha: daysAgo(10), moneda: "VES", metodo: "Transferencia VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0027"), cantidad: 3, precio_unit: 2.50 * 36.5 },
        { producto_id: pid("PR-0060"), cantidad: 10, precio_unit: 1.50 * 36.5 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0007", cliente: "Carlos Eduardo Méndez", cliente_id: cli("Carlos Eduardo Méndez"),
      tipo_pago: "Contado", fecha: daysAgo(9), moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0036"), cantidad: 5 },
        { producto_id: pid("PR-0037"), cantidad: 3 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0008", cliente: "Supermercado La Colina S.A.", cliente_id: cli("Supermercado La Colina S.A."),
      tipo_pago: "Contado", fecha: daysAgo(7), moneda: "USD", metodo: "Tarjeta USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0013"), cantidad: 8 },
        { producto_id: pid("PR-0021"), cantidad: 6 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0009", cliente: "Comercial Los Andes C.A.", cliente_id: cli("Comercial Los Andes C.A."),
      tipo_pago: "Credito", fecha: daysAgo(6), moneda: "USD", metodo: null, caja: null,
      items: [
        { producto_id: pid("PR-0031"), cantidad: 5 },
        { producto_id: pid("PR-0032"), cantidad: 10 },
        { producto_id: pid("PR-0034"), cantidad: 4 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0010", cliente: "Distribuidora El Progreso C.A.", cliente_id: cli("Distribuidora El Progreso C.A."),
      tipo_pago: "Credito", fecha: daysAgo(5), moneda: "USD", metodo: null, caja: null,
      items: [
        { producto_id: pid("PR-0057"), cantidad: 6 },
        { producto_id: pid("PR-0058"), cantidad: 12 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0011", cliente: "Supermercado La Colina S.A.", cliente_id: cli("Supermercado La Colina S.A."),
      tipo_pago: "Credito", fecha: daysAgo(4), moneda: "USD", metodo: null, caja: null,
      items: [
        { producto_id: pid("PR-0014"), cantidad: 20 },
        { producto_id: pid("PR-0017"), cantidad: 24 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0012", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(2), moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0053"), cantidad: 5 },
        { producto_id: pid("PR-0056"), cantidad: 3 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0013", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(1), moneda: "VES", metodo: "Efectivo VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0007"), cantidad: 2, precio_unit: 4.50 * 36.5 },
        { producto_id: pid("PR-0027"), cantidad: 3, precio_unit: 2.50 * 36.5 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0014", cliente: "Supermercado La Colina S.A.", cliente_id: cli("Supermercado La Colina S.A."),
      tipo_pago: "Contado", fecha: daysAgo(15), moneda: "COP", metodo: "Efectivo COP", caja: cajaCOP,
      items: [
        { producto_id: pid("PR-0014"), cantidad: 10, precio_unit: 2.40 * 4200 },
        { producto_id: pid("PR-0041"), cantidad: 4, precio_unit: 4.90 * 4200 },
        { producto_id: pid("PR-0023"), cantidad: 5, precio_unit: 1.95 * 4200 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0015", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(1), moneda: "COP", metodo: "Transferencia COP", caja: cajaCOP,
      items: [
        { producto_id: pid("PR-0017"), cantidad: 8, precio_unit: 1.15 * 4200 },
        { producto_id: pid("PR-0052"), cantidad: 6, precio_unit: 1.95 * 4200 },
      ],
    });

    // Ventas adicionales del mes actual (agosto) para que el KPI "Ventas del Mes" sea consistente
    await crearVenta({
      numero: "VTA-2026-0016", cliente: "María Fernanda Gómez", cliente_id: cli("María Fernanda Gómez"),
      tipo_pago: "Contado", fecha: daysAgo(1), moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0013"), cantidad: 5 },
        { producto_id: pid("PR-0021"), cantidad: 4 },
        { producto_id: pid("PR-0006"), cantidad: 3 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0017", cliente: "José Luis Rodríguez", cliente_id: cli("José Luis Rodríguez"),
      tipo_pago: "Contado", fecha: daysAgo(0), moneda: "USD", metodo: "Tarjeta USD", caja: cajaUSD,
      items: [
        { producto_id: pid("PR-0037"), cantidad: 6 },
        { producto_id: pid("PR-0031"), cantidad: 4 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0018", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(2), moneda: "VES", metodo: "Efectivo VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0007"), cantidad: 2, precio_unit: 4.50 * 36.5 },
        { producto_id: pid("PR-0060"), cantidad: 5, precio_unit: 1.50 * 36.5 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0019", cliente: "María Fernanda Gómez", cliente_id: cli("María Fernanda Gómez"),
      tipo_pago: "Contado", fecha: daysAgo(0), moneda: "VES", metodo: "Transferencia VES", caja: cajaVES,
      items: [
        { producto_id: pid("PR-0009"), cantidad: 2, precio_unit: 5.90 * 36.5 },
        { producto_id: pid("PR-0027"), cantidad: 4, precio_unit: 2.50 * 36.5 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0020", cliente: "Supermercado La Colina S.A.", cliente_id: cli("Supermercado La Colina S.A."),
      tipo_pago: "Contado", fecha: daysAgo(2), moneda: "COP", metodo: "Efectivo COP", caja: cajaCOP,
      items: [
        { producto_id: pid("PR-0014"), cantidad: 6, precio_unit: 2.40 * 4200 },
        { producto_id: pid("PR-0023"), cantidad: 4, precio_unit: 1.95 * 4200 },
      ],
    });
    await crearVenta({
      numero: "VTA-2026-0021", cliente: null, cliente_id: null,
      tipo_pago: "Contado", fecha: daysAgo(0), moneda: "COP", metodo: "Transferencia COP", caja: cajaCOP,
      items: [
        { producto_id: pid("PR-0017"), cantidad: 5, precio_unit: 1.15 * 4200 },
        { producto_id: pid("PR-0052"), cantidad: 4, precio_unit: 1.95 * 4200 },
      ],
    });

    // --- 10. Abonos sobre créditos ---
    const creditos = {};
    for (const { rows } of [await client.query(`SELECT * FROM creditos ORDER BY id`)]) {
      for (const cr of rows) creditos[cr.numero] = cr;
    }

    await crearAbono({
      credito: creditos["CRE-2026-0001"].id, monto: 25, fecha: daysAgo(3),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD, observaciones: "Abono parcial",
    });
    await crearAbono({
      credito: creditos["CRE-2026-0002"].id, monto: 41.40, fecha: daysAgo(2),
      moneda: "USD", metodo: "Transferencia USD", caja: cajaUSD, observaciones: "Pago total",
    });
    await crearAbono({
      credito: creditos["CRE-2026-0003"].id, monto: 20, fecha: daysAgo(1),
      moneda: "USD", metodo: "Efectivo USD", caja: cajaUSD, observaciones: "Abono parcial",
    });

    // --- 11. Retornos ---
    const ventas = {};
    for (const { rows } of [await client.query(`SELECT * FROM ventas ORDER BY id`)]) {
      for (const v of rows) ventas[v.numero] = v;
    }
    const compras = {};
    for (const { rows } of [await client.query(`SELECT * FROM compras ORDER BY id`)]) {
      for (const c of rows) compras[c.numero] = c;
    }

    await crearRetorno({
      numero: "RET-2026-0001", tipo: "Cliente", venta_id: ventas["VTA-2026-0009"].id,
      cliente: cli("Comercial Los Andes C.A."), fecha: daysAgo(4),
      motivo: "Producto en mal estado", abonar_credito: true,
      items: [{ producto_id: pid("PR-0034"), cantidad: 1 }],
    });
    await crearRetorno({
      numero: "RET-2026-0002", tipo: "Cliente", venta_id: ventas["VTA-2026-0001"].id,
      cliente: cli("María Fernanda Gómez"), fecha: daysAgo(3),
      motivo: "Cambio por otro producto", abonar_credito: false,
      items: [{ producto_id: pid("PR-0014"), cantidad: 2 }],
    });
    await crearRetorno({
      numero: "DEV-2026-0001", tipo: "Proveedor", compra_id: compras["OC-2026-0006"].id,
      proveedor: provMap["Distribuidora Maxi Alimentos"], fecha: daysAgo(8),
      motivo: "Aceite con empaque dañado", abonar_credito: false,
      items: [{ producto_id: pid("PR-0003"), cantidad: 3 }],
    });
    await crearRetorno({
      numero: "DEV-2026-0002", tipo: "Proveedor", compra_id: compras["OC-2026-0003"].id,
      proveedor: provMap["Nestlé Venezuela S.A."], fecha: daysAgo(7),
      motivo: "Leche en polvo vencida", abonar_credito: false,
      items: [{ producto_id: pid("PR-0009"), cantidad: 1 }],
    });

    // --- 12. Aportes de apertura de caja (para que los saldos sean positivos) ---
    const aportes = {
      [cajaUSD]: { moneda: "USD", monto: 10000 },
      [cajaVES]: { moneda: "VES", monto: 50000 },
    };
    if (cajaCOP) aportes[cajaCOP] = { moneda: "COP", monto: 500000 };
    for (const [cajaId, ap] of Object.entries(aportes)) {
      const mon = monedas[ap.moneda];
      const montoBase = mon.es_base ? ap.monto : Math.round((ap.monto / Number(mon.tasa)) * 100) / 100;
      await client.query(
        `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
         VALUES ($1, $2, 'Entrada', $3, $4, $5, $6, NULL, NULL)`,
        [Number(cajaId), `${daysAgo(26)} 08:00:00`, ap.monto, mon.id, montoBase, `Aporte de capital de apertura (${mon.codigo})`]
      );
    }

    // --- 13. Recalcular saldos de caja desde transacciones ---
    for (const c of cajasRows) {
      const r = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN tipo = 'Entrada' THEN monto ELSE 0 END), 0) AS ent,
           COALESCE(SUM(CASE WHEN tipo = 'Salida' THEN monto ELSE 0 END), 0) AS sal
         FROM transacciones WHERE caja_id = $1`,
        [c.id]
      );
      const saldo = Math.round((Number(r.rows[0].ent) - Number(r.rows[0].sal)) * 100) / 100;
      await client.query(`UPDATE cajas SET saldo_actual = $1 WHERE id = $2`, [saldo, c.id]);
    }

    // --- 14. Cierres de caja (históricos, dentro de la ventana de apertura) ---
    const aperturaWin = daysAgo(25);
    const cierreWin = daysAgo(10);
    for (const c of cajasRows) {
      const r = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN tipo = 'Entrada' THEN monto ELSE 0 END), 0) AS ent,
           COALESCE(SUM(CASE WHEN tipo = 'Salida' THEN monto ELSE 0 END), 0) AS sal,
           COALESCE(SUM(CASE WHEN tipo = 'Entrada' THEN monto_base ELSE 0 END), 0) AS entb,
           COALESCE(SUM(CASE WHEN tipo = 'Salida' THEN monto_base ELSE 0 END), 0) AS salb
         FROM transacciones
         WHERE caja_id = $1 AND fecha >= $2 AND fecha <= $3`,
        [c.id, `${aperturaWin} 00:00:00`, `${cierreWin} 23:59:59`]
      );
      const ent = Number(r.rows[0].ent);
      const sal = Number(r.rows[0].sal);
      const entb = Number(r.rows[0].entb);
      const salb = Number(r.rows[0].salb);
      const saldoCierre = Math.round((ent - sal) * 100) / 100;
      await client.query(
        `INSERT INTO cierres_caja (caja_id, fecha_apertura, fecha_cierre, saldo_apertura, total_entradas, total_salidas, saldo_cierre, total_entradas_base, total_salidas_base, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.id, `${aperturaWin} 07:00:00`, `${cierreWin} 18:00:00`, 0, ent, sal, saldoCierre, entb, salb, "Cierre de caja generado con datos de demostración"]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(async () => {
    console.log("Seed completado correctamente.");
    const tables = [
      "monedas", "categorias", "marcas", "proveedores", "clientes", "productos",
      "producto_precios", "cajas", "metodos_pago", "compras", "compra_items",
      "ventas", "venta_items", "creditos", "retornos", "retorno_items",
      "abonos", "kardex", "transacciones", "cierres_caja", "configuracion",
    ];
    for (const t of tables) {
      const res = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
      console.log(`${t}: ${res.rows[0].n}`);
    }
    await pool.end();
  })
  .catch((e) => {
    console.error("Error en el seed:", e);
    process.exit(1);
  });
