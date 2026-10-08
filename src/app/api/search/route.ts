import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const like = `%${q}%`;

    const [productos, categorias, marcas, proveedores] = await Promise.all([
      query(
        `SELECT p.id, p.nombre, p.codigo, 'producto' as tipo, p.stock, p.activo
         FROM productos p
         WHERE p.nombre ILIKE $1 OR p.codigo ILIKE $1
         ORDER BY p.nombre ASC
         LIMIT 8`,
        [like]
      ),
      query(
        `SELECT c.id, c.nombre, 'categoria' as tipo
         FROM categorias c
         WHERE c.nombre ILIKE $1
         ORDER BY c.nombre ASC
         LIMIT 5`,
        [like]
      ),
      query(
        `SELECT m.id, m.nombre, 'marca' as tipo, m.pais
         FROM marcas m
         WHERE m.nombre ILIKE $1
         ORDER BY m.nombre ASC
         LIMIT 5`,
        [like]
      ),
      query(
        `SELECT p.id, p.nombre, 'proveedor' as tipo, p.ciudad, p.rif
         FROM proveedores p
         WHERE p.nombre ILIKE $1 OR p.rif ILIKE $1 OR p.ciudad ILIKE $1
         ORDER BY p.nombre ASC
         LIMIT 5`,
        [like]
      ),
    ]);

    const results = [
      ...productos.map((p: any) => ({
        id: p.id,
        label: p.nombre,
        sub: `${p.codigo} · Existencias: ${p.stock}`,
        tipo: "producto",
        href: `/productos`,
        activo: p.activo,
      })),
      ...categorias.map((c: any) => ({
        id: c.id,
        label: c.nombre,
        sub: "Categoría",
        tipo: "categoria",
        href: `/categorias`,
      })),
      ...marcas.map((m: any) => ({
        id: m.id,
        label: m.nombre,
        sub: m.pais || "Marca",
        tipo: "marca",
        href: `/marcas`,
      })),
      ...proveedores.map((p: any) => ({
        id: p.id,
        label: p.nombre,
        sub: p.ciudad || "Proveedor",
        tipo: "proveedor",
        href: `/proveedores`,
      })),
    ];

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: "Error en la búsqueda" }, { status: 500 });
  }
}
