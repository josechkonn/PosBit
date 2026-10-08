export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const cajas = await query(`
      SELECT 
        c.*, 
        m.codigo as moneda_codigo, 
        m.simbolo as moneda_simbolo, 
        m.es_base,
        COALESCE(
          (SELECT SUM(t.monto) FROM transacciones t WHERE t.caja_id = c.id AND t.tipo = 'Entrada' AND t.fecha >= c.fecha_apertura), 0.00
        ) as total_entradas,
        COALESCE(
          (SELECT SUM(t.monto) FROM transacciones t WHERE t.caja_id = c.id AND t.tipo = 'Salida' AND t.fecha >= c.fecha_apertura), 0.00
        ) as total_salidas,
        (SELECT COUNT(*) FROM transacciones WHERE caja_id = c.id) as transacciones_count
      FROM cajas c
      JOIN monedas m ON c.moneda_id = m.id
      ORDER BY m.es_base DESC, c.nombre ASC, c.id ASC
    `);
    return NextResponse.json(cajas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener cajas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, moneda_id } = body;

    if (!nombre || !moneda_id) {
      return NextResponse.json({ error: "Campos requeridos: nombre, moneda_id" }, { status: 400 });
    }

    const existing = await queryOne(`SELECT id FROM cajas WHERE moneda_id = $1 AND estado = 'Abierta'`, [moneda_id]);
    if (existing) {
      return NextResponse.json({ error: "Ya existe una caja abierta para esta moneda" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO cajas (nombre, moneda_id, saldo_actual, estado, fecha_apertura) 
       VALUES ($1, $2, 0.00, 'Abierta', NOW()) 
       RETURNING *`,
      [nombre, moneda_id]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear caja" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, saldo_actual, saldo_apertura, estado, accion } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    // Action: abrir caja (re-abrir caja con saldo inicial de apertura)
    if (accion === "abrir") {
      const initialSaldo = parseFloat(String(saldo_apertura)) || 0;
      const reopened = await queryOne(
        `UPDATE cajas 
         SET estado = 'Abierta', 
             saldo_actual = $1, 
             fecha_apertura = NOW(), 
             fecha_cierre = NULL 
         WHERE id = $2 RETURNING *`,
        [initialSaldo, id]
      );
      return NextResponse.json(reopened);
    }

    const result = await queryOne(
      `UPDATE cajas 
       SET nombre = COALESCE($2, nombre), 
           saldo_actual = COALESCE($3, saldo_actual),
           estado = COALESCE($4, estado)
       WHERE id = $1 
       RETURNING *`,
      [id, nombre, saldo_actual, estado]
    );

    if (!result) {
      return NextResponse.json({ error: "Caja no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar caja" }, { status: 500 });
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

    const caja = await queryOne(`SELECT * FROM cajas WHERE id = $1`, [id]);
    if (!caja) {
      return NextResponse.json({ error: "Caja no encontrada" }, { status: 404 });
    }

    if (caja.estado === "Abierta") {
      return NextResponse.json({ error: "Debe cerrar la caja antes de eliminarla" }, { status: 400 });
    }

    await execute(`DELETE FROM cajas WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar caja" }, { status: 500 });
  }
}
