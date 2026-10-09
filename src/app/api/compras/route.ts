export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { aBase, convertir, tasaUsd, tasaUsdDocumento, monedaDeProducto } from "@/lib/money";

function generarNumero() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `OC-${year}-${random}`;
}

export async function GET() {
  try {
    await requireSession();
    const compras = await query(`
      SELECT 
        c.*,
        p.nombre as proveedor_nombre,
        mo.codigo as moneda_codigo,
        mo.simbolo as moneda_simbolo,
        mp.nombre as metodo_pago_nombre,
        ca.nombre as caja_nombre,
        (SELECT COUNT(*) FROM compra_items WHERE compra_id = c.id) as items_count
      FROM compras c
      JOIN proveedores p ON c.proveedor_id = p.id
      JOIN monedas mo ON c.moneda_id = mo.id
      LEFT JOIN metodos_pago mp ON c.metodo_pago_id = mp.id
      LEFT JOIN cajas ca ON c.caja_id = ca.id
      ORDER BY c.fecha DESC, c.id DESC
    `);

    const items = await query(`
      SELECT ci.*, pr.nombre as producto_nombre, pr.codigo as producto_codigo
      FROM compra_items ci
      JOIN productos pr ON ci.producto_id = pr.id
      ORDER BY ci.compra_id, ci.id
    `);

    return NextResponse.json({ compras, items });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener compras" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { proveedor_id, fecha, moneda_id, metodo_pago_id, caja_id, items, observaciones, referencia, tasa: tasaCustom } = body;

    if (!proveedor_id || !moneda_id || !items || items.length === 0) {
      return NextResponse.json({ error: "Campos requeridos: proveedor_id, moneda_id, items" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const moneda = await client.query(`SELECT * FROM monedas WHERE id = $1`, [moneda_id]);
      if (moneda.rows.length === 0) {
        throw new Error("Moneda no encontrada");
      }
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaCompra = moneda.rows[0];
      // Tasa efectiva de la compra: la personalizada si vino, si no la de la moneda
      const tasaUsdCompra = tasaUsdDocumento(monedaCompra, tasaCustom, monedasCatalogo);
      // Tasa "de cara al usuario" (unidades de la moneda por su referencia): la que se guarda
      const tasaAplicada =
        tasaCustom !== null && tasaCustom !== undefined && Number(tasaCustom) > 0
          ? Number(tasaCustom)
          : Number(monedaCompra.tasa);

      let subtotalTotal = 0;

      for (const item of items) {
        subtotalTotal += item.cantidad * item.costo_unit;
      }

      // `total_base` siempre en USD, usando la tasa efectiva del documento
      const totalBase = aBase(subtotalTotal, tasaUsdCompra);

      const compraRes = await client.query(
        `INSERT INTO compras (numero, proveedor_id, fecha, moneda_id, metodo_pago_id, caja_id, subtotal, total, total_base, tasa, estado, observaciones, referencia) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [generarNumero(), proveedor_id, fecha || new Date().toISOString().split("T")[0], moneda_id, metodo_pago_id || null, caja_id || null, subtotalTotal, subtotalTotal, totalBase, tasaAplicada, "Recibida", observaciones || null, referencia || null]
      );

      const compra = compraRes.rows[0];

      for (const item of items) {
        const costoUnitBase = aBase(item.costo_unit, tasaUsdCompra);
        const subtotalItem = item.cantidad * item.costo_unit;
        const subtotalBase = aBase(subtotalItem, tasaUsdCompra);

        await client.query(
          `INSERT INTO compra_items (compra_id, producto_id, cantidad, costo_unit, costo_unit_base, subtotal, subtotal_base) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [compra.id, item.producto_id, item.cantidad, item.costo_unit, costoUnitBase, subtotalItem, subtotalBase]
        );

        const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = productoActual.rows[0]?.stock || 0;
        const nuevoStock = stockAnterior + item.cantidad;

        await client.query(
          `UPDATE productos SET stock = $1 WHERE id = $2`,
          [nuevoStock, item.producto_id]
        );

        // El kardex guarda el costo en la moneda del producto (y su equivalente USD)
        const monedaProducto = monedaDeProducto(productoActual.rows[0], monedaCompra, monedasCatalogo);
        const costoUnitProducto = convertir(
          item.costo_unit,
          monedaCompra,
          monedaProducto,
          monedasCatalogo,
          Number(monedaProducto.decimales ?? 2)
        );
        const costoUnitUsd = aBase(costoUnitProducto, tasaUsd(monedaProducto, monedasCatalogo));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Entrada', $2, 'compra', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Compra ${compra.numero}`, compra.id, item.cantidad, costoUnitProducto, costoUnitUsd, stockAnterior, nuevoStock]
        );
      }

      if (caja_id && metodo_pago_id) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, tasa, descripcion, referencia_tipo, referencia_id) 
           VALUES ($1, NOW(), 'Salida', $2, $3, $4, $5, $6, 'compra', $7)`,
          [caja_id, subtotalTotal, moneda_id, totalBase, tasaAplicada, `Pago compra ${compra.numero}`, compra.id]
        );

        await client.query(
          `UPDATE cajas SET saldo_actual = saldo_actual - $1 WHERE id = $2`,
          [subtotalTotal, caja_id]
        );
      }

      return compra;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Error al crear compra:", error);
    return NextResponse.json({ error: "Error al crear compra" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, estado, observaciones } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE compras 
       SET estado = COALESCE($2, estado), 
           observaciones = COALESCE($3, observaciones)
       WHERE id = $1 
       RETURNING *`,
      [id, estado, observaciones]
    );

    if (!result) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar compra" }, { status: 500 });
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
      const compra = await client.query(`SELECT * FROM compras WHERE id = $1`, [id]);
      if (compra.rows.length === 0) {
        throw new Error("Compra no encontrada");
      }

      const items = await client.query(`SELECT * FROM compra_items WHERE compra_id = $1`, [id]);
      // Catálogo completo (incluso monedas inactivas): la cadena de conversiones
      // debe resolverse aunque una moneda del histórico esté desactivada
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaCompra =
        monedasCatalogo.find((m: any) => String(m.id) === String(compra.rows[0].moneda_id)) || monedasCatalogo[0];

      for (const item of items.rows) {
        const productoActual = await client.query(`SELECT * FROM productos WHERE id = $1`, [item.producto_id]);
        const stockAnterior = productoActual.rows[0]?.stock || 0;
        const nuevoStock = Math.max(0, stockAnterior - item.cantidad);

        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, item.producto_id]);

        // El costo vuelve a la moneda del producto (y su equivalente USD)
        const monedaProducto = monedaDeProducto(productoActual.rows[0], monedaCompra, monedasCatalogo);
        const costoUnitProducto = convertir(
          Number(item.costo_unit),
          monedaCompra,
          monedaProducto,
          monedasCatalogo,
          Number(monedaProducto.decimales ?? 2)
        );
        const costoUnitUsd = aBase(costoUnitProducto, tasaUsd(monedaProducto, monedasCatalogo));
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, referencia_tipo, referencia_id, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
           VALUES ($1, NOW(), 'Salida', $2, 'compra_anulada', $3, $4, $5, $6, $7, $8)`,
          [item.producto_id, `Anulación compra`, id, item.cantidad, costoUnitProducto, costoUnitUsd, stockAnterior, nuevoStock]
        );
      }

      await client.query(`DELETE FROM compra_items WHERE compra_id = $1`, [id]);
      await client.query(`DELETE FROM compras WHERE id = $1`, [id]);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar compra" }, { status: 500 });
  }
}
