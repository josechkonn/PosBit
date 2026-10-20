export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { redondear, monedaDeProducto, monedaCostoDeProducto, preciosDeProducto, presentacionesDeProducto, convertirConMetodo, reglasConversion } from "@/lib/money";
import { aplicarReglasRedondeo } from "@/lib/costing";
import { getConfiguracionGlobal } from "@/lib/global-config";
import { leerFiltros, SIN_FILTROS, construirWhere, calcularFacetas } from "@/lib/filtros-productos";
import { triggerBackgroundSync } from "@/lib/sync-engine";

/** Error de validación de datos enviados por el cliente → HTTP 400. */
class ValidationError extends Error {}

/** Modo de venta de una presentación (patrón NULL = derivar, retrocompatible). */
type ModoVentaPres = "derivado" | "fijo" | "margen";

interface PresentacionNormalizada {
  id: string | null;
  nombre: string;
  unidades: number;
  activo: boolean;
  /**
   * Código de barras propio de la caja. Opcional: `null` = la caja no se
   * escanea, solo se agrega desde el desplegable. Único en todo el catálogo.
   */
  codigo: string | null;
  modo_venta: ModoVentaPres;
  precio_override: number | null;
  margen_override: number | null;
}

/** Normaliza un código de barras: recorte, tope de longitud, vacío = null. */
function normalizarCodigoBarras(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 50);
  return s.length > 0 ? s : null;
}

/**
 * Verifica que los códigos de barras de las cajas no choquen con nada más del
 * catálogo: ni con el código de un producto, ni con el de otra caja. Se compara
 * con `lower()` porque el escaneo también es insensible a mayúsculas.
 *
 * La unicidad caja↔caja la blinda además el índice único parcial de la BD; esta
 * función cubre las dos colisiones que ese índice NO puede ver (caja↔producto),
 * y devuelve un mensaje legible en vez de un error crudo de Postgres.
 *
 * `excluirPresentacionId` deja fuera la propia caja cuando se está editando, para
 * que guardar sin cambios no se rechace a sí misma.
 */
async function validarCodigosPresentaciones(
  cliente: { query: (sql: string, params?: any[]) => Promise<any> },
  presentaciones: PresentacionNormalizada[],
  productoId?: number | null
): Promise<void> {
  const conCodigo = presentaciones.filter((p) => p.codigo);
  if (conCodigo.length === 0) return;

  // Dos cajas del MISMO envío con el mismo código: error local, sin tocar la BD.
  const vistos = new Set<string>();
  for (const p of conCodigo) {
    const clave = p.codigo!.toLowerCase();
    if (vistos.has(clave)) {
      throw new ValidationError(`El código de barras "${p.codigo}" está repetido en las cajas de este producto`);
    }
    vistos.add(clave);
  }

  for (const p of conCodigo) {
    const res = await cliente.query(
      `SELECT 'producto' AS origen, p.nombre AS etiqueta
         FROM productos p
        WHERE lower(p.codigo) = lower($1) AND ($3::int IS NULL OR p.id <> $3)
       UNION ALL
       SELECT 'presentacion' AS origen, pp.nombre || ' (de ' || pr.nombre || ')' AS etiqueta
         FROM producto_presentaciones pp
         JOIN productos pr ON pr.id = pp.producto_id
        WHERE lower(pp.codigo) = lower($1)
          AND ($2::uuid IS NULL OR pp.id <> $2)
          AND ($3::int IS NULL OR pp.producto_id <> $3)
       LIMIT 1`,
      [p.codigo, p.id, productoId ?? null]
    );
    if (res.rows.length > 0) {
      const r = res.rows[0];
      throw new ValidationError(
        r.origen === "producto"
          ? `El código de barras "${p.codigo}" ya lo usa el producto "${r.etiqueta}"`
          : `El código de barras "${p.codigo}" ya lo usa la caja "${r.etiqueta}"`
      );
    }
  }
}

