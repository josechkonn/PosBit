export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { queryOne, execute } from "@/lib/db";
import { triggerBackgroundSync } from "@/lib/sync-engine";

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json().catch(() => ({}));
    const id = body.id || new URL(request.url).searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID de producto requerido" }, { status: 400 });
    }

    const producto = await queryOne<{ id: number; codigo: string; nombre: string; eliminado: boolean }>(
      `SELECT id, codigo, nombre, eliminado FROM productos WHERE id = $1`,
      [id]
    );

    if (!producto) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    if (!producto.eliminado) {
      return NextResponse.json({ error: "El producto no está en el basurero" }, { status: 400 });
    }

    // Verificar que el código no lo esté usando otro producto activo
    const colision = await queryOne<{ id: number; nombre: string }>(
      `SELECT id, nombre FROM productos WHERE lower(codigo) = lower($1) AND id <> $2 AND (eliminado IS NULL OR eliminado = false) LIMIT 1`,
      [producto.codigo, id]
    );

    if (colision) {
      return NextResponse.json(
        {
          error: `No se puede restaurar: el código "${producto.codigo}" ya lo está usando el producto activo "${colision.nombre}".`,
        },
        { status: 400 }
      );
    }

    await execute(
      `UPDATE productos SET eliminado = false, activo = true, eliminado_en = NULL WHERE id = $1`,
      [id]
    );

    triggerBackgroundSync();

    return NextResponse.json({
      success: true,
      message: `Producto "${producto.nombre}" restaurado exitosamente del basurero.`,
    });
  } catch (error) {
    console.error("Error al restaurar producto:", error);
    return NextResponse.json({ error: "Error al restaurar producto" }, { status: 500 });
  }
}
