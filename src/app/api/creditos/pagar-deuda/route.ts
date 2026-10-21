export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { transaction } from "@/lib/db";
import { fechaLocalISO } from "@/lib/format";
import { convertirConMetodo, redondear } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";
import { triggerBackgroundSync } from "@/lib/sync-engine";

/**
 * Pago de deuda global del cliente: el operador ingresa un monto en la
 * moneda que quiera y el pago se distribuye automáticamente entre las
 * FACTURAS pendientes (créditos), desde la más antigua hasta agotar el
 * monto. Cada crédito recibe como máximo su saldo; el sobrante se devuelve
 * en la respuesta (no se fuerza).
 *
 * Usa la MISMA regla de conversión de ventas que los abonos individuales.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { cliente_id, monto, moneda_id, fecha, metodo_pago_id, caja_id, observaciones } = body;

    const montoPago = Number(monto);
    if (!cliente_id) {
      return NextResponse.json({ error: "Cliente requerido" }, { status: 400 });
    }
    if (!Number.isFinite(montoPago) || montoPago <= 0) {
      return NextResponse.json({ error: "Monto requerido y mayor a 0" }, { status: 400 });
    }
    if (!moneda_id) {
      return NextResponse.json({ error: "Moneda del pago requerida" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const clienteRes = await client.query(`SELECT id, nombre FROM clientes WHERE id = $1`, [cliente_id]);
      if (clienteRes.rows.length === 0) {
        throw new Error("Cliente no encontrado");
      }
      const cliente = clienteRes.rows[0];

      // Deudas pendientes, la más antigua primero (orden de distribución).
      const creditosRes = await client.query(
        `SELECT * FROM creditos
         WHERE cliente_id = $1 AND estado <> 'Pagado' AND saldo > 0.009
         ORDER BY fecha ASC, id DESC`,
        [cliente_id]
      );
      const creditosPendientes = creditosRes.rows;
      if (creditosPendientes.length === 0) {
        throw new Error("El cliente no tiene deudas pendientes");
      }

      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const baseMoneda = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
      if (!baseMoneda) {
        throw new Error("No hay moneda base configurada");
      }

      const monedaPago = monedasCatalogo.find((m: any) => String(m.id) === String(moneda_id));
      if (!monedaPago) {
        throw new Error("Moneda del pago no encontrada");
      }

      // Regla de conversión de VENTAS (misma cadena que los abonos).
      const cfg = await getConfiguracionGlobal(client);
      const metodoVentas: "directa" | "triangulacion" =
        cfg.metodo_conversion_ventas === "triangulacion" ? "triangulacion" : "directa";
      const transitoVentas = cfg.moneda_transito_ventas_id
        ? monedasCatalogo.find((m: any) => String(m.id) === String(cfg.moneda_transito_ventas_id))
        : null;
      const regla = {
        metodo: metodoVentas,
        monedaTransito: transitoVentas ?? null,
        catalogo: monedasCatalogo,
      };

      // Todo el pago se convierte una sola vez a USD (base) y de ahí se reparte.
      const montoBasePago = convertirConMetodo(montoPago, monedaPago, baseMoneda, regla, 6);
      if (montoBasePago <= 0.0005) {
        throw new Error("El monto equivale a menos de 0.01 en la moneda base");
      }

      let poolBase = montoBasePago;
      const aplicado: Array<{
        credito_id: string;
        numero: string;
        moneda_codigo: string;
        monto: number;
        saldo?: number;
        monto_base: number;
        estado: string;
      }> = [];

      for (const credito of creditosPendientes) {
        const saldo = parseFloat(String(credito.saldo));
        if (saldo <= 0.009) continue;

        const monedaCredito = monedasCatalogo.find(
          (m: any) => String(m.id) === String(credito.moneda_id)
        );
        if (!monedaCredito) continue;
        const dec = Number(monedaCredito.decimales ?? 2);

        let saldoBase = parseFloat(String(credito.saldo_base || 0));
        if (saldoBase <= 0.0005) {
          saldoBase = redondear(convertirConMetodo(saldo, monedaCredito, baseMoneda, regla, 6), 6);
        }

        const takeBase = redondear(Math.min(poolBase, saldoBase), 6);
        if (takeBase <= 0.0005) break; // ya no queda monto que repartir

        // Monto en la moneda del crédito
        let takeCurrency =
          saldoBase > 0 && Math.abs(takeBase - saldoBase) > 0.005
            ? redondear((saldo * takeBase) / saldoBase, dec)
            : saldo;
        takeCurrency = Math.min(takeCurrency, saldo); // nunca superar el saldo

        poolBase = redondear(Math.max(0, poolBase - takeBase), 6);

        await client.query(
          `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)`,
          [
            credito.id,
            cliente_id,
            fecha || fechaLocalISO(),
            takeCurrency,
            monedaCredito.id,
            takeBase,
            metodo_pago_id || null,
            caja_id || null,
            observaciones || null,
          ]
        );

        const diffSaldo = Math.max(0, saldo - takeCurrency);
        const diffSaldoBase = Math.max(0, saldoBase - takeBase);
        const nuevoEstado = diffSaldo <= 0.01 || diffSaldoBase <= 0.005 ? "Pagado" : "Parcial";
        const nuevoSaldo = nuevoEstado === "Pagado" ? 0 : redondear(diffSaldo, dec);
        const nuevoSaldoBase = nuevoEstado === "Pagado" ? 0 : redondear(diffSaldoBase, 6);

        await client.query(
          `UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3, actualizado_en = NOW() WHERE id = $4`,
          [nuevoSaldo, nuevoSaldoBase, nuevoEstado, credito.id]
        );

        // Si la factura quedó saldada, la venta asociada pasa a Pagada.
        if (nuevoEstado === "Pagado" && credito.venta_id) {
          await client.query(`UPDATE ventas SET estado = 'Pagada' WHERE id = $1`, [credito.venta_id]);
        }

        aplicado.push({
          credito_id: credito.id,
          numero: credito.numero,
          moneda_codigo: monedaCredito.codigo,
          monto: takeCurrency,
          saldo: nuevoSaldo,
          monto_base: takeBase,
          estado: nuevoEstado,
        });
      }

      if (aplicado.length === 0) {
        throw new Error("El monto no alcanza a aplicar sobre ninguna deuda (revisa el tipo de cambio)");
      }

      // Movimiento de caja: solo cuando se eligió método de pago (con caja).
      if (caja_id && metodo_pago_id) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
           VALUES ($1, NOW(), 'Entrada', $2, $3, $4, $5, 'pago_deuda', NULL)`,
          [
            caja_id,
            montoPago,
            monedaPago.id,
            montoBasePago,
            `Pago de deuda de ${cliente.nombre}`,
          ]
        );
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [
          montoPago,
          caja_id,
        ]);
      }

      return {
        aplicado,
        total_abonado_base: redondear(montoBasePago - poolBase, 6),
        sobrante_base: redondear(poolBase, 6),
        creditos_completados: aplicado.filter((a) => a.estado === "Pagado").length,
      };
    });

    triggerBackgroundSync();

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al aplicar el pago";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}