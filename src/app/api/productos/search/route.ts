export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";
import { preciosDeProducto } from "@/lib/money";

/**
 * GET /api/productos/search?q=texto
 * Lightweight product search for autocomplete.
 * Returns up to 15 active products with their per-currency prices.
 *
 * Los precios por moneda se DERIVAN en lectura desde `precio_base`/`costo_base`
 * con las tasas actuales; solo la moneda base del producto es un valor fijo.
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
        p.stock, c.nombre as categoria_nombre
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = true
        AND (
          p.nombre ILIKE $1
          OR p.codigo ILIKE $1
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

    const conPrecios = (productos as any[]).map((p) => ({
      ...p,
      precios: preciosDeProducto(p, catalogo, baseSistema),
    }));

    return NextResponse.json(conPrecios);
  } catch (error) {
    console.error("Error searching products:", error);
    return NextResponse.json({ error: "Error al buscar productos" }, { status: 500 });
  }
}