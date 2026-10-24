export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * POST /api/mobile/login
 * Endpoint de inicio de sesión diseñado para la App Móvil Expo (React Native)
 * y nodos de sincronización remotos. Devuelve un Bearer Token de sesión válido
 * y el catálogo inicial completo en una sola petición.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Debes ingresar correo y contraseña" },
        { status: 400 }
      );
    }

    await queryOne("SELECT 1");

    let signInResult: any;
    try {
      signInResult = await auth.api.signInEmail({
        body: { email, password },
      });
    } catch (authErr: any) {
      return NextResponse.json(
        { error: authErr?.message || "Credenciales inválidas" },
        { status: 401 }
      );
    }

    if (!signInResult || !signInResult.user) {
      return NextResponse.json(
        { error: "Correo o contraseña incorrectos" },
        { status: 401 }
      );
    }

    const userId = signInResult.user.id;
    let token: string | null = signInResult.token ?? null;

    const [
      latestSession,
      userRow,
      configuracionGlobal,
      monedas,
      cajas,
      metodosPago,
      categorias,
      marcas,
      proveedores,
      clientes,
      clienteLimitesCredito,
      productosRaw,
      productoProveedores,
      productoPresentaciones,
      creditos,
      abonos,
      ventas,
    ] = await Promise.all([
      !token
        ? queryOne<{ token: string }>(
            `SELECT token FROM "session" WHERE "userId" = $1 AND "expiresAt" > NOW() ORDER BY "createdAt" DESC LIMIT 1`,
            [userId]
          )
        : Promise.resolve(null),
      queryOne<{
        id: string;
        name: string;
        email: string;
        role: string;
      }>(`SELECT id, name, email, role FROM "user" WHERE id = $1`, [userId]),
      queryOne(`SELECT * FROM configuracion_global LIMIT 1`),
      query(`SELECT * FROM monedas WHERE activo = true ORDER BY es_base DESC, codigo ASC`),
      query(`SELECT * FROM cajas ORDER BY nombre ASC`),
      query(`SELECT * FROM metodos_pago WHERE activo = true ORDER BY nombre ASC`),
      query(`SELECT * FROM categorias ORDER BY nombre ASC`),
      query(`SELECT * FROM marcas ORDER BY nombre ASC`),
      query(`SELECT * FROM proveedores ORDER BY nombre ASC`),
      query(`SELECT * FROM clientes ORDER BY nombre ASC`),
      query(`SELECT * FROM cliente_limites_credito`),
      query(
        `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre, pr.nombre as proveedor_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         LEFT JOIN marcas m ON p.marca_id = m.id
         LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
         WHERE (p.eliminado IS NULL OR p.eliminado = false)
         ORDER BY p.nombre ASC`
      ),
      query(
        `SELECT pp.producto_id, pr.id, pr.nombre
         FROM producto_proveedores pp
         JOIN proveedores pr ON pr.id = pp.proveedor_id
         ORDER BY pr.nombre ASC`
      ).catch(() => [] as any[]),
      query(
        `SELECT pp.*
         FROM producto_presentaciones pp
         JOIN productos p ON p.id = pp.producto_id
         WHERE pp.activo = true AND (p.eliminado IS NULL OR p.eliminado = false)
         ORDER BY pp.unidades ASC`
      ),
      query(`SELECT * FROM creditos ORDER BY fecha DESC, id DESC LIMIT 300`),
      query(`SELECT * FROM abonos ORDER BY fecha DESC, id DESC LIMIT 500`),
      query(`SELECT * FROM ventas ORDER BY fecha DESC, id DESC LIMIT 200`),
    ]);

    const provMap = new Map<number, Array<{ id: string; nombre: string }>>();
    for (const row of (productoProveedores || []) as any[]) {
      const pid = Number(row.producto_id);
      const arr = provMap.get(pid) || [];
      arr.push({ id: String(row.id), nombre: String(row.nombre) });
      provMap.set(pid, arr);
    }
    const productos = ((productosRaw || []) as any[]).map((p) => ({
      ...p,
      proveedores: provMap.get(Number(p.id)) || [],
    }));

    if (!token && latestSession?.token) {
      token = latestSession.token;
    }

    return NextResponse.json({
      ok: true,
      token,
      user: {
        id: userId,
        name: userRow?.name ?? signInResult.user.name,
        email: userRow?.email ?? signInResult.user.email,
        role: userRow?.role ?? "usuario",
      },
      configuracionGlobal,
      monedas,
      cajas,
      metodosPago,
      categorias,
      marcas,
      proveedores,
      clientes,
      clienteLimitesCredito,
      productos,
      productoProveedores,
      productoPresentaciones,
      creditos,
      abonos,
      ventas,
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API Mobile Login] Error:", error);
    return NextResponse.json(
      { error: "Error al iniciar sesión móvil: " + (error?.message || error) },
      { status: 500 }
    );
  }
}
