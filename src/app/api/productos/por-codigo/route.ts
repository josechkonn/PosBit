export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";
import { preciosDeProducto, presentacionesDeProducto, monedaDeProducto, reglasConversion, convertirConMetodo } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

/**
 * GET /api/productos/por-codigo?codigo=XXX
 *
 * Resuelve lo que el usuario Tecleó (lector físico o barra de búsqueda) a una
 * cosa concreta del catálogo. Es el ÚNICO lugar donde se decide si un código
 * apunta a un PRODUCTO o a una CAJA, para que POS, kardex, productos y compras
 * se comporten igual y no duplicen la regla.
 *
 * Respuesta:
 *   { tipo: "presentacion", producto: {...}, presentacion: {...} }
 *   { tipo: "producto",    producto: {...}, presentacion: null }
 *   404 si no hay coincidencia
 *
 * Orden de resolución:
 *   1. Código EXACTO de una caja activa (la caja manda: si escanean una caja,
 *      quieren la caja, aunque el texto coincida con el nombre de un producto).
 *   2. Código EXACTO de un producto.
 *   3. Si no hay exacto, cae a coincidencia parcial por nombre/código/descripción,
 *      igual que el buscador de siempre, para no romper la búsqueda a mano.
 *
 * Todo se compara con `lower()` porque el escaneo es insensible a mayúsculas.
 * La unicidad de los códigos la garantiza el índice único de la BD.
 */
export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const codigo = (searchParams.get("codigo") || searchParams.get("q") || "").trim();

    if (!codigo) {
      return NextResponse.json({ error: "Falta el código" }, { status: 400 });
    }

    // ── 1. Código exacto de una CAJA activa ──
    // Se resuelve primero a propósito: escanear el código de una caja debe
    // agregar LA CAJA, aunque el mismo texto aparezca como nombre de otro
    // producto (típico con códigos internos que alguien también escribió de
    // memoria como texto a buscar).
    const presRes = await query(
      `SELECT pp.id, pp.producto_id, pp.nombre, pp.unidades, pp.activo, pp.codigo,
              pp.modo_venta, pp.precio_override, pp.margen_override
         FROM producto_presentaciones pp
         JOIN productos p ON p.id = pp.producto_id
        WHERE lower(pp.codigo) = lower($1)
          AND (p.eliminado IS NULL OR p.eliminado = false)
        LIMIT 1`,
      [codigo]
    );

    // ── 2. Código exacto de un PRODUCTO ──
    const prodRes = await query(
      `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre,
              pr.nombre as proveedor_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         LEFT JOIN marcas m ON p.marca_id = m.id
         LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
        WHERE lower(p.codigo) = lower($1)
          AND (p.eliminado IS NULL OR p.eliminado = false)
        LIMIT 1`,
      [codigo]
    );

    // Sin coincidencia exacta: se cae al comportamiento de búsqueda actual.
    // Solo se acepta un resultado claro (código exacto ya cubierto arriba) o un
    // único candidato, que es lo que hacen hoy las pantallas por su cuenta.
    if (presRes.length === 0 && prodRes.length === 0) {
      const difusos = await query(
        `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre,
                pr.nombre as proveedor_nombre
           FROM productos p
           LEFT JOIN categorias c ON p.categoria_id = c.id
           LEFT JOIN marcas m ON p.marca_id = m.id
           LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
          WHERE p.activo = true
            AND (p.eliminado IS NULL OR p.eliminado = false)
            AND (p.nombre ILIKE $1 OR p.codigo ILIKE $1 OR p.descripcion ILIKE $1
                 OR EXISTS (
                   SELECT 1 FROM producto_presentaciones pp
                    WHERE pp.producto_id = p.id AND pp.codigo IS NOT NULL AND pp.codigo ILIKE $1
                 ))
          ORDER BY
            -- el que más "se parece" al texto va primero
            (CASE WHEN p.codigo ILIKE $1 THEN 0 ELSE 1 END),
            p.nombre ASC
          LIMIT 5`,
        [`%${codigo}%`]
      );
      if (difusos.length !== 1) {
        return NextResponse.json({ found: false, resultados: difusos.length }, { status: 404 });
      }
      const p = difusos[0];
      return NextResponse.json(await armarRespuesta(p, null, "producto"));
    }

    if (presRes.length > 0) {
      const pres = presRes[0];
      const producto = await query(
        `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre,
                pr.nombre as proveedor_nombre
           FROM productos p
           LEFT JOIN categorias c ON p.categoria_id = c.id
           LEFT JOIN marcas m ON p.marca_id = m.id
           LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
          WHERE p.id = $1
            AND (p.eliminado IS NULL OR p.eliminado = false)`,
        [pres.producto_id]
      );
      if (producto.length === 0) {
        return NextResponse.json({ found: false }, { status: 404 });
      }
      return NextResponse.json(await armarRespuesta(producto[0], pres, "presentacion"));
    }

    return NextResponse.json(await armarRespuesta(prodRes[0], null, "producto"));
  } catch (error) {
    console.error("Error resolviendo código:", error);
    return NextResponse.json({ error: "Error al resolver el código" }, { status: 500 });
  }
}

