export const dynamic = 'force-dynamic';

// ============================================================================
// POSBIT - Últimos costos por producto/presentación/moneda
// ----------------------------------------------------------------------------
// Fuente del AUTOCUMPLETADO del formulario de compras: devuelve cómo se pagó
// por última vez (ej. "1 Caja por 480") para sugerirlo al operador.
// GET /api/compras/ultimos-costos?producto_id=..&moneda_id=..&presentacion_id=..
// ============================================================================

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";
import { ultimosCostosDeProducto } from "@/lib/costing";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const producto_id = parseInt(searchParams.get("producto_id") || "", 10);
    if (!Number.isInteger(producto_id) || producto_id <= 0) {
      return NextResponse.json({ error: "producto_id requerido" }, { status: 400 });
    }

    const historial = await ultimosCostosDeProducto(query, producto_id, {
      monedaId: searchParams.get("moneda_id"),
      presentacionId: searchParams.get("presentacion_id"),
      limite: 10,
    });

    return NextResponse.json(historial);
  } catch (error) {
    console.error("Error al obtener historial de costos:", error);
    return NextResponse.json({ error: "Error al obtener historial de costos" }, { status: 500 });
  }
}