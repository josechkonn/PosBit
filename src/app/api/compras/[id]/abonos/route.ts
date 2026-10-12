export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, transaction } from "@/lib/db";
import { aBase, convertirConMetodo, redondear, tasaUsdDocumento } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;

    const compra = await queryOne(`
      SELECT c.*, p.nombre as proveedor_nombre, p.rif as proveedor_rif, p.telefono as proveedor_telefono,
             m.codigo as moneda_codigo, m.simbolo as moneda_simbolo
      FROM compras c
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      LEFT JOIN monedas m ON c.moneda_id = m.id
      WHERE c.id = $1
    `, [id]);

    if (!compra) {
      return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
    }

    const abonos = await query(`
      SELECT a.*, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo,
             mp.nombre as metodo_pago_nombre, ca.nombre as caja_nombre
      FROM compra_abonos a
      LEFT JOIN monedas m ON m.id = a.moneda_id
      LEFT JOIN metodos_pago mp ON mp.id = a.metodo_pago_id
      LEFT JOIN cajas ca ON ca.id = a.caja_id
      WHERE a.compra_id = $1
      ORDER BY a.fecha DESC, a.creado_en DESC
    `, [id]);

    return NextResponse.json({ compra, abonos });
  } catch (error) {
    console.error("Error al obtener abonos:", error);
    return NextResponse.json({ error: "Error al obtener abonos" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const { fecha, monto, moneda_id, metodo_pago_id, caja_id, observaciones, lineas } = body;

    const fechaAbono = fecha || new Date().toISOString().split("T")[0];

    // Normalizar líneas de pago: si viene array de lineas (pago mixto) usarlo, de lo contrario línea única
    let itemsAbono: Array<{
      monto: number;
      moneda_id: string | number;
      metodo_pago_id?: string | number | null;
      caja_id?: string | number | null;
    }> = [];

    if (Array.isArray(lineas) && lineas.length > 0) {
      itemsAbono = lineas
        .map((l: any) => ({
          monto: Number(l.monto || 0),
          moneda_id: l.moneda_id,
          metodo_pago_id: l.metodo_pago_id || null,
          caja_id: l.caja_id || null,
        }))
        .filter((l) => l.monto > 0 && l.moneda_id);
    } else {
      if (!monto || Number(monto) <= 0) {
        return NextResponse.json({ error: "Monto requerido y mayor a 0" }, { status: 400 });
      }
      if (!moneda_id) {
        return NextResponse.json({ error: "moneda_id requerido" }, { status: 400 });
      }
      itemsAbono = [{
        monto: Number(monto),
        moneda_id,
        metodo_pago_id: metodo_pago_id || null,
        caja_id: caja_id || null,
      }];
    }

    if (itemsAbono.length === 0) {
      return NextResponse.json({ error: "No se proporcionaron montos válidos a abonar" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      // Verificar compra
      const compraRes = await client.query(`SELECT * FROM compras WHERE id = $1`, [id]);
      if (compraRes.rows.length === 0) {
        throw new Error("Compra no encontrada");
      }
      const c = compraRes.rows[0];

      if (c.estado_pago === 'pagado') {
        throw new Error("La compra ya está totalmente pagada");
      }

      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const baseMoneda = monedasCatalogo.find((m: any) => m.es_base) || {
        id: "1",
        codigo: "USD",
        simbolo: "$",
        tasa: 1,
        es_base: true,
      };
      const saldoPendiente = Number(c.saldo_pendiente || 0);

      // Reglas de conversión del motor para COMPRAS (directa o triangulación)
      const cfg = await getConfiguracionGlobal(client);
      const transitoCompras = cfg.moneda_transito_compras_id
        ? monedasCatalogo.find((m: any) => String(m.id) === String(cfg.moneda_transito_compras_id))
        : null;

      // Calcular montos base
      let totalMontoBaseAbonar = 0;
      const abonosCalculados = itemsAbono.map((item) => {
        const abonoMoneda = monedasCatalogo.find((m: any) => String(m.id) === String(item.moneda_id));
        if (!abonoMoneda) throw new Error(`Moneda ${item.moneda_id} no encontrada`);

        const montoBase = convertirConMetodo(
          item.monto,
          abonoMoneda,
          baseMoneda,
          {
            metodo: cfg.metodo_conversion_compras,
            monedaTransito: transitoCompras,
            catalogo: monedasCatalogo,
          },
          6
        );

        const tasaEfectiva = item.monto > 0 && montoBase > 0 ? redondear(item.monto / montoBase, 6) : 1;
        totalMontoBaseAbonar += montoBase;
        return {
          ...item,
          tasaAbono: tasaEfectiva,
          montoBase,
        };
      });

      if (totalMontoBaseAbonar > saldoPendiente + 0.01) {
        throw new Error(
          `El total a abonar (${totalMontoBaseAbonar.toFixed(2)} USD) excede el saldo pendiente (${saldoPendiente.toFixed(2)} USD)`
        );
      }

      const insertados = [];
      for (const item of abonosCalculados) {
        const abonoRes = await client.query(
          `INSERT INTO compra_abonos (compra_id, fecha, monto, moneda_id, tasa_cambio, monto_base, metodo_pago_id, caja_id, observaciones)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, fechaAbono, item.monto, item.moneda_id, item.tasaAbono, item.montoBase, item.metodo_pago_id || null, item.caja_id || null, observaciones || null]
        );
        insertados.push(abonoRes.rows[0]);

        // Movimiento de salida en caja si se seleccionó caja
        if (item.caja_id && item.metodo_pago_id) {
          await client.query(
            `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, tasa, descripcion, referencia_tipo, referencia_id)
             VALUES ($1, NOW(), 'Salida', $2, $3, $4, $5, $6, 'compra_abono', $7)`,
            [item.caja_id, item.monto, item.moneda_id, item.montoBase, item.tasaAbono, `Abono compra ${c.numero || id}`, id]
          );

          await client.query(
            `UPDATE cajas SET saldo_actual = saldo_actual - $1 WHERE id = $2`,
            [item.montoBase, item.caja_id]
          );
        }
      }

      // Actualizar compra
      const nuevoSaldo = Math.max(0, saldoPendiente - totalMontoBaseAbonar);
      const nuevoEstadoPago = nuevoSaldo <= 0.005 ? 'pagado' : 'parcial';
      await client.query(
        `UPDATE compras SET saldo_pendiente = $1, estado_pago = $2 WHERE id = $3`,
        [nuevoSaldo, nuevoEstadoPago, id]
      );

      return {
        abonos: insertados,
        nuevoSaldo,
        nuevoEstadoPago,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al procesar abono";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}