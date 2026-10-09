export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne } from "@/lib/db";
import { preciosDeProducto } from "@/lib/money";

// Expresión SQL: unidades de la moneda de COMPRA del producto (alias `p`) por 1
// USD. `costo_base` está en `moneda_costo_id` (NULL = `moneda_base_id`), así que
// para convertirlo a otra moneda se divide por esto y se multiplica por la tasa
// USD de la moneda destino. Sin moneda propia = USD (tasa 1).
const TASA_USD_COSTO_PROD = `
  COALESCE((
    SELECT CASE
      WHEN m1.usa_tasa_usd_directa AND m1.tasa_usd_directa > 0 THEN m1.tasa_usd_directa
      ELSE m1.tasa * COALESCE((
        SELECT m2.tasa FROM monedas m2 WHERE m2.id = m1.tasa_ref_moneda_id
      ), 1)
    END
    FROM monedas m1 WHERE m1.id = COALESCE(p.moneda_costo_id, p.moneda_base_id)
  ), 1)
`;

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo") || "ventas";
    const monedaId = searchParams.get("moneda_id");
    const fechaInicio = searchParams.get("fecha_inicio");
    const fechaFin = searchParams.get("fecha_fin");

    const monedas = await query(`SELECT * FROM monedas WHERE activo = true ORDER BY es_base DESC, codigo ASC, id ASC`);

    const reportesData: any = {};

    for (const moneda of monedas) {
      if (monedaId && String(moneda.id) !== String(monedaId)) continue;

      const filtroFecha = fechaInicio && fechaFin ? `AND fecha::date BETWEEN '${fechaInicio}' AND '${fechaFin}'` : "";
      const tasaUsdReporte = `
        COALESCE((
          SELECT CASE
            WHEN m1.usa_tasa_usd_directa AND m1.tasa_usd_directa > 0 THEN m1.tasa_usd_directa
            ELSE m1.tasa * COALESCE((
              SELECT m2.tasa FROM monedas m2 WHERE m2.id = m1.tasa_ref_moneda_id
            ), 1)
          END
          FROM monedas m1 WHERE m1.id = '${moneda.id}'
        ), 1)
      `;

      if (tipo === "ventas") {
        const totalVentas = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total, COALESCE(SUM(subtotal), 0) as subtotal, COALESCE(SUM(impuesto), 0) as impuesto
          FROM ventas 
          WHERE estado = 'Pagada'
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        const ventasPorMetodo = await query(`
          SELECT mp.nombre, COUNT(*) as count, SUM(v.total) as total
          FROM ventas v
          LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
          WHERE v.estado = 'Pagada'
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY mp.nombre
          ORDER BY total DESC
        `);

        const ventasDiarias = await query(`
          SELECT 
            TO_CHAR(fecha, 'YYYY-MM-DD') as fecha,
            COUNT(*) as count,
            SUM(total) as total
          FROM ventas
          WHERE estado = 'Pagada'
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY TO_CHAR(fecha, 'YYYY-MM-DD')
          ORDER BY fecha
        `);

        reportesData[moneda.codigo] = {
          moneda,
          resumen: {
            count: parseInt(totalVentas?.count || "0"),
            total: parseFloat(totalVentas?.total || "0"),
            subtotal: parseFloat(totalVentas?.subtotal || "0"),
            impuesto: parseFloat(totalVentas?.impuesto || "0"),
          },
          ventasPorMetodo,
          ventasDiarias,
        };
      } else if (tipo === "compras") {
        const totalCompras = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total, COALESCE(SUM(subtotal), 0) as subtotal
          FROM compras 
          WHERE estado = 'Recibida'
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        const comprasPorProveedor = await query(`
          SELECT p.nombre, COUNT(*) as count, SUM(c.total) as total
          FROM compras c
          JOIN proveedores p ON c.proveedor_id = p.id
          WHERE c.estado = 'Recibida'
          AND c.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY p.nombre
          ORDER BY total DESC
        `);

        const comprasMensuales = await query(`
          SELECT 
            TO_CHAR(fecha, 'YYYY-MM') as mes,
            COUNT(*) as count,
            SUM(total) as total
          FROM compras
          WHERE estado = 'Recibida'
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY TO_CHAR(fecha, 'YYYY-MM')
          ORDER BY mes
        `);

        reportesData[moneda.codigo] = {
          moneda,
          resumen: {
            count: parseInt(totalCompras?.count || "0"),
            total: parseFloat(totalCompras?.total || "0"),
            subtotal: parseFloat(totalCompras?.subtotal || "0"),
          },
          comprasPorProveedor,
          comprasMensuales,
        };
      } else if (tipo === "inventario") {
        // Productos de ESTA moneda (cada producto cuenta en su propia moneda)
        const productos = await query(`
          SELECT 
            p.*,
            c.nombre as categoria_nombre,
            m.nombre as marca_nombre,
            pm.codigo as moneda_codigo,
            pm.simbolo as moneda_simbolo,
            pmc.codigo as moneda_costo_codigo,
            pmc.simbolo as moneda_costo_simbolo
          FROM productos p
          LEFT JOIN categorias c ON p.categoria_id = c.id
          LEFT JOIN marcas m ON p.marca_id = m.id
          LEFT JOIN monedas pm ON p.moneda_base_id = pm.id
          LEFT JOIN monedas pmc ON COALESCE(p.moneda_costo_id, p.moneda_base_id) = pmc.id
          WHERE p.activo = true
            AND COALESCE(p.moneda_base_id, (SELECT id FROM monedas WHERE es_base = true LIMIT 1)) = '${moneda.id}'
          ORDER BY p.nombre, p.id ASC
        `);

        // Los precios por moneda se derivan de `precio_base`/`costo_base`
        // (moneda base del producto) con las tasas actuales; nunca se reescriben.
        const catalogoReporte = await query(
          `SELECT id, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo, usa_tasa_usd_directa, tasa_usd_directa FROM monedas ORDER BY es_base DESC, codigo ASC, id ASC`
        );
        const baseSistemaReporte = catalogoReporte.find((m: any) => m.es_base) || catalogoReporte[0];
        const productosConPrecios = (productos as any[]).map((p) => ({
          ...p,
          precios: preciosDeProducto(p, catalogoReporte, baseSistemaReporte),
        }));

        // El valor del inventario suma el costo de los productos del reporte
        // CONVERTIDO a la moneda del reporte: cada producto aporta su costo en
        // su propia moneda de compra (`moneda_costo_id`, que puede diferir de la
        // de venta). Cuando no hay moneda de costo propia el factor es 1.
        const valorInventario = await queryOne(`
          SELECT COALESCE(SUM(p.stock * p.costo_base / NULLIF(${TASA_USD_COSTO_PROD}, 0) * ${tasaUsdReporte}), 0) as valor_base
          FROM productos p
          WHERE p.activo = true
            AND COALESCE(p.moneda_base_id, (SELECT id FROM monedas WHERE es_base = true LIMIT 1)) = '${moneda.id}'
        `);

        const stockBajo = await query(`
          SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre
          FROM productos p
          LEFT JOIN categorias c ON p.categoria_id = c.id
          LEFT JOIN marcas m ON p.marca_id = m.id
          WHERE p.activo = true AND p.stock <= p.stock_minimo
          ORDER BY p.stock ASC, p.id ASC
        `);

        const movimientosKardex = fechaInicio && fechaFin
          ? await query(`
            SELECT k.*, p.nombre as producto_nombre, p.codigo as producto_codigo
            FROM kardex k
            JOIN productos p ON k.producto_id = p.id
            WHERE k.fecha::date BETWEEN '${fechaInicio}' AND '${fechaFin}'
            ORDER BY k.fecha DESC, k.id DESC
            LIMIT 50
          `)
          : await query(`
            SELECT k.*, p.nombre as producto_nombre, p.codigo as producto_codigo
            FROM kardex k
            JOIN productos p ON k.producto_id = p.id
            WHERE k.fecha >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY k.fecha DESC, k.id DESC
            LIMIT 50
          `);

        reportesData[moneda.codigo] = {
          moneda,
          productos: productosConPrecios,
          valorInventario: {
            base: parseFloat(valorInventario?.valor_base || "0"),
          },
          stockBajo,
          movimientosKardex,
        };
      } else if (tipo === "finanzas") {
        // Costo de lo vendido: convertir costo_base de la moneda de compra del
        // producto a la moneda de la venta, para obtener el costo en la moneda
        // en la que se registró la venta.
        const ganancia = await queryOne(`
          SELECT 
            COALESCE(SUM(v.subtotal), 0) as total_ingresos,
            COALESCE(SUM(vi.cantidad * p.costo_base / NULLIF(${TASA_USD_COSTO_PROD}, 0) * (v.total / NULLIF(v.total_base, 0))), SUM(v.subtotal) * 0.7) as total_costos
          FROM ventas v
          JOIN venta_items vi ON v.id = vi.venta_id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado = 'Pagada'
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        const deudaClientes = await queryOne(`
          SELECT COALESCE(SUM(saldo), 0) as total_deuda
          FROM creditos
          WHERE estado <> 'Pagado'
          AND moneda_id = '${moneda.id}'
          -- no aplicamos filtroFecha a deudas totales, o sí? normalmente es el estado actual
        `);

        reportesData[moneda.codigo] = {
          moneda,
          rentabilidad: {
            ingresos: parseFloat(ganancia?.total_ingresos || "0"),
            costos: parseFloat(ganancia?.total_costos || "0"),
            gananciaBruta: parseFloat(ganancia?.total_ingresos || "0") - parseFloat(ganancia?.total_costos || "0"),
          },
          cuentasPorCobrar: parseFloat(deudaClientes?.total_deuda || "0"),
        };
      } else if (tipo === "tops") {
        const topProductos = await query(`
          SELECT p.nombre, p.codigo, SUM(vi.cantidad) as cantidad_vendida, SUM(vi.subtotal) as total_ingresos
          FROM venta_items vi
          JOIN ventas v ON vi.venta_id = v.id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado = 'Pagada'
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY p.id
          ORDER BY cantidad_vendida DESC
          LIMIT 10
        `);

        const topProductosRentables = await query(`
          SELECT p.nombre, 
                 SUM(vi.subtotal) - SUM(vi.cantidad * p.costo_base / NULLIF(${TASA_USD_COSTO_PROD}, 0) * (v.total / NULLIF(v.total_base, 0))) as ganancia
          FROM venta_items vi
          JOIN ventas v ON vi.venta_id = v.id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado = 'Pagada'
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY p.id
          ORDER BY ganancia DESC
          LIMIT 10
        `);

        const mejoresClientes = await query(`
          SELECT COALESCE(c.nombre, v.cliente, 'Consumidor Final') as cliente_nombre, 
                 COUNT(DISTINCT v.id) as transacciones,
                 SUM(v.total) as total_comprado
          FROM ventas v
          LEFT JOIN clientes c ON v.cliente_id = c.id
          WHERE v.estado = 'Pagada'
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY c.nombre, v.cliente
          ORDER BY total_comprado DESC
          LIMIT 10
        `);

        reportesData[moneda.codigo] = {
          moneda,
          topProductos,
          topProductosRentables,
          mejoresClientes,
        };
      }
    }

    return NextResponse.json(reportesData);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener reportes" }, { status: 500 });
  }
}
