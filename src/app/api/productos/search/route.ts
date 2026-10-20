export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";
import { preciosDeProducto, presentacionesDeProducto, monedaDeProducto, reglasConversion, convertirConMetodo } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

/**
 * GET /api/productos/search?q=texto
 * Lightweight product search for autocomplete.
 * Returns up to 15 active products with their per-currency prices.
 *
 * Los precios por moneda se DERIVAN en lectura desde `precio_base` (moneda de
 * venta) y `costo_base` (moneda de compra) con las tasas actuales.
 */
export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();

    if (q.length < 1) {
      return NextResponse.json([]);
    }

    const productos = await query(
      `
      SELECT 
        p.id, p.codigo, p.nombre, p.precio_base, p.costo_base, p.moneda_base_id,
        p.moneda_costo_id,
        p.stock, p.margen_ganancia, p.costo_promedio_base, c.nombre as categoria_nombre
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = true
        AND (p.eliminado IS NULL OR p.eliminado = false)
        AND (
          p.nombre ILIKE $1
          OR p.codigo ILIKE $1
          OR EXISTS (
            SELECT 1 FROM producto_presentaciones pp
             WHERE pp.producto_id = p.id AND pp.codigo IS NOT NULL AND pp.codigo ILIKE $1
          )
        )
      ORDER BY p.nombre ASC
      LIMIT 15
      `,
      [`%${q}%`]
    );

    // Catálogo completo (incluso monedas inactivas), igual que el resto del sistema.
    const catalogo = await query(
      `SELECT id, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo, usa_tasa_usd_directa, tasa_usd_directa FROM monedas ORDER BY es_base DESC, codigo ASC, id ASC`
    );
    const baseSistema = catalogo.find((m: any) => m.es_base) || catalogo[0];

    // Reglas del motor (método de conversión por lado), mismas que el GET de
    // productos y las compras: el costo se deriva con la regla de compras y el
    // precio con la de ventas.
    const cfgGlobal = await getConfiguracionGlobal();
    const reglas = reglasConversion(cfgGlobal, catalogo);

    // Presentaciones activas de los resultados (para el selector de presentación)
    const productoIds = (productos as any[]).map((p) => p.id);
    const presentacionesRows = productoIds.length
      ? await query(
          `SELECT id, producto_id, nombre, unidades, activo, codigo,
                  modo_venta, precio_override, margen_override
           FROM producto_presentaciones
           WHERE producto_id = ANY($1::int[])
           ORDER BY nombre ASC, unidades ASC`,
          [productoIds]
        )
      : [];
    const presPorProducto = new Map<number, any[]>();
    for (const pr of presentacionesRows as any[]) {
      if (pr.activo === false) continue; // el selector solo ofrece activas
      const lista = presPorProducto.get(pr.producto_id) || [];
      lista.push(pr);
      presPorProducto.set(pr.producto_id, lista);
    }

    const decimalesVenta = (p: any) => {
      const m = monedaDeProducto(p, baseSistema, catalogo);
      return Number((m as any)?.decimales ?? 2);
    };

    const conPrecios = (productos as any[]).map((p) => {
      // El precio de la presentación vive en la MONEDA DE VENTA, así que el modo
      // 'margen' necesita el CPP convertido a esa moneda (viene en USD base).
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
      };
    });

    return NextResponse.json(conPrecios);
  } catch (error) {
    console.error("Error searching products:", error);
    return NextResponse.json({ error: "Error al buscar productos" }, { status: 500 });
  }
}