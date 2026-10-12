export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;

    const deuda = await query(`
      SELECT * FROM vista_deuda_compras WHERE proveedor_id = $1
      ORDER BY fecha
    `, [id]);

    const resumen = await query(`
      SELECT * FROM vista_deuda_proveedores WHERE proveedor_id = $1
    `, [id]);

    return NextResponse.json({ 
      proveedor_id: id,
      resumen: resumen[0] || { deuda_total_base: 0, compras_pendientes: 0, fecha_mas_antigua: null },
      compras: deuda
    });
  } catch (error) {
    console.error("Error al obtener deuda:", error);
    return NextResponse.json({ error: "Error al obtener deuda" }, { status: 500 });
  }
}