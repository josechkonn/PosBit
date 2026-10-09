export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, transaction } from "@/lib/db";
import { aBase, desdeBase, tasaUsd, tasaUsdDocumento, monedaDeProducto, monedaCostoDeProducto } from "@/lib/money";

function generarNumero(tipo: string) {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return tipo === "Proveedor" ? `DEV-${year}-${random}` : `RET-${year}-${random}`;
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo");

    let where = "";
    const params: any[] = [];
    if (tipo && tipo !== "Todos") {
      params.push(tipo);
      where = `WHERE rt.tipo = $${params.length}`;
    }

    // El monto del retorno se calcula en la moneda del documento de referencia
    // (venta o compra) para que coincida con el monto registrado originalmente.
    const retornos = await query(
      `SELECT rt.*,
        cl.nombre as cliente_nombre,
        pv.nombre as proveedor_nombre,
        v.numero as venta_numero,
        v.fecha as venta_fecha,
        c.numero as compra_numero,
        c.fecha as compra_fecha,
        COALESCE(mv.codigo, mc.codigo, mb.codigo) as moneda_codigo,
        COALESCE(mv.simbolo, mc.simbolo, mb.simbolo) as moneda_simbolo,
        COALESCE(mv.es_base, mc.es_base, mb.es_base, true) as moneda_es_base,
        (SELECT COUNT(*) FROM retorno_items ri WHERE ri.retorno_id = rt.id) as items_count,
        COALESCE((SELECT SUM(ri.subtotal_base) FROM retorno_items ri WHERE ri.retorno_id = rt.id), 0) as total_base,
        COALESCE((
          SELECT SUM(
            ri.cantidad * CASE
              WHEN rt.venta_id IS NOT NULL THEN COALESCE(
                (SELECT vi.precio_unit FROM venta_items vi
                 WHERE vi.venta_id = rt.venta_id AND vi.producto_id = ri.producto_id
                 ORDER BY vi.id LIMIT 1),
                -- Fallback: precio_unit_base está en USD → moneda del documento
                -- (tasa directa a USD si está activa; si no, tasa × su referencia)
                ri.precio_unit_base * CASE
                  WHEN mv.usa_tasa_usd_directa AND mv.tasa_usd_directa > 0 THEN mv.tasa_usd_directa
                  ELSE COALESCE(mv.tasa, 1)
                    * COALESCE((SELECT mr.tasa FROM monedas mr WHERE mr.id = mv.tasa_ref_moneda_id), 1)
                END
              )
              WHEN rt.compra_id IS NOT NULL THEN COALESCE(
                (SELECT ci.costo_unit FROM compra_items ci
                 WHERE ci.compra_id = rt.compra_id AND ci.producto_id = ri.producto_id
                 ORDER BY ci.id LIMIT 1),
                ri.precio_unit_base * CASE
                  WHEN mc.usa_tasa_usd_directa AND mc.tasa_usd_directa > 0 THEN mc.tasa_usd_directa
                  ELSE COALESCE(mc.tasa, 1)
                    * COALESCE((SELECT mr.tasa FROM monedas mr WHERE mr.id = mc.tasa_ref_moneda_id), 1)
                END
              )
              ELSE ri.precio_unit_base
            END
          )
          FROM retorno_items ri WHERE ri.retorno_id = rt.id
        ), 0) as total_moneda
      FROM retornos rt
      LEFT JOIN clientes cl ON rt.cliente_id = cl.id
      LEFT JOIN proveedores pv ON rt.proveedor_id = pv.id
      LEFT JOIN ventas v ON rt.venta_id = v.id
      LEFT JOIN monedas mv ON v.moneda_id = mv.id
      LEFT JOIN compras c ON rt.compra_id = c.id
      LEFT JOIN monedas mc ON c.moneda_id = mc.id
      LEFT JOIN monedas mb ON mb.es_base = true
      ${where}
      ORDER BY rt.fecha DESC, rt.id DESC`,
      params
    );

    const items = await query(`
      SELECT ri.*, pr.nombre as producto_nombre, pr.codigo as producto_codigo,
        ri.cantidad * CASE
          WHEN rt.venta_id IS NOT NULL THEN COALESCE(
            (SELECT vi.precio_unit FROM venta_items vi
             WHERE vi.venta_id = rt.venta_id AND vi.producto_id = ri.producto_id
             ORDER BY vi.id LIMIT 1),
            -- Fallback: precio_unit_base en USD → moneda del documento (cadena de tasas)
            ri.precio_unit_base * CASE
              WHEN mv.usa_tasa_usd_directa AND mv.tasa_usd_directa > 0 THEN mv.tasa_usd_directa
              ELSE COALESCE(mv.tasa, 1)
                * COALESCE((SELECT mr.tasa FROM monedas mr WHERE mr.id = mv.tasa_ref_moneda_id), 1)
            END
          )
          WHEN rt.compra_id IS NOT NULL THEN COALESCE(
            (SELECT ci.costo_unit FROM compra_items ci
             WHERE ci.compra_id = rt.compra_id AND ci.producto_id = ri.producto_id
             ORDER BY ci.id LIMIT 1),
            ri.precio_unit_base * CASE
              WHEN mc.usa_tasa_usd_directa AND mc.tasa_usd_directa > 0 THEN mc.tasa_usd_directa
              ELSE COALESCE(mc.tasa, 1)
                * COALESCE((SELECT mr.tasa FROM monedas mr WHERE mr.id = mc.tasa_ref_moneda_id), 1)
            END
          )
          ELSE ri.precio_unit_base
        END as subtotal_moneda
      FROM retorno_items ri
      JOIN productos pr ON ri.producto_id = pr.id
      JOIN retornos rt ON ri.retorno_id = rt.id
      LEFT JOIN ventas v ON rt.venta_id = v.id
      LEFT JOIN monedas mv ON v.moneda_id = mv.id
      LEFT JOIN compras c ON rt.compra_id = c.id
      LEFT JOIN monedas mc ON c.moneda_id = mc.id
      ORDER BY ri.retorno_id, ri.id
    `);

    const summaryRow = await queryOne<{ clientes: string; proveedores: string; total_items: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE tipo = 'Cliente') as clientes,
        COUNT(*) FILTER (WHERE tipo = 'Proveedor') as proveedores,
        COALESCE((SELECT SUM(cantidad) FROM retorno_items), 0) as total_items
      FROM retornos
    `);

    return NextResponse.json({
      retornos,
      items,
      summary: {
        clientes: summaryRow?.clientes ?? "0",
        proveedores: summaryRow?.proveedores ?? "0",
        total_items: summaryRow?.total_items ?? "0",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener retornos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { tipo, venta_id, compra_id, cliente_id, proveedor_id, fecha, motivo, abonar_credito, items } = body;

    if (!tipo || !items || items.length === 0) {
      return NextResponse.json({ error: "Campos requeridos: tipo, items" }, { status: 400 });
    }
    if (tipo !== "Cliente" && tipo !== "Proveedor") {
      return NextResponse.json({ error: "Tipo debe ser Cliente o Proveedor" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      let clienteId = cliente_id || null;
      let proveedorId = proveedor_id || null;
      let docMonedaId: number | null = null;

      if (tipo === "Cliente" && venta_id) {
        const venta = await client.query(`SELECT cliente_id, moneda_id FROM ventas WHERE id = $1`, [venta_id]);
        if (venta.rows.length === 0) {
          throw new Error("Venta no encontrada");
        }
        clienteId = venta.rows[0].cliente_id || clienteId;
        docMonedaId = venta.rows[0].moneda_id || null;
      }
      if (tipo === "Proveedor" && compra_id) {
        const compra = await client.query(`SELECT proveedor_id, moneda_id FROM compras WHERE id = $1`, [compra_id]);
        if (compra.rows.length === 0) {
          throw new Error("Compra no encontrada");
        }
        proveedorId = compra.rows[0].proveedor_id || proveedorId;
        docMonedaId = compra.rows[0].moneda_id || null;
      }

      // Moneda del documento de referencia (venta/compra) para registrar los montos
      // del retorno en la misma moneda en la que se realizó la operación.
      // Catálogo completo (incluso monedas inactivas) para resolver la cadena
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaBase = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
      let docMoneda: any = monedaBase;
      let docTasa: number | null = null;
      if (docMonedaId) {
        const monedaRes = await client.query(`SELECT * FROM monedas WHERE id = $1`, [docMonedaId]);
        docMoneda = monedaRes.rows[0] || monedaBase;
      }
      // Si la venta/compra tiene tasa personalizada, el retorno la respeta
      if (venta_id) {
        const v = await client.query(`SELECT tasa FROM ventas WHERE id = $1`, [venta_id]);
        docTasa = v.rows[0]?.tasa ?? null;
      } else if (compra_id) {
        const c = await client.query(`SELECT tasa FROM compras WHERE id = $1`, [compra_id]);
        docTasa = c.rows[0]?.tasa ?? null;
      }
      // Unidades de la moneda del documento por 1 USD (con la tasa efectiva)
      const tasaUsdDoc = tasaUsdDocumento(docMoneda, docTasa, monedasCatalogo);

      const numero = generarNumero(tipo);
      const retornoRes = await client.query(
        `INSERT INTO retornos (numero, tipo, venta_id, compra_id, cliente_id, proveedor_id, fecha, motivo, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Procesado')
         RETURNING *`,
        [numero, tipo, venta_id || null, compra_id || null, clienteId, proveedorId, fecha || new Date().toISOString().split("T")[0], motivo || null]
      );
      const retorno = retornoRes.rows[0];

      let totalRetorno = 0; // total en moneda base
      let totalRetornoMoneda = 0; // total en la moneda de la venta/compra

      for (const item of items) {
        const cantidad = parseInt(item.cantidad, 10);
        if (!item.producto_id || !cantidad || cantidad <= 0) {
          throw new Error("Cada ítem requiere producto y cantidad válida");
        }

        const productoRes = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        if (productoRes.rows.length === 0) {
          throw new Error(`Producto ${item.producto_id} no encontrado`);
        }
        const producto = productoRes.rows[0];
        const stockAnterior = parseInt(producto.stock, 10);

        // `precioUnitBase` guarda el equivalente USD del precio. En retornos de
        // Cliente se usa la moneda de VENTA del producto; en retornos a
        // Proveedor, la moneda de COMPRA (costo), que puede ser distinta.
        const monedaProducto =
          tipo === "Cliente"
            ? monedaDeProducto(producto, monedaBase, monedasCatalogo)
            : monedaCostoDeProducto(producto, monedaBase, monedasCatalogo);
        const precioProductoEnMonedaProducto = Number(
          tipo === "Cliente" ? producto.precio_base : producto.costo_base
        ) || 0;
        let precioUnitBase = aBase(precioProductoEnMonedaProducto, tasaUsd(monedaProducto, monedasCatalogo));
        let precioUnitDoc: number | null = null;

        if (tipo === "Cliente" && venta_id) {
          const vi = await client.query(
            `SELECT precio_unit, precio_unit_base FROM venta_items WHERE venta_id = $1 AND producto_id = $2 ORDER BY id LIMIT 1`,
            [venta_id, item.producto_id]
          );
          if (vi.rows.length > 0) {
            precioUnitBase = parseFloat(vi.rows[0].precio_unit_base) || precioUnitBase;
            precioUnitDoc = parseFloat(vi.rows[0].precio_unit) || null;
          }
        } else if (tipo === "Proveedor" && compra_id) {
          const ci = await client.query(
            `SELECT costo_unit, costo_unit_base FROM compra_items WHERE compra_id = $1 AND producto_id = $2 ORDER BY id LIMIT 1`,
            [compra_id, item.producto_id]
          );
          if (ci.rows.length > 0) {
            precioUnitBase = parseFloat(ci.rows[0].costo_unit_base) || precioUnitBase;
            precioUnitDoc = parseFloat(ci.rows[0].costo_unit) || null;
          }
        }

        // Precio en la moneda de la venta/compra (si no está en el documento,
        // se convierte del equivalente USD con la tasa efectiva del documento)
        const precioUnit =
          precioUnitDoc !== null
            ? precioUnitDoc
            : desdeBase(precioUnitBase, tasaUsdDoc, Number(docMoneda.decimales ?? 2));

        let nuevoStock: number;
        if (tipo === "Cliente") {
          nuevoStock = stockAnterior + cantidad;
        } else {
          nuevoStock = stockAnterior - cantidad;
          if (nuevoStock < 0) {
            throw new Error(`Existencias insuficientes para ${producto.nombre}`);
          }
        }

        const subtotalBase = Math.round(precioUnitBase * cantidad * 100) / 100;
        const subtotal = Math.round(precioUnit * cantidad * 100) / 100;

        await client.query(
          `INSERT INTO retorno_items (retorno_id, producto_id, cantidad, precio_unit, precio_unit_base, subtotal, subtotal_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [retorno.id, item.producto_id, cantidad, precioUnit, precioUnitBase, subtotal, subtotalBase]
        );

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // El kardex guarda el costo en la moneda del producto (y su equivalente USD)
        const costoUnitProducto = desdeBase(precioUnitBase, tasaUsd(monedaProducto, monedasCatalogo), Number(monedaProducto.decimales ?? 2));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
           VALUES ($1, NOW(), $2, $3, 'retorno', $4, $5, $6, $7, $8, $9)`,
          [item.producto_id, tipo === "Cliente" ? "Entrada" : "Salida", `Retorno ${numero}`, retorno.id, cantidad, costoUnitProducto, precioUnitBase, stockAnterior, nuevoStock]
        );

        totalRetorno += subtotalBase;
        totalRetornoMoneda += subtotal;
      }

      totalRetorno = Math.round(totalRetorno * 100) / 100;
      totalRetornoMoneda = Math.round(totalRetornoMoneda * 100) / 100;

      if (tipo === "Cliente" && venta_id && abonar_credito === true && totalRetorno > 0) {
        const creditoRes = await client.query(
          `SELECT * FROM creditos WHERE venta_id = $1 AND estado <> 'Pagado' ORDER BY id LIMIT 1`,
          [venta_id]
        );
        if (creditoRes.rows.length > 0) {
          const credito = creditoRes.rows[0];
          const monedaRes = await client.query(`SELECT * FROM monedas WHERE id = $1`, [credito.moneda_id]);
          const moneda = monedaRes.rows[0];

          // Si el crédito está en la misma moneda que la venta/compra de referencia
          // se usa el monto exacto del retorno (evita diferencias por conversión);
          // si no, se convierte del USD con la cadena de monedas.
          const monto =
            docMoneda && String(docMoneda.id) === String(credito.moneda_id)
              ? totalRetornoMoneda
              : desdeBase(totalRetorno, tasaUsd(moneda, monedasCatalogo), Number(moneda.decimales ?? 2));
          const nuevoSaldo = Math.max(0, parseFloat(credito.saldo) - monto);
          const nuevoSaldoBase = Math.max(0, parseFloat(credito.saldo_base) - totalRetorno);
          const nuevoEstado = nuevoSaldo <= 0 ? "Pagado" : "Parcial";

          await client.query(
            `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, observaciones)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [credito.id, credito.cliente_id, retorno.id, fecha || retorno.fecha, monto, moneda.id, totalRetorno, `Retorno ${numero}`]
          );

          await client.query(
            `UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`,
            [nuevoSaldo, nuevoSaldoBase, nuevoEstado, credito.id]
          );
        }
      }

      return {
        ...retorno,
        total_moneda: totalRetornoMoneda,
        total_base: totalRetorno,
        moneda_codigo: docMoneda?.codigo || null,
        moneda_simbolo: docMoneda?.simbolo || null,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al crear retorno" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    await transaction(async (client) => {
      const retornoRes = await client.query(`SELECT * FROM retornos WHERE id = $1`, [id]);
      if (retornoRes.rows.length === 0) {
        throw new Error("Retorno no encontrado");
      }
      const retorno = retornoRes.rows[0];

      const itemsRes = await client.query(`SELECT * FROM retorno_items WHERE retorno_id = $1`, [id]);

      for (const item of itemsRes.rows) {
        const productoRes = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = parseInt(productoRes.rows[0]?.stock, 10) || 0;

        let nuevoStock: number;
        if (retorno.tipo === "Cliente") {
          nuevoStock = Math.max(0, stockAnterior - item.cantidad);
        } else {
          nuevoStock = stockAnterior + item.cantidad;
        }

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // `precio_unit_base` está en USD; el kardex guarda además el costo
        // convertido a la moneda del producto
        // Catálogo completo (incluso monedas inactivas) para resolver la cadena
        const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
        const monedaBase = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
        const monedaProducto =
          retorno.tipo === "Cliente"
            ? monedaDeProducto(productoRes.rows[0], monedaBase, monedasCatalogo)
            : monedaCostoDeProducto(productoRes.rows[0], monedaBase, monedasCatalogo);
        const costoUnitProducto = desdeBase(
          Number(item.precio_unit_base) || 0,
          tasaUsd(monedaProducto, monedasCatalogo),
          Number(monedaProducto.decimales ?? 2)
        );

        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual)
           VALUES ($1, NOW(), $2, $3, 'retorno_anulado', $4, $5, $6, $7, $8, $9)`,
          [item.producto_id, retorno.tipo === "Cliente" ? "Salida" : "Entrada", `Anulación retorno`, id, item.cantidad, costoUnitProducto, item.precio_unit_base, stockAnterior, nuevoStock]
        );
      }

      const abonoRes = await client.query(`SELECT * FROM abonos WHERE retorno_id = $1`, [id]);
      for (const abono of abonoRes.rows) {
        const creditoRes = await client.query(`SELECT * FROM creditos WHERE id = $1`, [abono.credito_id]);
        if (creditoRes.rows.length > 0) {
          const credito = creditoRes.rows[0];
          const saldo = Math.round((parseFloat(credito.saldo) + parseFloat(abono.monto)) * 100) / 100;
          const saldoBase = Math.round((parseFloat(credito.saldo_base) + parseFloat(abono.monto_base)) * 100) / 100;
          const estado = saldo >= parseFloat(credito.monto_total) ? "Pendiente" : "Parcial";
          await client.query(
            `UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`,
            [saldo, saldoBase, estado, credito.id]
          );
        }
        await client.query(`DELETE FROM abonos WHERE id = $1`, [abono.id]);
      }

      await client.query(`DELETE FROM retorno_items WHERE retorno_id = $1`, [id]);
      await client.query(`DELETE FROM retornos WHERE id = $1`, [id]);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar retorno" }, { status: 500 });
  }
}
