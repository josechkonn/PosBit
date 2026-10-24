export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getSessionOrBearer } from "@/lib/auth-server";
import { pool, query, transaction } from "@/lib/db";
import {
  applyDeltaToDb,
  collectDeltaFromDb,
  countPendingLocalChanges,
  ensureSyncTables,
  executeCloudSync,
  executeStageSync,
  getSyncConfig,
  SYNC_STAGES,
  type SyncDeltaPayload,
} from "@/lib/sync-engine";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * GET /api/sync
 * - ?action=status → Devuelve estado local de sincronización, cambios pendientes e historial opcional.
 * - ?since=ISO_DATE&mode=mobile|full → Extrae y devuelve el delta de cambios desde esa fecha.
 */
export async function GET(request: Request) {
  try {
    const session = await getSessionOrBearer();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    await ensureSyncTables();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "ping") {
      return NextResponse.json({ ok: true, timestamp: Date.now() });
    }

    if (action === "status") {
      const config = await getSyncConfig();
      const includeHistory = searchParams.get("history") === "1";
      const [pending, historial] = await Promise.all([
        countPendingLocalChanges(config.ultima_sincronizacion_push, config.modo_conexion),
        includeHistory
          ? query(`SELECT * FROM sync_historial ORDER BY fecha DESC LIMIT 10`)
          : Promise.resolve([]),
      ]);

      return NextResponse.json({
        config: {
          ...config,
          has_api_key: Boolean(config.cloud_api_key),
          has_db_url: Boolean(config.cloud_database_url),
        },
        pending,
        historial,
      });
    }

    const since = searchParams.get("since") || null;
    const mode = searchParams.get("mode") === "mobile" ? "mobile" : "full";
    const stageParam = searchParams.get("stage");
    const tablesParam = searchParams.get("tables");
    let targetTables: string[] | undefined;
    if (stageParam) {
      const stageNum = parseInt(stageParam, 10);
      const stageDef = SYNC_STAGES.find((s) => s.id === stageNum);
      if (stageDef) targetTables = [...stageDef.tablas];
    } else if (tablesParam) {
      targetTables = tablesParam.split(",").map((t) => t.trim()).filter(Boolean);
    }

    const cfg = await getSyncConfig();
    const delta = await collectDeltaFromDb(pool, since, cfg.dispositivo_id, {
      mode,
      tables: targetTables,
      stage: stageParam ? parseInt(stageParam, 10) : undefined,
    });

    return NextResponse.json(delta);
  } catch (error: any) {
    console.error("[API Sync GET] Error:", error);
    return NextResponse.json(
      { error: "Error en lectura de sincronización: " + (error?.message || error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sync
 * Acciones soportadas:
 *   - "bidirectional_sync": En 1 sola petición HTTP aplica el delta del cliente y devuelve el delta del servidor.
 *   - "remote_push": Un cliente remoto (otra PC o App Móvil Expo) sube su delta a este servidor.
 *   - "sync_now": Ejecuta sincronización bidireccional incremental Local ↔ Nube.
 *   - "push_all": Fuerza subida completa Local → Nube (inicializar nube).
 *   - "pull_all": Fuerza descarga completa Nube → Local (clonar datos en otra PC).
 *   - "test_connection": Verifica conectividad con la nube configurada.
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionOrBearer();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    await ensureSyncTables();
    const body = await request.json();
    const action = body?.action || "sync_now";

    // 1. Sincronización bidireccional en 1 solo viaje de red (Push + Pull combinados)
    if (action === "bidirectional_sync") {
      const startTime = Date.now();
      const since: string | null = body.since || null;
      const mode = body.mode === "mobile" ? "mobile" : "full";
      const stage = body.stage ? Number(body.stage) : null;
      const tables = Array.isArray(body.tables) ? body.tables : undefined;
      const incomingPayload: SyncDeltaPayload | null = body.payload || null;

      // Primero recolectamos el delta del servidor desde `since` (antes de aplicar los propios cambios del cliente)
      const cfg = await getSyncConfig();
      const serverDelta = await collectDeltaFromDb(pool, since, cfg.dispositivo_id, {
        mode,
        stage: stage ?? undefined,
        tables,
      });

      let appliedRows = 0;
      let deletedRows = 0;

      if (
        incomingPayload &&
        incomingPayload.tables &&
        typeof incomingPayload.tables === "object"
      ) {
        const res = await transaction(async (client) => {
          return await applyDeltaToDb(client, incomingPayload);
        });
        appliedRows = res.appliedRows;
        deletedRows = res.deletedRows;

        if (appliedRows > 0 || deletedRows > 0) {
          const duracionMs = Date.now() - startTime;
          await query(
            `INSERT INTO sync_historial (direccion, registros_subidos, registros_bajados, estado, detalle, duracion_ms)
             VALUES ('entrante', 0, $1, 'ok', $2, $3)`,
            [
              appliedRows,
              `Sincronización bidireccional desde dispositivo ${incomingPayload.dispositivo_id || "remoto"}`,
              duracionMs,
            ]
          );
        }
      }

      return NextResponse.json({
        ok: true,
        appliedRows,
        deletedRows,
        delta: serverDelta,
        serverTime: new Date().toISOString(),
      });
    }

    // 2. Recibir push desde otro equipo o desde la App Móvil
    if (action === "remote_push") {
      const startTime = Date.now();
      const payload: SyncDeltaPayload = body.payload;

      if (!payload || !payload.tables || typeof payload.tables !== "object") {
        return NextResponse.json(
          { error: "Payload de sincronización inválido" },
          { status: 400 }
        );
      }

      const result = await transaction(async (client) => {
        return await applyDeltaToDb(client, payload);
      });

      const duracionMs = Date.now() - startTime;
      if (result.appliedRows > 0 || result.deletedRows > 0) {
        await query(
          `INSERT INTO sync_historial (direccion, registros_subidos, registros_bajados, estado, detalle, duracion_ms)
           VALUES ('entrante', 0, $1, 'ok', $2, $3)`,
          [
            result.appliedRows,
            `Recibidos ${result.appliedRows} cambios desde dispositivo ${payload.dispositivo_id || "remoto"}`,
            duracionMs,
          ]
        );
      }

      return NextResponse.json({
        ok: true,
        appliedRows: result.appliedRows,
        deletedRows: result.deletedRows,
        serverTime: new Date().toISOString(),
      });
    }

    // 3. Probar conexión con la nube antes de guardar o sincronizar
    if (action === "test_connection") {
      const startTime = Date.now();
      const modo = body.modo_conexion;

      if (modo === "db_directa") {
        const dbUrl = body.cloud_database_url;
        if (!dbUrl) {
          return NextResponse.json(
            { ok: false, error: "Ingresa una URL de PostgreSQL (postgresql://...)" },
            { status: 400 }
          );
        }
        const testPool = new Pool({
          connectionString: dbUrl,
          max: 1,
          connectionTimeoutMillis: 8000,
        });
        try {
          const res = await testPool.query(
            "SELECT current_database() AS db, NOW() AS server_time"
          );
          const latency = Date.now() - startTime;
          return NextResponse.json({
            ok: true,
            latency,
            mensaje: `Conectado a PostgreSQL en la nube (BD: ${res.rows[0]?.db}) en ${latency} ms.`,
          });
        } finally {
          await testPool.end().catch(() => {});
        }
      }

      if (modo === "api_nube") {
        const cloudUrl = (body.cloud_url || "").replace(/\/+$/, "");
        const apiKey = body.cloud_api_key || "";
        if (!cloudUrl) {
          return NextResponse.json(
            { ok: false, error: "Ingresa la URL del servidor PosBit en la nube" },
            { status: 400 }
          );
        }

        const headers: Record<string, string> = {};
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
          headers["X-Sync-Api-Key"] = apiKey;
        }

        const res = await fetch(`${cloudUrl}/api/sync?action=status`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        });

        const latency = Date.now() - startTime;
        if (!res.ok) {
          return NextResponse.json(
            {
              ok: false,
              error:
                res.status === 401
                  ? "El servidor respondió 401 No Autorizado. Verifica tu Clave/Token de Sincronización."
                  : `El servidor respondió con código HTTP ${res.status}`,
            },
            { status: 400 }
          );
        }

        return NextResponse.json({
          ok: true,
          latency,
          mensaje: `Conexión exitosa con el Servidor PosBit Cloud (${latency} ms).`,
        });
      }

      return NextResponse.json(
        { ok: false, error: "Modo de conexión no válido" },
        { status: 400 }
      );
    }

    // 4. Ejecutar sincronización desde esta máquina hacia la nube
    if (action === "sync_stage") {
      const stage = Number(body.stage);
      const direction = body.direction || "bidireccional";
      const forceFull = Boolean(body.forceFull);
      const res = await executeStageSync({ stage, direction, forceFull });
      return NextResponse.json(res, { status: res.ok ? 200 : 500 });
    }

    if (action === "stages_info") {
      return NextResponse.json({ stages: SYNC_STAGES });
    }

    if (action === "sync_now") {
      const res = await executeCloudSync({ direction: "bidireccional", forceFull: false });
      return NextResponse.json(res, { status: res.ok ? 200 : 500 });
    }

    if (action === "push_all") {
      const res = await executeCloudSync({ direction: "push", forceFull: true });
      return NextResponse.json(res, { status: res.ok ? 200 : 500 });
    }

    if (action === "pull_all") {
      const res = await executeCloudSync({ direction: "pull", forceFull: true });
      return NextResponse.json(res, { status: res.ok ? 200 : 500 });
    }

    return NextResponse.json({ error: `Acción desconocida: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error("[API Sync POST] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Error interno en sincronización" },
      { status: 500 }
    );
  }
}
