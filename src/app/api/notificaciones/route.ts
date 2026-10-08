import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();

    const [stockBajo, ventasRecientes, comprasPendientes] = await Promise.all([
      query(`
        SELECT p.id, p.nombre, p.codigo, p.stock, p.stock_minimo,
          CASE WHEN p.stock = 0 THEN 'sin_stock' ELSE 'bajo_stock' END as severidad
        FROM productos p
        WHERE p.activo = true AND p.stock <= p.stock_minimo
        ORDER BY p.stock ASC, p.id ASC
        LIMIT 10
      `),
      query(`
        SELECT v.id, v.numero, v.cliente, v.total, v.fecha,
          mo.codigo as moneda_codigo, mo.simbolo
        FROM ventas v
        JOIN monedas mo ON v.moneda_id = mo.id
        WHERE v.estado = 'Pagada'
        ORDER BY v.fecha DESC, v.id DESC
        LIMIT 5
      `),
      query(`
        SELECT c.id, c.numero, c.proveedor_id, p.nombre as proveedor_nombre,
          c.total, c.fecha, c.estado
        FROM compras c
        JOIN proveedores p ON c.proveedor_id = p.id
        WHERE c.estado IN ('Pendiente', 'En Camino')
        ORDER BY c.fecha ASC, c.id ASC
        LIMIT 5
      `),
    ]);

    const notifications = [
      ...stockBajo.map((p: any) => ({
        id: `stock-${p.id}`,
        tipo: "stock" as const,
        titulo: p.severidad === "sin_stock" ? "Sin Existencias" : "Existencias Bajas",
        mensaje: `${p.nombre} (${p.codigo}) — ${p.stock} uds. (mín: ${p.stock_minimo})`,
        severidad: p.severidad === "sin_stock" ? "danger" as const : "warning" as const,
        href: `/productos`,
        fecha: new Date().toISOString(),
        leido: false,
      })),
      ...ventasRecientes.map((v: any) => ({
        id: `venta-${v.id}`,
        tipo: "venta" as const,
        titulo: "Nueva Venta",
        mensaje: `${v.cliente || "Consumidor Final"} — ${v.simbolo}${parseFloat(v.total).toFixed(2)}`,
        severidad: "info" as const,
        href: `/ventas`,
        fecha: v.fecha,
        leido: true,
      })),
      ...comprasPendientes.map((c: any) => ({
        id: `compra-${c.id}`,
        tipo: "compra" as const,
        titulo: c.estado === "Pendiente" ? "Compra Pendiente" : "Compra en Camino",
        mensaje: `${c.proveedor_nombre} — ${c.numero}`,
        severidad: "warning" as const,
        href: `/compras`,
        fecha: c.fecha,
        leido: false,
      })),
    ];

    const unreadCount = notifications.filter((n) => !n.leido).length;

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener notificaciones" }, { status: 500 });
  }
}