/**
 * Catálogo de monedas. NO se cachea a nivel de módulo a propósito: si alguien
 * cambia una tasa desde /monedas, la siguiente resolución ya debe usar la nueva
 * (cambiar la tasa y escanear al momento es un caso normal en caja).
 */
async function catalogoMonedas(): Promise<any[]> {
  return await query(
    `SELECT id, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo,
            usa_tasa_usd_directa, tasa_usd_directa
       FROM monedas ORDER BY es_base DESC, codigo ASC, id ASC`
  );
}

/** Arma la respuesta: producto con precios por moneda + sus cajas resueltas. */
async function armarRespuesta(producto: any, presentacionRow: any | null, tipo: "producto" | "presentacion") {
  const catalogo = await catalogoMonedas();
  const baseSistema = catalogo.find((m: any) => m.es_base) || catalogo[0];
  const cfgGlobal = await getConfiguracionGlobal();
  const reglas = reglasConversion(cfgGlobal, catalogo);

  const filas = await query(
    `SELECT id, producto_id, nombre, unidades, activo, codigo,
            modo_venta, precio_override, margen_override
       FROM producto_presentaciones
      WHERE producto_id = $1
      ORDER BY nombre ASC, unidades ASC`,
    [producto.id]
  );
  const activas = (filas as any[]).filter((pr) => pr.activo !== false);

  const monedaVenta = monedaDeProducto(producto, baseSistema, catalogo) as any;
  const cppBase = Number(producto.costo_promedio_base) || 0;
  const costoUnitarioVenta =
    cppBase > 0
      ? convertirConMetodo(cppBase, baseSistema as any, monedaVenta, {
          metodo: reglas.compras.metodo,
          monedaTransito: reglas.compras.monedaTransito,
          catalogo,
        }, 6)
      : null;

  const presentaciones = presentacionesDeProducto(
    producto,
    filas as any[],
    Number((monedaVenta as any)?.decimales ?? 2),
    costoUnitarioVenta
  );

  // La caja escaneada se devuelve tal cual vino (con su `codigo`), no filtrada:
  // el POS la necesita aunque venga marcada como inactiva, para avisar.
  return {
    found: true,
    tipo,
    producto: {
      ...producto,
      precios: preciosDeProducto(producto, catalogo, baseSistema, reglas),
      presentaciones,
    },
    presentacion:
      presentacionRow === null
        ? null
        : (presentaciones.find((pr) => pr.id === String(presentacionRow.id)) ?? {
            id: String(presentacionRow.id),
            nombre: presentacionRow.nombre,
            unidades: Number(presentacionRow.unidades),
            activo: presentacionRow.activo !== false,
            codigo: presentacionRow.codigo ?? null,
          }),
  };
}
