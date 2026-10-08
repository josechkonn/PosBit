export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth-server";
import { query, queryOne, execute } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const config = await query(`
      SELECT clave, valor, tipo, descripcion 
      FROM configuracion 
      ORDER BY tipo, clave
    `);
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener configuracion" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireRole(["admin"]);
    const body = await request.json();
    const { clave, valor } = body;

    if (!clave) {
      return NextResponse.json({ error: "Clave requerida" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE configuracion 
       SET valor = $2, actualizado_en = NOW() 
       WHERE clave = $1 
       RETURNING *`,
      [clave, valor]
    );

    if (!result) {
      return NextResponse.json({ error: "Configuracion no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar configuracion" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(["admin"]);
    const body = await request.json();
    const { clave, valor, tipo, descripcion } = body;

    if (!clave || !tipo) {
      return NextResponse.json({ error: "Campos requeridos: clave, tipo" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO configuracion (clave, valor, tipo, descripcion) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado_en = NOW()
       RETURNING *`,
      [clave, valor, tipo, descripcion]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al guardar configuracion" }, { status: 500 });
  }
}
