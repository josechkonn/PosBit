export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { aBase, tasaUsdDocumento } from "@/lib/money";

export async function GET() {
  try {
    await requireSession();
    const transacciones = await query(`
      SELECT 
        t.*,
        c.nombre as caja_nombre,
        m.codigo as moneda_codigo,
        m.simbolo as moneda_simbolo
      FROM transacciones t
      JOIN cajas c ON t.caja_id = c.id
      JOIN monedas m ON t.moneda_id = m.id
      ORDER BY t.fecha DESC, t.id DESC
    `);
    return NextResponse.json(transacciones);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener transacciones" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { caja_id, tipo, monto, descripcion, referencia_tipo, referencia_id, tasa: tasaCustom } = body;

    if (!caja_id || !tipo || !monto) {
      return NextResponse.json({ error: "Campos requeridos: caja_id, tipo, monto" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const caja = await client.query(`SELECT * FROM cajas WHERE id = $1`, [caja_id]);
      if (caja.rows.length === 0) {
        throw new Error("Caja no encontrada");
      }

      const monedaId = caja.rows[0].moneda_id;
      const moneda = await client.query(`SELECT * FROM monedas WHERE id = $1`, [monedaId]);
      // Catálogo completo (incluso monedas inactivas) para resolver la cadena
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      // Tasa efectiva: la personalizada si vino, si no la de la moneda de la caja
      const tasaAplicada =
        tasaCustom !== null && tasaCustom !== undefined && Number(tasaCustom) > 0
          ? Number(tasaCustom)
          : Number(moneda.rows[0].tasa);
      const tasaUsdTransaccion = tasaUsdDocumento(moneda.rows[0], tasaCustom, monedasCatalogo);
      const montoBase = aBase(Number(monto), tasaUsdTransaccion);

      const res = await client.query(
        `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, tasa, descripcion, referencia_tipo, referencia_id) 
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [caja_id, tipo, monto, monedaId, montoBase, tasaAplicada, descripcion || null, referencia_tipo || null, referencia_id || null]
      );

      const transaccion = res.rows[0];

      if (tipo === "Entrada") {
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`, [monto, caja_id]);
      } else if (tipo === "Salida") {
        if (caja.rows[0].saldo_actual < monto) {
          throw new Error("Saldo insuficiente en la caja");
        }
        await client.query(`UPDATE cajas SET saldo_actual = saldo_actual - $1 WHERE id = $2`, [monto, caja_id]);
      }

      return transaccion;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al crear transacción" }, { status: 500 });
  }
}
