export const dynamic = 'force-dynamic';

// ============================================================================
// POSBIT - Job admin: recalcular precios de venta con las reglas vigentes
// ----------------------------------------------------------------------------
// Re-aplica margen + redondeo GLOBAL actuales (leídos de la BD en este momento)
// usando el CPP de cada producto. Solo toca productos con precio_auto = true
// para no pisar precios definidos a mano. Responde al caso: "cambié la regla de
// redondeo a mitad de jornada y quiero realinear los precios automáticos".
// ============================================================================

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { transaction } from "@/lib/db";
import { getConfiguracionGlobal } from "@/lib/global-config";
import { recalcularPreciosMasivo } from "@/lib/costing";

export async function POST() {
  try {
    await requireRole(["admin"]);

    const cambios = await transaction(async (client) => {
      const cfg = await getConfiguracionGlobal(client);
      const monedas = await client.query(`SELECT * FROM monedas`);
      const catalogo = monedas.rows;
      const baseSistema = catalogo.find((m: any) => m.es_base) ?? catalogo[0];
      return recalcularPreciosMasivo(client, cfg, catalogo, baseSistema);
    });

    return NextResponse.json({ cambios, total: cambios.length });
  } catch (error) {
    console.error("Error al recalcular precios:", error);
    return NextResponse.json({ error: "Error al recalcular precios" }, { status: 500 });
  }
}