export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne } from "@/lib/db";

/**
 * Detalle completo de un cliente para su perfil: datos, límite de crédito y
 * deuda en CADA moneda activa (aunque sean 0), estadísticas agregadas y el
 * ranking de productos que más compra.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;

    const cliente = await queryOne(
      `SELECT cl.*,
        (SELECT COUNT(*) FROM ventas v WHERE v.cliente_id = cl.id) as ventas_count,
        (SELECT COUNT(*) FROM retornos r WHERE r.cliente_id = cl.id) as retornos_count
       FROM clientes cl
       WHERE cl.id = $1`,
      [id]
    );

    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Una fila por moneda activa: límite de crédito y deuda pendiente. Se
    // incluyen las monedas con 0 para que el perfil muestre el panorama completo.
    const monedas = await query(
      `SELECT m.id, m.codigo, m.simbolo, m.es_base, m.decimales,
              COALESCE(lc.limite, 0) as limite,
              COALESCE(d.saldo, 0) as deuda
       FROM monedas m
       LEFT JOIN cliente_limites_credito lc
         ON lc.moneda_id = m.id AND lc.cliente_id = $1
       LEFT JOIN (
         SELECT cr.moneda_id, SUM(cr.saldo) as saldo
         FROM creditos cr
         WHERE cr.cliente_id = $1 AND cr.estado <> 'Pagado'
         GROUP BY cr.moneda_id
       ) d ON d.moneda_id = m.id
       WHERE m.activo = true
       ORDER BY m.es_base DESC, m.codigo ASC`,
      [id]
    );

    const statsRow = await queryOne<{
      total_comprado_base: string;
      ultima_compra: string | null;
    }>(
      `SELECT
         COALESCE(SUM(v.total_base), 0) as total_comprado_base,
         MAX(v.fecha) as ultima_compra
       FROM ventas v
       WHERE v.cliente_id = $1`,
      [id]
    );

    const topProductos = await query(
      `SELECT pr.id, pr.codigo, pr.nombre,
              SUM(vi.cantidad) as cantidad_total,
              COUNT(DISTINCT vi.venta_id) as veces,
              SUM(vi.subtotal_base - vi.descuento_base) as monto_base
       FROM venta_items vi
       JOIN ventas v ON vi.venta_id = v.id
       JOIN productos pr ON vi.producto_id = pr.id
       WHERE v.cliente_id = $1
       GROUP BY pr.id, pr.codigo, pr.nombre
       ORDER BY monto_base DESC
       LIMIT 20`,
      [id]
    );

    const ventasCount = Number(cliente.ventas_count || 0);
    const totalComprado = parseFloat(statsRow?.total_comprado_base || "0") || 0;

    return NextResponse.json({
      cliente: {
        ...cliente,
        monedas: monedas.map((m: any) => ({
          moneda_id: m.id,
          codigo: m.codigo,
          simbolo: m.simbolo,
          es_base: m.es_base,
          decimales: m.decimales,
          limite: parseFloat(m.limite || "0") || 0,
          deuda: parseFloat(m.deuda || "0") || 0,
        })),
      },
      stats: {
        ventas_count: ventasCount,
        retornos_count: Number(cliente.retornos_count || 0),
        total_comprado_base: totalComprado,
        ticket_promedio_base: ventasCount > 0 ? totalComprado / ventasCount : 0,
        ultima_compra: statsRow?.ultima_compra ?? null,
      },
      top_productos: topProductos.map((p: any) => ({
        producto_id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        cantidad_total: Number(p.cantidad_total || 0),
        veces: Number(p.veces || 0),
        monto_base: parseFloat(p.monto_base || "0") || 0,
      })),
    });
  } catch (error) {
    console.error("Error al obtener cliente:", error);
    return NextResponse.json({ error: "Error al obtener cliente" }, { status: 500 });
  }
}
