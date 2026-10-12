export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, transaction } from "@/lib/db";
import { aBase, convertirConMetodo, redondear, tasaUsd } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;

    // Buscar crédito ya sea por su propio ID o por venta_id
    const credito = await queryOne(`
      SELECT cr.*, 
             cl.nombre as cliente_nombre, 
             cl.documento as cliente_documento, 
             cl.telefono as cliente_telefono,
             v.numero as venta_numero, 
             v.fecha as venta_fecha, 
             v.total as venta_total,
             m.codigo as moneda_codigo, 
             m.simbolo as moneda_simbolo,
             m.decimales as moneda_decimales
      FROM creditos cr
      JOIN clientes cl ON cr.cliente_id = cl.id
      LEFT JOIN ventas v ON cr.venta_id = v.id
      JOIN monedas m ON cr.moneda_id = m.id
      WHERE cr.id = $1 OR cr.venta_id = $1
      LIMIT 1
    `, [id]);

    if (!credito) {
      return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
    }

    const abonos = await query(`
      SELECT a.*, 
             m.codigo as moneda_codigo, 
             m.simbolo as moneda_simbolo,
             mp.nombre as metodo_pago_nombre, 
             ca.nombre as caja_nombre
      FROM abonos a
      LEFT JOIN monedas m ON m.id = a.moneda_id
      LEFT JOIN metodos_pago mp ON mp.id = a.metodo_pago_id
      LEFT JOIN cajas ca ON ca.id = a.caja_id
      WHERE a.credito_id = $1
      ORDER BY a.fecha DESC, a.id DESC
    `, [credito.id]);

    return NextResponse.json({ credito, abonos });
  } catch (error) {
    console.error("Error al obtener abonos de crédito:", error);
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

    // Normalizar líneas de pago (modo simple o modo mixto)
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
      itemsAbono = [{
        monto: Number(monto),
        moneda_id: moneda_id,
        metodo_pago_id: metodo_pago_id || null,
        caja_id: caja_id || null,
      }];
    }

    if (itemsAbono.length === 0) {
      return NextResponse.json({ error: "No se proporcionaron montos válidos a abonar" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      // Buscar crédito por ID o por venta_id
      const creditoRes = await client.query(
        `SELECT * FROM creditos WHERE id = $1 OR venta_id = $1 LIMIT 1`,
        [id]
      );
      if (creditoRes.rows.length === 0) {
        throw new Error("Crédito no encontrado");
      }
      const credito = creditoRes.rows[0];

      if (credito.estado === "Pagado" || parseFloat(String(credito.saldo)) <= 0.009) {
        throw new Error("El crédito ya se encuentra totalmente pagado");
      }

      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const baseMoneda = monedasCatalogo.find((m: any) => m.es_base) || {
        id: "1",
        codigo: "USD",
        simbolo: "$",
        tasa: 1,
        es_base: true,
      };

      const monedaCredito = monedasCatalogo.find(
        (m: any) => String(m.id) === String(credito.moneda_id)
      );
      if (!monedaCredito) {
        throw new Error("Moneda del crédito no encontrada");
      }

      // Reglas de conversión del motor para VENTAS (directa o triangulación)
      const cfg = await getConfiguracionGlobal(client);
      const transitoVentas = cfg.moneda_transito_ventas_id
        ? monedasCatalogo.find((m: any) => String(m.id) === String(cfg.moneda_transito_ventas_id))
        : null;

      const decCredito = Number(monedaCredito.decimales ?? 2);

      let totalAbonadoEnMonedaCredito = 0;
      let totalAbonadoEnBase = 0;

      const abonosProcesados = itemsAbono.map((item) => {
        const monedaItem = monedasCatalogo.find(
          (m: any) => String(m.id) === String(item.moneda_id)
        );
        if (!monedaItem) throw new Error(`Moneda ${item.moneda_id} no encontrada`);

        // Convertir el monto del abono a la moneda del crédito usando la regla de ventas (directa o triangular)
        const montoEnMonedaCredito =
          String(monedaItem.id) === String(monedaCredito.id)
            ? redondear(item.monto, decCredito)
            : convertirConMetodo(
                item.monto,
                monedaItem,
                monedaCredito,
                {
                  metodo: cfg.metodo_conversion_ventas,
                  monedaTransito: transitoVentas,
                  catalogo: monedasCatalogo,
                },
                decCredito
              );

        // Convertir a moneda base (USD) usando la regla de ventas
        const montoBase = convertirConMetodo(
          item.monto,
          monedaItem,
          baseMoneda,
          {
            metodo: cfg.metodo_conversion_ventas,
            monedaTransito: transitoVentas,
            catalogo: monedasCatalogo,
          },
          6
        );

        totalAbonadoEnMonedaCredito += montoEnMonedaCredito;
        totalAbonadoEnBase += montoBase;

        return {
          ...item,
          montoEnMonedaCredito,
          montoBase,
        };
      });

      const saldoActualCredito = parseFloat(String(credito.saldo));
      if (totalAbonadoEnMonedaCredito > saldoActualCredito + 0.01) {
        throw new Error(
          `El total abonado (${totalAbonadoEnMonedaCredito.toFixed(2)} ${monedaCredito.codigo}) excede el saldo pendiente (${saldoActualCredito.toFixed(2)} ${monedaCredito.codigo})`
        );
      }

      // Insertar abonos y movimientos de caja
      const insertados = [];
      for (const item of abonosProcesados) {
        const abonoRes = await client.query(
          `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            credito.id,
            credito.cliente_id,
            fechaAbono,
            item.monto,
            item.moneda_id,
            item.montoBase,
            item.metodo_pago_id || null,
            item.caja_id || null,
            observaciones || null,
          ]
        );
        insertados.push(abonoRes.rows[0]);

        // Movimiento de entrada en caja si se seleccionó caja
        if (item.caja_id && item.metodo_pago_id) {
          await client.query(
            `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
             VALUES ($1, NOW(), 'Entrada', $2, $3, $4, $5, 'abono', $6)`,
            [
              item.caja_id,
              item.monto,
              item.moneda_id,
              item.montoBase,
              `Abono a crédito ${credito.numero}`,
              credito.id,
            ]
          );

          await client.query(
            `UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`,
            [item.monto, item.caja_id]
          );
        }
      }

      // Actualizar crédito
      const nuevoSaldo = Math.max(0, saldoActualCredito - totalAbonadoEnMonedaCredito);
      const nuevoSaldoBase = Math.max(
        0,
        parseFloat(String(credito.saldo_base || 0)) - totalAbonadoEnBase
      );
      const nuevoEstado = nuevoSaldo <= 0.01 ? "Pagado" : "Parcial";

      await client.query(
        `UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`,
        [nuevoSaldo, nuevoSaldoBase, nuevoEstado, credito.id]
      );

      // Si el crédito quedó pagado y tiene venta_id, actualizar la venta a Pagada
      if (nuevoEstado === "Pagado" && credito.venta_id) {
        await client.query(
          `UPDATE ventas SET estado = 'Pagada' WHERE id = $1`,
          [credito.venta_id]
        );
      }

      return {
        abonos: insertados,
        nuevoSaldo,
        nuevoEstado,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al procesar abono";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
