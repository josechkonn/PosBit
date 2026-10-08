export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const cierres = await query(`
      SELECT 
        cc.*,
        c.nombre as caja_nombre,
        m.codigo as moneda_codigo,
        m.simbolo as moneda_simbolo
      FROM cierres_caja cc
      JOIN cajas c ON cc.caja_id = c.id
      JOIN monedas m ON c.moneda_id = m.id
      ORDER BY cc.fecha_cierre DESC, cc.id DESC
    `);
    return NextResponse.json(cierres);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener cierres de caja" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { caja_id, observaciones } = body;

    if (!caja_id) {
      return NextResponse.json({ error: "Caja ID requerido" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const caja = await client.query(`SELECT * FROM cajas WHERE id = $1`, [caja_id]);
      if (caja.rows.length === 0) {
        throw new Error("Caja no encontrada");
      }

      const cajaData = caja.rows[0];

      if (cajaData.estado !== "Abierta") {
        throw new Error("La caja ya está cerrada");
      }

      const transacciones = await client.query(
        `SELECT * FROM transacciones WHERE caja_id = $1 AND fecha >= $2 AND fecha <= NOW()`,
        [caja_id, cajaData.fecha_apertura]
      );

      let totalEntradas = 0;
      let totalSalidas = 0;
      let totalEntradasBase = 0;
      let totalSalidasBase = 0;

      for (const t of transacciones.rows) {
        if (t.tipo === "Entrada") {
          totalEntradas += parseFloat(t.monto);
          totalEntradasBase += parseFloat(t.monto_base);
        } else if (t.tipo === "Salida") {
          totalSalidas += parseFloat(t.monto);
          totalSalidasBase += parseFloat(t.monto_base);
        }
      }

      const saldoCierre = parseFloat(cajaData.saldo_actual) || 0;
      const saldoApertura = saldoCierre - totalEntradas + totalSalidas;

      const res = await client.query(
        `INSERT INTO cierres_caja (caja_id, fecha_apertura, fecha_cierre, saldo_apertura, total_entradas, total_salidas, saldo_cierre, total_entradas_base, total_salidas_base, observaciones) 
         VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [caja_id, cajaData.fecha_apertura, saldoApertura, totalEntradas, totalSalidas, saldoCierre, totalEntradasBase, totalSalidasBase, observaciones || null]
      );

      // CRITICAL: Leave cash box balance in 0 when closed as requested
      await client.query(
        `UPDATE cajas SET saldo_actual = 0.00, estado = 'Cerrada', fecha_cierre = NOW() WHERE id = $1`,
        [caja_id]
      );

      return res.rows[0];
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al cerrar caja" }, { status: 500 });
  }
}
