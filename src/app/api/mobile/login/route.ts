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
      clientes,
      clienteLimitesCredito,
      productos,
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
      query(`SELECT * FROM clientes ORDER BY nombre ASC`),
      query(`SELECT * FROM cliente_limites_credito`),
      query(
        `SELECT p.*, c.nombre as categoria_nombre, m.nombre as marca_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         LEFT JOIN marcas m ON p.marca_id = m.id
         ORDER BY p.nombre ASC`
      ),
      query(`SELECT * FROM producto_presentaciones WHERE activo = true ORDER BY unidades ASC`),
      query(`SELECT * FROM creditos ORDER BY fecha DESC, id DESC LIMIT 300`),
      query(`SELECT * FROM abonos ORDER BY fecha DESC, id DESC LIMIT 500`),
      query(`SELECT * FROM ventas ORDER BY fecha DESC, id DESC LIMIT 200`),
    ]);

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
      clientes,
      clienteLimitesCredito,
      productos,
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
