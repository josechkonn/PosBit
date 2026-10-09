export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

/**
 * GET /api/productos/search?q=texto
 * Lightweight product search for autocomplete.
 * Returns up to 15 active products with their per-currency prices.
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
        p.id, p.codigo, p.nombre, p.stock, p.costo_base, p.moneda_base_id,
        c.nombre as categoria_nombre,
        json_agg(
          json_build_object(
            'moneda_id', pp.moneda_id,
            'moneda_codigo', mo.codigo,
            'moneda_simbolo', mo.simbolo,
            'tasa', mo.tasa,
            'usa_tasa_usd_directa', mo.usa_tasa_usd_directa,
            'tasa_usd_directa', mo.tasa_usd_directa,
            'costo', pp.costo,
            'precio', pp.precio,
            'es_base', mo.es_base
          ) ORDER BY mo.es_base DESC, mo.codigo ASC
        ) FILTER (WHERE pp.moneda_id IS NOT NULL) as precios
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN producto_precios pp ON p.id = pp.producto_id
      LEFT JOIN monedas mo ON pp.moneda_id = mo.id
      WHERE p.activo = true
        AND (
          p.nombre ILIKE $1
          OR p.codigo ILIKE $1
        )
      GROUP BY p.id, c.nombre
      ORDER BY p.nombre ASC
      LIMIT 15
      `,
      [`%${q}%`]
    );

    return NextResponse.json(productos);
  } catch (error) {
    console.error("Error searching products:", error);
    return NextResponse.json({ error: "Error al buscar productos" }, { status: 500 });
  }
}
