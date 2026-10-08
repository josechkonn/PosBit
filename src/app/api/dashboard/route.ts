import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireSession();

    const { searchParams } = new URL(request.url);
    const fechaInicio = searchParams.get("fecha_inicio");
    const fechaFin = searchParams.get("fecha_fin");
    const tieneRango = Boolean(fechaInicio && fechaFin);

    const monedas = await query(
      `SELECT * FROM monedas WHERE activo = true ORDER BY es_base DESC, codigo ASC, id ASC`
    );

    const dashboardData: Record<string, any> = {};

    for (const moneda of monedas) {
      const ventasMes = tieneRango
        ? await query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
             FROM ventas 
             WHERE estado = 'Pagada' AND moneda_id = $1
             AND fecha::date BETWEEN $2 AND $3`,
            [moneda.id, fechaInicio, fechaFin]
          )
        : await query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
             FROM ventas 
             WHERE estado = 'Pagada' AND moneda_id = $1
             AND fecha >= date_trunc('month', CURRENT_DATE)`,
            [moneda.id]
          );

      const comprasMes = tieneRango
        ? await query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
             FROM compras 
             WHERE estado = 'Recibida' AND moneda_id = $1
             AND fecha::date BETWEEN $2 AND $3`,
            [moneda.id, fechaInicio, fechaFin]
          )
        : await query(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
             FROM compras 
             WHERE estado = 'Recibida' AND moneda_id = $1
             AND fecha >= date_trunc('month', CURRENT_DATE)`,
            [moneda.id]
          );

      const productosStock = await query(
        `SELECT COUNT(*) as count FROM productos WHERE activo = true`
      );

      const proveedoresActivos = await query(
        `SELECT COUNT(*) as count FROM proveedores WHERE activo = true`
      );

      const ventasRecientes = tieneRango
        ? await query(
            `SELECT v.*, mo.codigo as moneda_codigo, mo.simbolo as moneda_simbolo
             FROM ventas v
             JOIN monedas mo ON v.moneda_id = mo.id
             WHERE v.moneda_id = $1 AND v.estado = 'Pagada'
             AND v.fecha::date BETWEEN $2 AND $3
             ORDER BY v.fecha DESC, v.id DESC LIMIT 5`,
            [moneda.id, fechaInicio, fechaFin]
          )
        : await query(
            `SELECT v.*, mo.codigo as moneda_codigo, mo.simbolo as moneda_simbolo
             FROM ventas v
             JOIN monedas mo ON v.moneda_id = mo.id
             WHERE v.moneda_id = $1 AND v.estado = 'Pagada'
             ORDER BY v.fecha DESC, v.id DESC LIMIT 5`,
            [moneda.id]
          );

      const alertasStock = await query(
        `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         LEFT JOIN marcas m ON p.marca_id = m.id
         WHERE p.activo = true AND p.stock <= p.stock_minimo
         ORDER BY p.stock ASC, p.id ASC LIMIT 10`
      );

      const ventasMensuales = tieneRango
        ? await query(
            `SELECT TO_CHAR(fecha, 'Mon') as mes, EXTRACT(MONTH FROM fecha) as mes_num,
                    SUM(total) as ventas
             FROM ventas
             WHERE estado = 'Pagada' AND moneda_id = $1
             AND fecha::date BETWEEN $2 AND $3
             GROUP BY TO_CHAR(fecha, 'Mon'), EXTRACT(MONTH FROM fecha)
             ORDER BY EXTRACT(MONTH FROM fecha)`,
            [moneda.id, fechaInicio, fechaFin]
          )
        : await query(
            `SELECT TO_CHAR(fecha, 'Mon') as mes, EXTRACT(MONTH FROM fecha) as mes_num,
                    SUM(total) as ventas
             FROM ventas
             WHERE estado = 'Pagada' AND moneda_id = $1
             AND fecha >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY TO_CHAR(fecha, 'Mon'), EXTRACT(MONTH FROM fecha)
             ORDER BY EXTRACT(MONTH FROM fecha)`,
            [moneda.id]
          );

      const stockPorCategoria = await query(
        `SELECT c.nombre, SUM(p.stock) as value
         FROM productos p
         JOIN categorias c ON p.categoria_id = c.id
         WHERE p.activo = true
         GROUP BY c.nombre ORDER BY value DESC`
      );

      dashboardData[moneda.codigo] = {
        moneda,
        ventasMes: {
          count: parseInt(ventasMes[0]?.count || "0"),
          total: parseFloat(ventasMes[0]?.total || "0"),
        },
        comprasMes: {
          count: parseInt(comprasMes[0]?.count || "0"),
          total: parseFloat(comprasMes[0]?.total || "0"),
        },
        productosStock: parseInt(productosStock[0]?.count || "0"),
        proveedoresActivos: parseInt(proveedoresActivos[0]?.count || "0"),
        ventasRecientes,
        alertasStock,
        ventasMensuales,
        stockPorCategoria,
      };
    }

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error("[dashboard] error:", error);
    return NextResponse.json({ error: "Error al obtener dashboard" }, { status: 500 });
  }
}