/**
 * Valida y normaliza la lista de presentaciones enviada por el cliente.
 * Unidad es implícita (factor 1) y no se persiste; cada presentación debe
 * tener nombre y unidades enteras > 1. Devuelve lista deduplicada por nombre.
 * Devuelve `null` si el campo `presentaciones` NO vino en el body: en PUT eso
 * significa "no tocar las presentaciones" (compatibilidad con clientes viejos).
 *
 * El PRECIO de la presentación es opcional según su modo:
 *   derivado → no usa ningún campo (precio = unidad × unidades)
 *   fijo     → exige `precio_override` ≥ 0
 *   margen   → exige `margen_override` ≥ 0
 * El COSTO nunca se guarda: se deriva del CPP.
 */
function normalizarPresentaciones(
  body: Record<string, unknown> | null
): PresentacionNormalizada[] | null {
  if (body?.presentaciones === undefined) return null;
  const raw = Array.isArray(body.presentaciones) ? (body.presentaciones as any[]) : [];
  const vistos = new Set<string>();
  const out: PresentacionNormalizada[] = [];

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const nombre = String(p?.nombre ?? "").trim();
    if (!nombre) continue;
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue; // nombres duplicados (insensible a mayúsculas)
    vistos.add(clave);

    const unidades = parseInt(String(p?.unidades), 10);
    if (!Number.isInteger(unidades) || unidades <= 1) {
      throw new ValidationError(`Presentación "${nombre}": las unidades deben ser enteras y mayores a 1`);
    }

    const modoCrudo = String(p?.modo_venta ?? "derivado");
    const modo_venta: ModoVentaPres =
      modoCrudo === "fijo" || modoCrudo === "margen" ? (modoCrudo as ModoVentaPres) : "derivado";

    const precio_override = num(p?.precio_override);
    const margen_override = num(p?.margen_override);

    if (modo_venta === "fijo") {
      if (precio_override === null || precio_override < 0) {
        throw new ValidationError(`Presentación "${nombre}": el modo "precio fijo" necesita un precio ≥ 0`);
      }
    }
    if (modo_venta === "margen") {
      if (margen_override === null || margen_override < 0) {
        throw new ValidationError(`Presentación "${nombre}": el modo "por margen" necesita un margen ≥ 0`);
      }
    }

    out.push({
      id: p?.id ? String(p.id) : null,
      nombre,
      unidades,
      activo: p?.activo !== false,
      codigo: normalizarCodigoBarras(p?.codigo),
      modo_venta,
      // Solo se guarda el override del modo activo; el otro se limpia para que
      // un cambio de modo no deje datos viejos que puedan reactivarse.
      precio_override: modo_venta === "fijo" ? precio_override : null,
      margen_override: modo_venta === "margen" ? margen_override : null,
    });
  }

  return out;
}

/**
 * Normaliza la lista de proveedores de un producto (N:M). Acepta un array de
 * ids o un único id (compatibilidad con clientes viejos). Devuelve ids únicos
 * y válidos; `[]` si no viene nada o viene vacío.
 */
function normalizarProveedorIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((x) => parseInt(String(x), 10))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
  }
  if (raw != null && raw !== "") {
    const n = parseInt(String(raw), 10);
    return Number.isInteger(n) && n > 0 ? [n] : [];
  }
  return [];
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(1000, Math.max(1, parseInt(limitParam, 10))) : 20;
    const offset = (page - 1) * limit;

    const filtros = leerFiltros(searchParams);
    // Compatibilidad: sin filtros, el comportamiento por defecto es el de
    // siempre (solo productos activos). Con filtros, manda lo que se pida —
    // así `estado_prod=inactivo` sí puede devolver productos inactivos, que
    // antes eran invisibles hasta para el filtro que existía para buscarlos.
    if (SIN_FILTROS(filtros)) filtros.estadoProd = "activo";

    const { where, params } = construirWhere(filtros);
    // LIMIT/OFFSET van al final de la lista de parámetros.
    const limitPh = `$${params.length + 1}`;
    const offsetPh = `$${params.length + 2}`;

    const filas = await query(`
      SELECT
        p.id, p.codigo, p.nombre, p.descripcion, p.imagen,
        p.stock, p.stock_minimo, p.activo, p.iva_incluido, p.moneda_base_id,
        p.precio_base, p.costo_base, p.moneda_costo_id,
        p.margen_ganancia, p.costo_promedio, p.costo_promedio_base, p.precio_auto, p.precio_actualizado_en,
        p.categoria_id, p.marca_id, p.proveedor_id,
        c.nombre as categoria_nombre,
        m.nombre as marca_nombre,
        pr.nombre as proveedor_nombre,
        COUNT(*) OVER() AS total_filtrado
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      ${where}
      ORDER BY p.codigo ASC, p.id ASC
      LIMIT ${limitPh} OFFSET ${offsetPh}
    `, [...params, limit, offset]);

    // `COUNT(*) OVER()` se evalúa antes del LIMIT, así que da el total del
    // conjunto filtrado sin una segunda consulta que pueda desincronizarse.
    const total = Number((filas[0] as any)?.total_filtrado ?? 0);
    const productos = (filas as any[]).map(({ total_filtrado, ...resto }) => resto);

    const hayFiltros = !SIN_FILTROS(filtros);
    const productoIds = (productos as any[]).map((p) => p.id);

    const [facetas, catalogo, cfgGlobal, presentacionesRows, proveedoresRows] = await Promise.all([
      hayFiltros ? calcularFacetas(filtros, query) : Promise.resolve(null),
      query(
        `SELECT id, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo, usa_tasa_usd_directa, tasa_usd_directa FROM monedas ORDER BY es_base DESC, codigo ASC, id ASC`
      ),
      getConfiguracionGlobal(),
      productoIds.length
        ? query(
            `SELECT id, producto_id, nombre, unidades, activo, codigo,
                    modo_venta, precio_override, margen_override
             FROM producto_presentaciones
             WHERE producto_id = ANY($1::int[])
             ORDER BY nombre ASC, unidades ASC`,
            [productoIds]
          ).catch((e: any) => {
            console.warn(
              "Aviso al consultar producto_presentaciones (se continuará sin presentaciones):",
              e?.message || e
            );
            return [] as any[];
          })
        : Promise.resolve([] as any[]),
      productoIds.length
        ? query(
            `SELECT pp.producto_id, pr.id, pr.nombre
             FROM producto_proveedores pp
             JOIN proveedores pr ON pr.id = pp.proveedor_id
             WHERE pp.producto_id = ANY($1::int[])
             ORDER BY pr.nombre ASC, pr.id ASC`,
            [productoIds]
          ).catch((e: any) => {
            console.warn(
              "Aviso al consultar producto_proveedores (se continuará con proveedor principal):",
              e?.message || e
            );
            return [] as any[];
          })
        : Promise.resolve([] as any[]),
    ]);

    const reglas = reglasConversion(cfgGlobal, catalogo);
    const baseSistema = catalogo.find((m: any) => m.es_base) || catalogo[0];

    const presPorProducto = new Map<number, any[]>();
    for (const pr of presentacionesRows as any[]) {
      const lista = presPorProducto.get(pr.producto_id) || [];
      lista.push(pr);
      presPorProducto.set(pr.producto_id, lista);
    }

    const provPorProducto = new Map<number, any[]>();
    for (const pv of proveedoresRows as any[]) {
      const lista = provPorProducto.get(pv.producto_id) || [];
      lista.push({ id: pv.id, nombre: pv.nombre });
      provPorProducto.set(pv.producto_id, lista);
    }

    const decimalesVenta = (p: any) => {
      const m = monedaDeProducto(p, baseSistema, catalogo);
      return Number((m as any)?.decimales ?? 2);
    };

    const productosConPrecios = (productos as any[]).map((p) => {
      // El precio de la presentación vive en la MONEDA DE VENTA del producto,
      // así que el modo 'margen' necesita el CPP convertido a esa moneda (viene
      // en USD base). Se usa la misma regla que la cascada de compras.
      const monedaVenta = monedaDeProducto(p, baseSistema, catalogo) as any;
      const cppBase = Number(p.costo_promedio_base) || 0;
      const costoUnitarioVenta =
        cppBase > 0
          ? convertirConMetodo(cppBase, baseSistema as any, monedaVenta, {
              metodo: reglas.compras.metodo,
              monedaTransito: reglas.compras.monedaTransito,
              catalogo,
            }, 6)
          : null;

      return {
        ...p,
        precios: preciosDeProducto(p, catalogo, baseSistema, reglas),
        presentaciones: presentacionesDeProducto(
          p,
          presPorProducto.get(p.id) || [],
          decimalesVenta(p),
          costoUnitarioVenta
        ),
        proveedores: provPorProducto.get(p.id) || [],
      };
    });

    return NextResponse.json({
      productos: productosConPrecios,
      monedas: (catalogo as any[]).filter((m) => m.activo),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      // Conteos por dimensión para los desplegables. `null` cuando no hay
      // filtros (ver `hayFiltros`).
      facetas,
    });
  } catch (error: unknown) {
    console.error("Error al obtener productos:", error);
    const err = error as { message?: string };
    return NextResponse.json({ error: err.message || "Error al obtener productos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id, moneda_costo_id, margen_ganancia } = body;

    // El precio de venta es opcional: si no se envía pero el producto define un
    // margen %, se autocalcula (precio = costo × (1 + margen/100)).
    if (!codigo || !nombre || costo_base === undefined) {
      return NextResponse.json({ error: "Campos requeridos: codigo, nombre, costo_base" }, { status: 400 });
    }

    // Proveedores N:M: `proveedor_ids` (nuevo) o `proveedor_id` (legacy).
    const proveedorIds = body.proveedor_ids !== undefined
      ? normalizarProveedorIds(body.proveedor_ids)
      : normalizarProveedorIds(proveedor_id);
    const proveedorPrincipal = proveedorIds[0] ?? null;

    const presentaciones = normalizarPresentaciones(body) ?? [];
    const margen = Math.max(0, Number(margen_ganancia) || 0);

    const result = await transaction(async (client) => {
      // Catálogo temprano: necesario para autocalcular el precio desde el margen.
      const monedasPre = await client.query(`SELECT * FROM monedas`);
      const catalogoPre = monedasPre.rows;
      const monedaBasePre = catalogoPre.find((m: any) => m.es_base) || catalogoPre[0];

      // Reglas del motor leídas DENTRO de la transacción: la cascada de precios
      // (costo → moneda de venta) y las derivaciones por moneda respetan el
      // método configurado (directa o triangulación), igual que las compras.
      const cfgGlobal = await getConfiguracionGlobal({
        query: (text: string, params?: any[]) => client.query(text, params),
      });
      const reglas = reglasConversion(cfgGlobal, catalogoPre);

      const monedaVentaPre = monedaDeProducto({ moneda_base_id: moneda_base_id || null }, monedaBasePre, catalogoPre);
      const monedaCostoPre = monedaCostoDeProducto(
        { moneda_base_id: moneda_base_id || null, moneda_costo_id: moneda_costo_id || null },
        monedaBasePre,
        catalogoPre
      );
      const decVentaPre = Number(monedaVentaPre.decimales ?? 2);

      // Precio de venta final: el enviado, o costo→moneda de venta × (1 + margen%).
      // La conversión del costo usa la regla de COMPRAS (la cascada es efecto de
      // la compra): en triangulación pasa por la moneda de tránsito configurada.
      const costoN = Number(costo_base) || 0;
      let precioFinal = Number(precio_base);
      if (!Number.isFinite(precioFinal)) {
        const costoEnVenta = convertirConMetodo(costoN, monedaCostoPre, monedaVentaPre, {
          ...reglas.compras,
          catalogo: catalogoPre,
        }, decVentaPre);
        const bruto = margen > 0
          ? redondear(costoEnVenta * (1 + margen / 100), decVentaPre)
          : redondear(costoEnVenta, decVentaPre);
        // Se respeta la regla global de redondeo de precios (Configuración →
        // Precios): sin esto, un precio derivado del margen quedaba en 23.47
        // mientras el motor de compras lo redondeaba a 25, y el mismo producto
        // tenía dos precios según por dónde hubiera pasado.
        precioFinal = aplicarReglasRedondeo(bruto, cfgGlobal, costoEnVenta).precio;
      }

      // CPP inicial: el costo estático de alta (sirve de base para el margen y
      // para la primera fusión en compras; con stock 0 no diluye nada). Se lleva
      // a la moneda base con la MISMA regla de compras (método configurado).
      const costoPromedioInicial = costoN;
      const costoPromedioBaseInicial = redondear(
        convertirConMetodo(costoN, monedaCostoPre, monedaBasePre, {
          ...reglas.compras,
          catalogo: catalogoPre,
        }, 6),
        6
      );

      const res = await client.query(
        `INSERT INTO productos (codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, margen_ganancia, costo_promedio, costo_promedio_base, activo, iva_incluido, moneda_base_id, moneda_costo_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
         RETURNING *`,
        [codigo, nombre, descripcion || null, categoria_id || null, marca_id || null, proveedorPrincipal, stock || 0, stock_minimo ?? 5, precioFinal, costo_base, margen, costoPromedioInicial, costoPromedioBaseInicial, activo !== false, iva_incluido !== false, moneda_base_id || null, moneda_costo_id || null]
      );

      const producto = res.rows[0];

      // Los códigos de las cajas se validan DESPUÉS del insert del producto:
      // así una caja puede llevar el mismo código que el producto que recién se
      // creó, y la comparación excluye explícitamente ese producto.
      await validarCodigosPresentaciones(client, presentaciones, producto.id);

      // Relación N:M producto ⇄ proveedor (la fuente de verdad de la lista).
      for (const pid of proveedorIds) {
        await client.query(
          `INSERT INTO producto_proveedores (producto_id, proveedor_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [producto.id, pid]
        );
      }

      // Presentaciones: se insertan tal cual (validación/limpieza ya hechas)
      for (const pres of presentaciones) {
        await client.query(
          `INSERT INTO producto_presentaciones (producto_id, nombre, unidades, activo, codigo, modo_venta, precio_override, margen_override)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            producto.id,
            pres.nombre,
            pres.unidades,
            pres.activo,
            pres.codigo,
            pres.modo_venta,
            pres.precio_override,
            pres.margen_override,
          ]
        );
      }

      // `precio_base` está en la moneda de VENTA (moneda_base_id) y `costo_base`
      // en la de COMPRA (moneda_costo_id, NULL = misma); los precios por moneda
      // se derivan de ahí con la cadena de conversiones (src/lib/money.ts)
      // Catálogo completo (incluso monedas inactivas): los precios históricos
      // deben poder convertirse aunque la moneda esté desactivada
      const monedas = await client.query(`SELECT * FROM monedas`);
      const catalogo = monedas.rows;
      const monedaBase = catalogo.find((m: any) => m.es_base) || catalogo[0];
      const monedaProducto = monedaDeProducto(producto, monedaBase, catalogo);
      const monedaCosto = monedaCostoDeProducto(producto, monedaBase, catalogo);

      for (const moneda of catalogo) {
        let precio: number;
        let costo: number;

        if (body.precios && body.precios[moneda.id]) {
          precio = body.precios[moneda.id].precio;
          costo = body.precios[moneda.id].costo;
        } else {
          // Derivación respetando el motor: precio con la regla de ventas y
          // costo con la de compras (mismo criterio que el GET y las compras).
          const decimales = Number(moneda.decimales ?? 2);
          precio = convertirConMetodo(Number(precio_base), monedaProducto, moneda, {
            ...reglas.ventas,
            catalogo,
          }, decimales);
          costo = convertirConMetodo(Number(costo_base), monedaCosto, moneda, {
            ...reglas.compras,
            catalogo,
          }, decimales);
        }

        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo) 
           VALUES ($1, $2, $3, $4)`,
          [producto.id, moneda.id, precio, costo]
        );
      }

      if (stock > 0) {
        // El kardex guarda el costo en la moneda de COMPRA del producto y su
        // equivalente USD, con la MISMA regla de compras del motor (método
        // configurado), para que el CPP inicial sea consistente.
        const costoUsd = convertirConMetodo(Number(costo_base), monedaCosto, monedaBase, {
          ...reglas.compras,
          catalogo,
        }, 2);
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', 'Existencias iniciales', $2, $3, $4, 0, $2)`,
          [producto.id, stock, costo_base, costoUsd]
        );
      }

      return producto;
    });

    triggerBackgroundSync();
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Error al crear producto:", error);
    const err = error as { code?: string; constraint?: string; message?: string };
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (err.code === "23505") {
      if (err.constraint === "idx_producto_presentaciones_codigo") {
        return NextResponse.json({ error: "Ese código de barras ya lo usa otra caja" }, { status: 400 });
      }
      if (err.constraint?.includes("codigo")) {
        return NextResponse.json({ error: "Ya existe un producto con ese código" }, { status: 400 });
      }
      if (err.constraint?.includes("producto_presentaciones")) {
        return NextResponse.json({ error: "Ya existe una presentación con ese nombre para el producto" }, { status: 400 });
      }
      return NextResponse.json({ error: "Registro duplicado" }, { status: 400 });
    }
    return NextResponse.json({ error: err.message || "Error al crear producto" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id, stock, stock_minimo, precio_base, costo_base, activo, iva_incluido, moneda_base_id, moneda_costo_id, margen_ganancia } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    // Lista N:M de proveedores enviada por el cliente (null = no tocarla).
    const proveedorIdsEnviados =
      body.proveedor_ids !== undefined ? normalizarProveedorIds(body.proveedor_ids) : null;

    const presentaciones = normalizarPresentaciones(body);
    const margenEnviado = Object.prototype.hasOwnProperty.call(body, "margen_ganancia");

    const result = await transaction(async (client) => {
      const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [id]);
      if (productoActual.rows.length === 0) {
        throw new Error("Producto no encontrado");
      }

      const productoAnterior = productoActual.rows[0];
      const enviado2 = (campo: string) => Object.prototype.hasOwnProperty.call(body, campo);

      // Reglas del motor leídas DENTRO de la transacción (idénticas a POST y
      // compras): la cascada de margen y las derivaciones por moneda respetan
      // el método configurado (directa o triangulación).
      const cfgGlobal = await getConfiguracionGlobal({
        query: (text: string, params?: any[]) => client.query(text, params),
      });
      const monedasMotor = await client.query(`SELECT * FROM monedas`);
      const reglas = reglasConversion(cfgGlobal, monedasMotor.rows);

      // Margen efectivo: el enviado o el vigente del producto.
      const margen = margenEnviado
        ? Math.max(0, Number(margen_ganancia) || 0)
        : Math.max(0, Number(productoAnterior.margen_ganancia) || 0);

      // Si SOLO cambió el margen (sin precio manual), autocalcular el precio de
      // venta: costo → moneda de venta × (1 + margen/100). La conversión del
      // costo usa la regla de COMPRAS (la cascada es efecto de la compra).
      let precioParam = precio_base;
      if (margenEnviado && !enviado2("precio_base")) {
        const catalogoCalc = monedasMotor.rows;
        const monedaBaseCalc = catalogoCalc.find((m: any) => m.es_base) || catalogoCalc[0];
        const mVen = monedaDeProducto(productoAnterior, monedaBaseCalc, catalogoCalc);
        const mCos = monedaCostoDeProducto(productoAnterior, monedaBaseCalc, catalogoCalc);
        const decVen = Number(mVen.decimales ?? 2);
        const costoN = Number(costo_base ?? productoAnterior.costo_base) || 0;
        const costoEnVenta = convertirConMetodo(costoN, mCos, mVen, {
          ...reglas.compras,
          catalogo: catalogoCalc,
        }, decVen);
        const bruto = margen > 0
          ? redondear(costoEnVenta * (1 + margen / 100), decVen)
          : redondear(costoEnVenta, decVen);
        // Igual que en el alta: el precio derivado del margen pasa por la regla
        // global de redondeo, o el margen guardado y el precio guardado
        // describirían utilidades distintas.
        precioParam = aplicarReglasRedondeo(bruto, cfgGlobal, costoEnVenta).precio;
      }

      // Las columnas de moneda se VACÍAN si vienen explícitamente en `null`
      // (volver a la moneda del sistema, o a la de venta para el costo); un
      // COALESCE no puede distinguir "no enviado" de "vaciar". Si la clave no
      // viene en el body, se conserva el valor anterior.
      const enviado = (campo: string) => Object.prototype.hasOwnProperty.call(body, campo);
      const limpiarMonedaVenta = enviado("moneda_base_id") && moneda_base_id == null;
      const limpiarMonedaCosto = enviado("moneda_costo_id") && moneda_costo_id == null;
      const setMonedaVenta = limpiarMonedaVenta ? "NULL" : "COALESCE($14, moneda_base_id)";
      const setMonedaCosto = limpiarMonedaCosto ? "NULL" : "COALESCE($15, moneda_costo_id)";

      const params: any[] = [
        id, codigo, nombre, descripcion, categoria_id, marca_id, proveedor_id || null, stock, stock_minimo,
        precioParam, costo_base, activo, iva_incluido,
      ];
      // Los parámetros se anexan solo si su columna los usa, para que el número
      // de `$n` del SQL coincida con el de los valores enviados.
      if (!limpiarMonedaVenta) params.push(moneda_base_id || null);
      if (!limpiarMonedaCosto) params.push(moneda_costo_id || null);

      const res = await client.query(
        `UPDATE productos 
         SET codigo = COALESCE($2, codigo), 
             nombre = COALESCE($3, nombre),
             descripcion = COALESCE($4, descripcion),
             categoria_id = COALESCE($5, categoria_id),
             marca_id = COALESCE($6, marca_id),
             proveedor_id = COALESCE($7, proveedor_id),
             stock = COALESCE($8, stock),
             stock_minimo = COALESCE($9, stock_minimo),
             precio_base = COALESCE($10, precio_base),
             costo_base = COALESCE($11, costo_base),
             activo = COALESCE($12, activo),
             iva_incluido = COALESCE($13, iva_incluido),
             moneda_base_id = ${setMonedaVenta},
             moneda_costo_id = ${setMonedaCosto}
         WHERE id = $1 
         RETURNING *`,
        params
      );

      const nuevoPrecio = precioParam ?? productoAnterior.precio_base;
      const nuevoCosto = costo_base ?? productoAnterior.costo_base;

      // Igual que en el POST: `precio_base` se deriva desde la moneda de venta y
      // `costo_base` desde la de compra (independientes) hacia cada moneda
      // Catálogo completo (incluso monedas inactivas): los precios históricos
      // deben poder convertirse aunque la moneda esté desactivada. Reutiliza el
      // catálogo ya leído para las reglas del motor.
      const catalogo = monedasMotor.rows;
      const monedaBase = catalogo.find((m: any) => m.es_base) || catalogo[0];
      const monedaProducto = monedaDeProducto(res.rows[0], monedaBase, catalogo);
      const monedaCosto = monedaCostoDeProducto(res.rows[0], monedaBase, catalogo);

      for (const moneda of catalogo) {
        let precio: number;
        let costo: number;

        if (body.precios && body.precios[moneda.id]) {
          precio = body.precios[moneda.id].precio;
          costo = body.precios[moneda.id].costo;
        } else {
          // Derivación respetando el motor: precio con la regla de ventas y
          // costo con la de compras (mismo criterio que el GET y las compras).
          const decimales = Number(moneda.decimales ?? 2);
          precio = convertirConMetodo(Number(nuevoPrecio), monedaProducto, moneda, {
            ...reglas.ventas,
            catalogo,
          }, decimales);
          costo = convertirConMetodo(Number(nuevoCosto), monedaCosto, moneda, {
            ...reglas.compras,
            catalogo,
          }, decimales);
        }

        await client.query(
          `INSERT INTO producto_precios (producto_id, moneda_id, precio, costo) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (producto_id, moneda_id) 
           DO UPDATE SET precio = $3, costo = $4`,
          [id, moneda.id, precio, costo]
        );
      }

      // ── Presentaciones: reconciliar la lista enviada contra la guardada ──
      // Las que ya no vienen se ELIMINAN: sus referencias en compra_items ya
      // guardan un snapshot (presentacion_nombre/unidades) y la FK es SET NULL,
      // así que la factura histórica no pierde la presentación comprada.
      // Si el body no trajo `presentaciones` (cliente viejo) no se tocan.
      if (presentaciones !== null) {
        const existentes = await client.query(
          `SELECT id FROM producto_presentaciones WHERE producto_id = $1`,
          [id]
        );
        const idsGuardados = new Set<string>(existentes.rows.map((r: any) => String(r.id)));
        const idsEnviados = new Set<string>(presentaciones.filter((p) => p.id !== null).map((p) => String(p.id)));

        // Los códigos se validan una sola vez contra el estado ACTUAL de la BD
        // (antes de borrar ni actualizar nada): cada caja se excluye a sí misma,
        // y las que se van a eliminar todavía no molestan. Solo dentro de este
        // producto, para no rechazar una caja de otro producto que ya traía ese
        // código de fábrica (esa se detectaría al crearse).
        await validarCodigosPresentaciones(client, presentaciones, id);

        for (const guard of idsGuardados) {
          if (!idsEnviados.has(guard)) {
            await client.query(`DELETE FROM producto_presentaciones WHERE id = $1`, [guard]);
          }
        }
        for (const pres of presentaciones) {
          if (pres.id && idsGuardados.has(pres.id)) {
            await client.query(
              `UPDATE producto_presentaciones
               SET nombre = $2, unidades = $3, activo = $4, codigo = $5,
                   modo_venta = $6, precio_override = $7, margen_override = $8
               WHERE id = $1`,
              [
                pres.id,
                pres.nombre,
                pres.unidades,
                pres.activo,
                pres.codigo,
                pres.modo_venta,
                pres.precio_override,
                pres.margen_override,
              ]
            );
          } else {
            await client.query(
              `INSERT INTO producto_presentaciones (producto_id, nombre, unidades, activo, codigo, modo_venta, precio_override, margen_override)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                id,
                pres.nombre,
                pres.unidades,
                pres.activo,
                pres.codigo,
                pres.modo_venta,
                pres.precio_override,
                pres.margen_override,
              ]
            );
          }
        }
      }

      // Margen de ganancia: se persiste aparte (el UPDATE principal mantiene su
      // numeración dinámica de parámetros de monedas). Solo si el margen o el
      // precio realmente cambiaron se marca el precio como manual; una edición
      // de solo nombre/categoría NO apaga el precio automático.
      if (margenEnviado) {
        const margenCambio = Math.abs(Number(margen) - Number(productoAnterior.margen_ganancia)) > 1e-9;
        const precioCambio =
          enviado2("precio_base") &&
          Math.abs(Number(precioParam ?? 0) - Number(productoAnterior.precio_base)) > 1e-9;
        if (margenCambio || precioCambio) {
          await client.query(
            `UPDATE productos SET margen_ganancia = $2, precio_auto = false WHERE id = $1`,
            [id, margen]
          );
        }
      } else if (
        enviado2("precio_base") &&
        Math.abs(Number(precio_base) - Number(productoAnterior.precio_base)) > 1e-9
      ) {
        await client.query(`UPDATE productos SET precio_auto = false WHERE id = $1`, [id]);
      }

      // Relación N:M de proveedores: reemplazo completo (la lista es la fuente
      // de verdad). Se sincroniza `proveedor_id` con el PRIMER proveedor (o NULL
      // si la lista quedó vacía), sobrescribiendo el COALESCE del UPDATE principal.
      if (proveedorIdsEnviados !== null) {
        await client.query(`DELETE FROM producto_proveedores WHERE producto_id = $1`, [id]);
        for (const pid of proveedorIdsEnviados) {
          await client.query(
            `INSERT INTO producto_proveedores (producto_id, proveedor_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, pid]
          );
        }
        await client.query(`UPDATE productos SET proveedor_id = $2 WHERE id = $1`, [
          id,
          proveedorIdsEnviados[0] ?? null,
        ]);
      }

      return res.rows[0];
    });

    if (!result) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    triggerBackgroundSync();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const err = error as { code?: string; constraint?: string; message?: string };
    if (err?.code === "23505") {
      if (err.constraint === "idx_producto_presentaciones_codigo") {
        return NextResponse.json({ error: "Ese código de barras ya lo usa otra caja" }, { status: 400 });
      }
      if (err.constraint?.includes("producto_presentaciones")) {
        return NextResponse.json({ error: "Ya existe una presentación con ese nombre para el producto" }, { status: 400 });
      }
    }
    return NextResponse.json({ error: err?.message || "Error al actualizar producto" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const compraCount = await queryOne(`SELECT COUNT(*) FROM compra_items WHERE producto_id = $1`, [id]);
    const ventaCount = await queryOne(`SELECT COUNT(*) FROM venta_items WHERE producto_id = $1`, [id]);

    if ((compraCount && parseInt(compraCount.count) > 0) || (ventaCount && parseInt(ventaCount.count) > 0)) {
      return NextResponse.json({ error: "No se puede eliminar: tiene compras o ventas asociadas" }, { status: 400 });
    }

    await execute(`DELETE FROM productos WHERE id = $1`, [id]);
    triggerBackgroundSync();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar producto" }, { status: 500 });
  }
}
