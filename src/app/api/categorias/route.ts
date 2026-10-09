export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const categorias = await query(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM productos WHERE categoria_id = c.id AND activo = true) as productos_count
      FROM categorias c 
      ORDER BY c.nombre ASC, c.id ASC
    `);
    return NextResponse.json(categorias);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener categorías" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, descripcion, activo } = body;

    if (!nombre) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO categorias (nombre, descripcion, activo) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [nombre, descripcion || null, activo !== false]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear categoría" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, descripcion, activo } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE categorias 
       SET nombre = COALESCE($2, nombre), 
           descripcion = COALESCE($3, descripcion),
           activo = COALESCE($4, activo)
       WHERE id = $1 
       RETURNING *`,
      [id, nombre, descripcion, activo]
    );

    if (!result) {
      return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar categoría" }, { status: 500 });
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

    const count = await queryOne(`SELECT COUNT(*) FROM productos WHERE categoria_id = $1`, [id]);
    if (count && parseInt(count.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene productos asociados" }, { status: 400 });
    }

    await execute(`DELETE FROM categorias WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar categoría" }, { status: 500 });
  }
}
