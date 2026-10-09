export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const marcas = await query(`
      SELECT m.*, 
        (SELECT COUNT(*) FROM productos WHERE marca_id = m.id AND activo = true) as productos_count
      FROM marcas m 
      ORDER BY m.nombre ASC, m.id ASC
    `);
    return NextResponse.json(marcas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener marcas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, pais, activo } = body;

    if (!nombre) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO marcas (nombre, pais, activo) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [nombre, pais || null, activo !== false]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear marca" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, pais, activo } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE marcas 
       SET nombre = COALESCE($2, nombre), 
           pais = COALESCE($3, pais),
           activo = COALESCE($4, activo)
       WHERE id = $1 
       RETURNING *`,
      [id, nombre, pais, activo]
    );

    if (!result) {
      return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar marca" }, { status: 500 });
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

    const count = await queryOne(`SELECT COUNT(*) FROM productos WHERE marca_id = $1`, [id]);
    if (count && parseInt(count.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene productos asociados" }, { status: 400 });
    }

    await execute(`DELETE FROM marcas WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar marca" }, { status: 500 });
  }
}
