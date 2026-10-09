export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const totalRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM proveedores`
    );
    const total = Number(totalRow?.count || 0);

    const proveedores = await query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM compras WHERE proveedor_id = p.id) as compras_count
      FROM proveedores p 
      ORDER BY p.nombre ASC, p.id ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return NextResponse.json({ data: proveedores, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener proveedores" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, contacto, email, telefono, ciudad, direccion, rif, activo } = body;

    if (!nombre) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }

    const existe = await queryOne(
      `SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))`,
      [nombre]
    );
    if (existe) {
      return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 400 });
    }

    const result = await queryOne(
      `INSERT INTO proveedores (nombre, contacto, email, telefono, ciudad, direccion, rif, activo) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [nombre, contacto || null, email || null, telefono || null, ciudad || null, direccion || null, rif || null, activo !== false]
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear proveedor" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, contacto, email, telefono, ciudad, direccion, rif, activo } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const duplicado = await queryOne(
      `SELECT id FROM proveedores WHERE id <> $1 AND LOWER(TRIM(nombre)) = LOWER(TRIM($2))`,
      [id, nombre]
    );
    if (duplicado) {
      return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 400 });
    }

    const result = await queryOne(
      `UPDATE proveedores 
       SET nombre = COALESCE($2, nombre), 
           contacto = COALESCE($3, contacto),
           email = COALESCE($4, email),
           telefono = COALESCE($5, telefono),
           ciudad = COALESCE($6, ciudad),
           direccion = COALESCE($7, direccion),
            rif = COALESCE($8, rif),
           activo = COALESCE($9, activo)
       WHERE id = $1 
       RETURNING *`,
      [id, nombre, contacto, email, telefono, ciudad, direccion, rif, activo]
    );

    if (!result) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar proveedor" }, { status: 500 });
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

    const count = await queryOne(`SELECT COUNT(*) FROM compras WHERE proveedor_id = $1`, [id]);
    if (count && parseInt(count.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene compras asociadas" }, { status: 400 });
    }

    await execute(`DELETE FROM proveedores WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar proveedor" }, { status: 500 });
  }
}
