export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, transaction } from "@/lib/db";

function generarNumero() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `CRE-${year}-${random}`;
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const estado = searchParams.get("estado");
    const clienteId = searchParams.get("cliente_id");

    let where = "";
    const params: any[] = [];
    if (estado && estado !== "Todos") {
      params.push(estado);
      where += `WHERE cr.estado = $${params.length}`;
    }
    if (clienteId) {
      params.push(clienteId);
      where += where ? ` AND cr.cliente_id = $${params.length}` : `WHERE cr.cliente_id = $${params.length}`;
    }

    const creditos = await query(
      `SELECT cr.*,
        cl.nombre as cliente_nombre,
        cl.telefono as cliente_telefono,
        cl.documento as cliente_documento,
        v.numero as venta_numero,
        v.fecha as venta_fecha,
        mo.codigo as moneda_codigo,
        mo.simbolo as moneda_simbolo,
        COALESCE((SELECT COUNT(*) FROM abonos a WHERE a.credito_id = cr.id), 0) as abonos_count,
        GREATEST(cr.monto_total - cr.saldo, 0) as abonado
      FROM creditos cr
      JOIN clientes cl ON cr.cliente_id = cl.id
      LEFT JOIN ventas v ON cr.venta_id = v.id
      JOIN monedas mo ON cr.moneda_id = mo.id
      ${where}
      ORDER BY CASE cr.estado WHEN 'Pendiente' THEN 0 WHEN 'Parcial' THEN 1 ELSE 2 END, cr.fecha DESC, cr.id DESC`,
      params
    );

    const summaryRow = await queryOne<{ pendientes: string; pagados: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'Pendiente') as pendientes,
        COUNT(*) FILTER (WHERE estado = 'Pagado') as pagados
      FROM creditos
    `);

    const saldosRows = await query<{ codigo: string; simbolo: string; es_base: boolean; total_saldo: string; total_saldo_base: string }>(`
      SELECT
        mo.codigo,
        mo.simbolo,
        mo.es_base,
        SUM(CASE WHEN cr.estado <> 'Pagado' THEN cr.saldo ELSE 0 END) as total_saldo,
        SUM(CASE WHEN cr.estado <> 'Pagado' THEN cr.saldo_base ELSE 0 END) as total_saldo_base
      FROM creditos cr
      JOIN monedas mo ON cr.moneda_id = mo.id
      GROUP BY mo.codigo, mo.simbolo, mo.es_base
    `);

    // Una línea por moneda: cada deuda se muestra en su propia moneda
    const por_cobrar = saldosRows
      .map((row) => ({
        codigo: row.codigo,
        simbolo: row.simbolo,
        es_base: row.es_base,
        monto: parseFloat(row.total_saldo || "0"),
      }))
      .filter((row) => row.monto > 0)
      .sort((a, b) => Number(b.es_base) - Number(a.es_base) || a.codigo.localeCompare(b.codigo))
      .map(({ codigo, simbolo, monto }) => ({ codigo, simbolo, monto }));

    return NextResponse.json({
      creditos,
      summary: {
        por_cobrar,
        pendientes: summaryRow?.pendientes ?? "0",
        pagados: summaryRow?.pagados ?? "0",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener créditos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { credito_id, monto, fecha, moneda_id, metodo_pago_id, caja_id, observaciones, retorno_id } = body;

    if (!credito_id || !monto || parseFloat(monto) <= 0) {
      return NextResponse.json({ error: "Campos requeridos: credito_id, monto mayor a 0" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const creditoRes = await client.query(`SELECT * FROM creditos WHERE id = $1`, [credito_id]);
      if (creditoRes.rows.length === 0) {
        throw new Error("Crédito no encontrado");
      }
      const credito = creditoRes.rows[0];

      // Moneda del abono (la que seleccionó el usuario)
      const monedaAbonoRes = await client.query(`SELECT * FROM monedas WHERE id = $1`, [moneda_id || credito.moneda_id]);
      if (monedaAbonoRes.rows.length === 0) {
        throw new Error("Moneda no encontrada");
      }
      const monedaAbono = monedaAbonoRes.rows[0];
      const tasaAbono = parseFloat(monedaAbono.tasa);
      const esBaseAbono = monedaAbono.es_base;

      // Moneda del crédito (puede ser diferente a la del abono)
      const monedaCreditoRes = await client.query(`SELECT * FROM monedas WHERE id = $1`, [credito.moneda_id]);
      const monedaCredito = monedaCreditoRes.rows[0];
      const tasaCredito = parseFloat(monedaCredito.tasa);
      const esBaseCredito = monedaCredito.es_base;

      const montoAbono = Math.round(parseFloat(monto) * 100) / 100;

      // Convertir el monto del abono a la moneda del crédito para comparar con el saldo
      let montoEnMonedaCredito: number;
      if (monedaAbono.id === monedaCredito.id) {
        // Misma moneda, sin conversión
        montoEnMonedaCredito = montoAbono;
      } else {
        // Convertir: abono → USD → moneda del crédito
        const montoUsd = esBaseAbono ? montoAbono : montoAbono / tasaAbono;
        montoEnMonedaCredito = esBaseCredito ? montoUsd : Math.round(montoUsd * tasaCredito * 100) / 100;
      }

      if (montoEnMonedaCredito > parseFloat(credito.saldo) + 0.01) {
        throw new Error(`El monto equivalente (${montoEnMonedaCredito.toFixed(2)} ${monedaCredito.codigo}) excede el saldo pendiente (${credito.saldo} ${monedaCredito.codigo})`);
      }

      // Calcular el monto en moneda base (USD) para saldo_base
      const montoBase = esBaseAbono ? montoAbono : Math.round((montoAbono / tasaAbono) * 100) / 100;

      const nuevoSaldo = Math.max(0, parseFloat(credito.saldo) - montoEnMonedaCredito);
      const nuevoSaldoBase = Math.max(0, parseFloat(credito.saldo_base) - montoBase);
      const nuevoEstado = nuevoSaldo <= 0.01 ? "Pagado" : "Parcial";

      await client.query(
        `INSERT INTO abonos (credito_id, cliente_id, retorno_id, fecha, monto, moneda_id, monto_base, metodo_pago_id, caja_id, observaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [credito.id, credito.cliente_id, retorno_id || null, fecha || credito.fecha, montoAbono, monedaAbono.id, montoBase, metodo_pago_id || null, caja_id || null, observaciones || null]
      );

      await client.query(
        `UPDATE creditos SET saldo = $1, saldo_base = $2, estado = $3 WHERE id = $4`,
        [nuevoSaldo, nuevoSaldoBase, nuevoEstado, credito.id]
      );

      if (caja_id) {
        await client.query(
          `INSERT INTO transacciones (caja_id, fecha, tipo, monto, moneda_id, monto_base, descripcion, referencia_tipo, referencia_id)
           VALUES ($1, NOW(), 'Entrada', $2, $3, $4, $5, 'abono', $6)`,
          [caja_id, montoAbono, monedaAbono.id, montoBase, `Abono crédito ${credito.numero}`, credito.id]
        );
        await client.query(
          `UPDATE cajas SET saldo_actual = saldo_actual + $1 WHERE id = $2`,
          [montoAbono, caja_id]
        );
      }

      return { abono: { ...body, monto: montoAbono, monto_base: montoBase }, credito: { ...credito, saldo: nuevoSaldo, saldo_base: nuevoSaldoBase, estado: nuevoEstado } };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al registrar abono" }, { status: 500 });
  }
}
