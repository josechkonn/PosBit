export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionOrBearer } from "@/lib/auth-server";
import { query, queryOne } from "@/lib/db";
import { countPendingLocalChanges, ensureSyncTables, getSyncConfig } from "@/lib/sync-engine";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  try {
    const session = await getSessionOrBearer();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    await ensureSyncTables();
    const config = await getSyncConfig();
    const [pending, historial] = await Promise.all([
      countPendingLocalChanges(config.ultima_sincronizacion_push, config.modo_conexion),
      query(`SELECT * FROM sync_historial ORDER BY fecha DESC LIMIT 10`),
    ]);

    return NextResponse.json({
      config,
      pending,
      historial,
    });
  } catch (error: any) {
    console.error("[API Sync Config GET] Error:", error);
    return NextResponse.json(
      { error: "Error al leer configuración de sincronización: " + (error?.message || error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSessionOrBearer();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    await ensureSyncTables();
    const body = await request.json();

    const nombreDispositivo = String(body.nombre_dispositivo ?? "Caja Principal").trim() || "Caja Principal";
    const modoConexion = ["desactivado", "api_nube", "db_directa"].includes(body.modo_conexion)
      ? body.modo_conexion
      : "desactivado";
    const cloudUrl = body.cloud_url ? String(body.cloud_url).trim() : null;
    const cloudApiKey = body.cloud_api_key ? String(body.cloud_api_key).trim() : null;
    const cloudDbUrl = body.cloud_database_url ? String(body.cloud_database_url).trim() : null;
    const autoSync = body.auto_sync !== false;
    const intervaloSegundos = Math.max(5, Number(body.intervalo_segundos) || 30);

    const estadoInicial =
      modoConexion === "desactivado" ? "sin_configurar" : "listo";

    const updated = await queryOne(
      `UPDATE sync_config
          SET nombre_dispositivo = $1::varchar,
              modo_conexion = $2::varchar,
              cloud_url = $3::text,
              cloud_api_key = $4::text,
              cloud_database_url = $5::text,
              auto_sync = $6::boolean,
              intervalo_segundos = $7::integer,
              ultimo_estado = CASE WHEN $2::varchar = 'desactivado' THEN 'sin_configurar' ELSE COALESCE(NULLIF(ultimo_estado, 'sin_configurar'), $8::varchar) END,
              actualizado_en = NOW()
        WHERE id = 1
        RETURNING *`,
      [
        nombreDispositivo,
        modoConexion,
        cloudUrl,
        cloudApiKey,
        cloudDbUrl,
        autoSync,
        intervaloSegundos,
        estadoInicial,
      ]
    );

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("[API Sync Config PUT] Error:", error);
    return NextResponse.json(
      { error: "Error al guardar configuración de nube: " + (error?.message || error) },
      { status: 500 }
    );
  }
}
