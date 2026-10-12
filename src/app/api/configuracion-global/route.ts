export const dynamic = 'force-dynamic';

// ============================================================================
// POSBIT - Configuración Global del motor de costeo/pricing
// ----------------------------------------------------------------------------
// GET: cualquier sesión autenticada lee las reglas (para el panel).
// PUT: solo admin guarda TODO el objeto (métodos, tránsito, toggle, redondeo).
// ============================================================================

import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth-server";
import { transaction } from "@/lib/db";
import { getConfiguracionGlobal } from "@/lib/global-config";

export async function GET() {
  try {
    await requireSession();
    const cfg = await getConfiguracionGlobal();
    return NextResponse.json(cfg);
  } catch (error) {
    console.error("Error al leer configuracion_global:", error);
    return NextResponse.json({ error: "Error al obtener la configuración global" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireRole(["admin"]);
    const body = await request.json();

    const metodo = (v: unknown): "directa" | "triangulacion" =>
      v === "triangulacion" ? "triangulacion" : "directa";
    const multiplo = Number(body.redondeo_multiplo);
    const multiploValido = Number.isFinite(multiplo) && multiplo > 0 ? Math.abs(multiplo) : 0;

    await transaction(async (client) => {
      await client.query(
        `UPDATE configuracion_global SET
           metodo_conversion_compras = $1,
           metodo_conversion_ventas = $2,
           moneda_transito_compras_id = $3,
           moneda_transito_ventas_id = $4,
           auto_precio_compra = $5,
           redondeo_activo = $6,
           redondeo_multiplo = $7,
           redondeo_no_bajar_de_costo = $8
         WHERE id = 1`,
        [
          metodo(body.metodo_conversion_compras),
          metodo(body.metodo_conversion_ventas),
          body.moneda_transito_compras_id || null,
          body.moneda_transito_ventas_id || null,
          body.auto_precio_compra !== false,
          body.redondeo_activo === true,
          multiploValido,
          body.redondeo_no_bajar_de_costo !== false,
        ]
      );
    });

    const cfg = await getConfiguracionGlobal();
    return NextResponse.json(cfg);
  } catch (error) {
    console.error("Error al guardar configuracion_global:", error);
    return NextResponse.json({ error: "Error al guardar la configuración global" }, { status: 500 });
  }
}