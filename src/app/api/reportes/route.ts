export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne } from "@/lib/db";
import { preciosDeProducto, reglasConversion } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

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

// Costo por unidad en USD: el CPP promedio ponderado (costo_promedio_base ya
// está en la moneda base del sistema) o, solo legacy, costo_base convertido.
const COSTO_UNIT_USD_PRODUCTO = `
  COALESCE(NULLIF(p.costo_promedio_base, 0), p.costo_base / NULLIF(${TASA_USD_COSTO_PROD}, 0))
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

    // Reglas del motor: los precios por moneda de los productos del reporte se
    // derivan con el método configurado (costo=compras, precio=ventas), igual
    // que el listado de productos y las compras.
    const cfgGlobal = await getConfiguracionGlobal();

    const reportesData: any = {};

    const filtroFechaVentas = fechaInicio && fechaFin ? `AND v.fecha::date BETWEEN '${fechaInicio}' AND '${fechaFin}'` : "";
    const filtroFechaAbonos = fechaInicio && fechaFin ? `AND a.fecha::date BETWEEN '${fechaInicio}' AND '${fechaFin}'` : "";
    const filtroFechaCompras = fechaInicio && fechaFin ? `AND c.fecha::date BETWEEN '${fechaInicio}' AND '${fechaFin}'` : "";

    // Cobros físicos reales en cada moneda (ventas de contado/mixtas + abonos de créditos)
    // Esto refleja lo que REALMENTE ingresó en cada moneda y método de pago en el período.
    let cobrosGlobales: any[] = [];
    if (tipo === "ventas" || tipo === "finanzas") {
      try {
        const cobrosRaw = await query(`
          WITH cobros_v AS (
            SELECT 
              m.id as moneda_id,
              m.codigo as moneda_codigo,
              m.simbolo as moneda_simbolo,
              COALESCE(mp.id::text, 'sin-metodo') as metodo_id,
              COALESCE(mp.nombre, 'Efectivo / Sin método') as metodo_nombre,
              COALESCE(mp.tipo, 'Efectivo') as metodo_tipo,
              COUNT(*) as count_ventas,
              0::bigint as count_abonos,
              SUM(vp.monto - COALESCE(vp.vuelto, 0)) as total_ventas,
              0::numeric as total_abonos
            FROM venta_pagos vp
            JOIN ventas v ON vp.venta_id = v.id
            LEFT JOIN monedas m ON vp.moneda_id = m.id
            LEFT JOIN metodos_pago mp ON vp.metodo_pago_id = mp.id
            WHERE v.estado IN ('Pagada', 'Credito')
              ${filtroFechaVentas}
            GROUP BY m.id, m.codigo, m.simbolo, mp.id, mp.nombre, mp.tipo
          ),
          cobros_a AS (
            SELECT 
              m.id as moneda_id,
              m.codigo as moneda_codigo,
              m.simbolo as moneda_simbolo,
              COALESCE(mp.id::text, 'abono-directo') as metodo_id,
              COALESCE(mp.nombre, 'Abono de deuda') as metodo_nombre,
              COALESCE(mp.tipo, 'Efectivo') as metodo_tipo,
              0::bigint as count_ventas,
              COUNT(*) as count_abonos,
              0::numeric as total_ventas,
              SUM(a.monto) as total_abonos
            FROM abonos a
            LEFT JOIN monedas m ON a.moneda_id = m.id
            LEFT JOIN metodos_pago mp ON a.metodo_pago_id = mp.id
            WHERE 1=1
              ${filtroFechaAbonos}
            GROUP BY m.id, m.codigo, m.simbolo, mp.id, mp.nombre, mp.tipo
          ),
          unidos AS (
            SELECT * FROM cobros_v
            UNION ALL
            SELECT * FROM cobros_a
          )
          SELECT 
            moneda_id,
            moneda_codigo,
            moneda_simbolo,
            metodo_id,
            metodo_nombre,
            metodo_tipo,
            SUM(count_ventas + count_abonos)::int as count,
            SUM(count_ventas)::int as count_ventas,
            SUM(count_abonos)::int as count_abonos,
            COALESCE(SUM(total_ventas + total_abonos), 0)::numeric as total,
            COALESCE(SUM(total_ventas), 0)::numeric as total_ventas,
            COALESCE(SUM(total_abonos), 0)::numeric as total_abonos
          FROM unidos
          WHERE moneda_id IS NOT NULL
          GROUP BY moneda_id, moneda_codigo, moneda_simbolo, metodo_id, metodo_nombre, metodo_tipo
          ORDER BY moneda_codigo, total DESC
        `);

        // Agrupar por moneda
        const mapPorMoneda = new Map<string, any>();
        for (const row of cobrosRaw) {
          const mCod = row.moneda_codigo;
          if (!mapPorMoneda.has(mCod)) {
            mapPorMoneda.set(mCod, {
              moneda_id: row.moneda_id,
              moneda_codigo: row.moneda_codigo,
              moneda_simbolo: row.moneda_simbolo,
              total: 0,
              total_ventas: 0,
              total_abonos: 0,
              count_operaciones: 0,
              metodos: [],
            });
          }
          const item = mapPorMoneda.get(mCod);
          const t = parseFloat(row.total || "0");
          const tv = parseFloat(row.total_ventas || "0");
          const ta = parseFloat(row.total_abonos || "0");
          const c = parseInt(row.count || "0", 10);
          item.total += t;
          item.total_ventas += tv;
          item.total_abonos += ta;
          item.count_operaciones += c;
          item.metodos.push({
            metodo_id: row.metodo_id,
            nombre: row.metodo_nombre,
            tipo: row.metodo_tipo,
            total: t,
            total_ventas: tv,
            total_abonos: ta,
            count: c,
          });
        }
        cobrosGlobales = Array.from(mapPorMoneda.values());
        reportesData.__cobros_globales = cobrosGlobales;
      } catch (err) {
        console.error("Error al calcular cobros globales:", err);
      }
    }

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
        // Total de ventas incluyendo TANTO lo cobrado de contado como lo que quedó a crédito
        const totalVentas = await queryOne(`
          SELECT 
            COUNT(*) as count, 
            COALESCE(SUM(total), 0) as total, 
            COALESCE(SUM(subtotal), 0) as subtotal, 
            COALESCE(SUM(impuesto), 0) as impuesto,
            COALESCE(SUM(descuento), 0) as descuento,
            COUNT(CASE WHEN tipo_pago = 'Contado' THEN 1 END) as count_contado,
            COALESCE(SUM(CASE WHEN tipo_pago = 'Contado' THEN total ELSE 0 END), 0) as total_contado,
            COUNT(CASE WHEN tipo_pago = 'Credito' THEN 1 END) as count_credito,
            COALESCE(SUM(CASE WHEN tipo_pago = 'Credito' THEN total ELSE 0 END), 0) as total_credito
          FROM ventas 
          WHERE estado IN ('Pagada', 'Credito')
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        // Abonos cobrados a créditos durante el período en esta moneda
        const totalAbonos = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(monto), 0) as total
          FROM abonos
          WHERE moneda_id = '${moneda.id}'
          ${filtroFechaAbonos.replace(/a\./g, "")}
        `);

        const ventasPorMetodo = await query(`
          SELECT COALESCE(mp.nombre, 'Sin método') as nombre, COALESCE(mp.tipo, 'Efectivo') as tipo, COUNT(*) as count, SUM(v.total) as total
          FROM ventas v
          LEFT JOIN metodos_pago mp ON v.metodo_pago_id = mp.id
          WHERE v.estado IN ('Pagada', 'Credito')
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY mp.nombre, mp.tipo
          ORDER BY total DESC
        `);

        const ventasDiarias = await query(`
          SELECT 
            TO_CHAR(fecha, 'YYYY-MM-DD') as fecha,
            COUNT(*) as count,
            SUM(total) as total,
            SUM(CASE WHEN tipo_pago = 'Contado' THEN total ELSE 0 END) as total_contado,
            SUM(CASE WHEN tipo_pago = 'Credito' THEN total ELSE 0 END) as total_credito
          FROM ventas
          WHERE estado IN ('Pagada', 'Credito')
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY TO_CHAR(fecha, 'YYYY-MM-DD')
          ORDER BY fecha
        `);

        const totalV = parseFloat(totalVentas?.total || "0");
        const countV = parseInt(totalVentas?.count || "0", 10);
        const vContado = parseFloat(totalVentas?.total_contado || "0");
        const cContado = parseInt(totalVentas?.count_contado || "0", 10);
        const vCredito = parseFloat(totalVentas?.total_credito || "0");
        const cCredito = parseInt(totalVentas?.count_credito || "0", 10);
        const abonosCobrados = parseFloat(totalAbonos?.total || "0");
        const countAbonos = parseInt(totalAbonos?.count || "0", 10);
        const cobradoReal = vContado + abonosCobrados;

        const cobrosEstaMoneda = cobrosGlobales.find(
          (cg) => String(cg.moneda_id) === String(moneda.id) || cg.moneda_codigo === moneda.codigo
        );

        reportesData[moneda.codigo] = {
          moneda,
          resumen: {
            count: countV,
            total: totalV,
            subtotal: parseFloat(totalVentas?.subtotal || "0"),
            impuesto: parseFloat(totalVentas?.impuesto || "0"),
            descuento: parseFloat(totalVentas?.descuento || "0"),
            // Desglose Contado vs Deuda
            ventaContado: vContado,
            countContado: cContado,
            ventaCredito: vCredito,
            countCredito: cCredito,
            // Cobros de deudas (abonos) en el período
            abonosCobrados,
            countAbonos,
            totalCobradoReal: cobradoReal,
          },
          cobrosFisicos: cobrosEstaMoneda || {
            moneda_codigo: moneda.codigo,
            total: cobradoReal,
            total_ventas: vContado,
            total_abonos: abonosCobrados,
            metodos: [],
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
        const reglasReporte = reglasConversion(cfgGlobal, catalogoReporte);
        const productosConPrecios = (productos as any[]).map((p) => ({
          ...p,
          precios: preciosDeProducto(p, catalogoReporte, baseSistemaReporte, reglasReporte),
        }));

        // El valor del inventario suma el costo de los productos del reporte
        // CONVERTIDO a la moneda del reporte: cada producto aporta su costo en
        // su propia moneda de compra (`moneda_costo_id`, que puede diferir de la
        // de venta). Cuando no hay moneda de costo propia el factor es 1.
        const valorInventario = await queryOne(`
          SELECT COALESCE(SUM(p.stock * ${COSTO_UNIT_USD_PRODUCTO} * ${tasaUsdReporte}), 0) as valor_base
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
        // Ventas del período (Contado + Crédito)
        const ventasFin = await queryOne(`
          SELECT 
            COUNT(*) as count,
            COALESCE(SUM(total), 0) as total_ventas,
            COALESCE(SUM(subtotal), 0) as subtotal,
            COALESCE(SUM(descuento), 0) as descuento,
            COALESCE(SUM(CASE WHEN tipo_pago = 'Contado' THEN total ELSE 0 END), 0) as venta_contado,
            COALESCE(SUM(CASE WHEN tipo_pago = 'Credito' THEN total ELSE 0 END), 0) as venta_credito
          FROM ventas
          WHERE estado IN ('Pagada', 'Credito')
          AND moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        // Costo de la mercancía vendida en el período
        const costoRes = await queryOne(`
          SELECT 
            COALESCE(SUM(vi.cantidad * COALESCE(NULLIF(p.costo_promedio_base, 0), p.costo_base, 0) * (v.total / NULLIF(v.total_base, 0))), 0) as costo_total
          FROM venta_items vi
          JOIN ventas v ON vi.venta_id = v.id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado IN ('Pagada', 'Credito')
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
        `);

        // Abonos cobrados a créditos en el período
        const abonosFin = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(monto), 0) as total
          FROM abonos
          WHERE moneda_id = '${moneda.id}'
          ${filtroFechaAbonos.replace(/a\./g, "")}
        `);

        // Compras recibidas en el período en esta moneda
        const comprasFin = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
          FROM compras
          WHERE estado = 'Recibida'
          AND moneda_id = '${moneda.id}'
          ${filtroFechaCompras.replace(/c\./g, "")}
        `);

        // Cuentas por cobrar acumuladas de clientes
        const deudaClientes = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(saldo), 0) as total_deuda
          FROM creditos
          WHERE estado <> 'Pagado'
          AND moneda_id = '${moneda.id}'
        `);

        // Cuentas por pagar acumuladas a proveedores
        const deudaProveedores = await queryOne(`
          SELECT COUNT(*) as count, COALESCE(SUM(saldo_pendiente), 0) as total_por_pagar
          FROM compras
          WHERE estado = 'Recibida'
          AND saldo_pendiente > 0
          AND moneda_id = '${moneda.id}'
        `);

        const vTotal = parseFloat(ventasFin?.total_ventas || "0");
        const vContado = parseFloat(ventasFin?.venta_contado || "0");
        const vCredito = parseFloat(ventasFin?.venta_credito || "0");
        const vSubtotal = parseFloat(ventasFin?.subtotal || "0");
        const vDescuento = parseFloat(ventasFin?.descuento || "0");
        const abonosRecibidos = parseFloat(abonosFin?.total || "0");
        const ingresosReales = vContado + abonosRecibidos;
        const costoMercancia = parseFloat(costoRes?.costo_total || "0");
        const gananciaBruta = vTotal - costoMercancia;
        const margenPct = vTotal > 0 ? (gananciaBruta / vTotal) * 100 : 0;
        const totalCompras = parseFloat(comprasFin?.total || "0");
        const flujoCaja = ingresosReales - totalCompras;
        const totalCuentasPorCobrar = parseFloat(deudaClientes?.total_deuda || "0");
        const totalCuentasPorPagar = parseFloat(deudaProveedores?.total_por_pagar || "0");

        reportesData[moneda.codigo] = {
          moneda,
          resumenFinanzas: {
            ventasTotales: vTotal,
            subtotal: vSubtotal,
            descuento: vDescuento,
            ventaContado: vContado,
            ventaCredito: vCredito,
            abonosCobrados: abonosRecibidos,
            ingresosReales,
            costoMercancia,
            gananciaBruta,
            margenPct,
            comprasPeriodo: totalCompras,
            countCompras: parseInt(comprasFin?.count || "0", 10),
            flujoCajaOperativo: flujoCaja,
            cuentasPorCobrar: totalCuentasPorCobrar,
            countDeudores: parseInt(deudaClientes?.count || "0", 10),
            cuentasPorPagar: totalCuentasPorPagar,
            countProveedoresDeuda: parseInt(deudaProveedores?.count || "0", 10),
          },
          // Claves para compatibilidad con exportaciones existentes:
          rentabilidad: {
            ingresos: vTotal,
            costos: costoMercancia,
            gananciaBruta: gananciaBruta,
          },
          cuentasPorCobrar: totalCuentasPorCobrar,
          cuentasPorPagar: totalCuentasPorPagar,
        };
      } else if (tipo === "tops") {
        const topProductos = await query(`
          SELECT p.nombre, p.codigo, SUM(vi.cantidad) as cantidad_vendida, SUM(vi.subtotal - vi.descuento) as total_ingresos
          FROM venta_items vi
          JOIN ventas v ON vi.venta_id = v.id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado IN ('Pagada', 'Credito')
          AND v.moneda_id = '${moneda.id}'
          ${filtroFecha}
          GROUP BY p.id
          ORDER BY cantidad_vendida DESC
          LIMIT 10
        `);

        const topProductosRentables = await query(`
          SELECT p.nombre, 
                 SUM(vi.subtotal - vi.descuento) - SUM(vi.cantidad * ${COSTO_UNIT_USD_PRODUCTO} * (v.total / NULLIF(v.total_base, 0))) as ganancia
          FROM venta_items vi
          JOIN ventas v ON vi.venta_id = v.id
          JOIN productos p ON vi.producto_id = p.id
          WHERE v.estado IN ('Pagada', 'Credito')
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
          WHERE v.estado IN ('Pagada', 'Credito')
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
