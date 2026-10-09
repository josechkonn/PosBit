export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const metodos = await query(`
      SELECT mp.*, c.nombre as caja_nombre, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo
      FROM metodos_pago mp
      LEFT JOIN cajas c ON mp.caja_id = c.id
      LEFT JOIN monedas m ON c.moneda_id = m.id
      ORDER BY mp.nombre ASC, mp.id ASC
    `);
    return NextResponse.json(metodos);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener métodos de pago" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, tipo, caja_id, activo } = body;

    if (!nombre || !tipo || !caja_id) {
      return NextResponse.json({ error: "Campos requeridos: nombre, tipo, caja_id" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO metodos_pago (nombre, tipo, caja_id, activo) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [nombre, tipo, caja_id, activo !== false]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear método de pago" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, tipo, caja_id, activo } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE metodos_pago 
       SET nombre = COALESCE($2, nombre), 
           tipo = COALESCE($3, tipo),
           caja_id = COALESCE($4, caja_id),
           activo = COALESCE($5, activo)
       WHERE id = $1 
       RETURNING *`,
      [id, nombre, tipo, caja_id, activo]
    );

    if (!result) {
      return NextResponse.json({ error: "Método de pago no encontrado" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar método de pago" }, { status: 500 });
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

    await execute(`DELETE FROM metodos_pago WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar método de pago" }, { status: 500 });
  }
}
