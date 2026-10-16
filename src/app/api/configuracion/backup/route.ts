export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { pool, transaction } from "@/lib/db";

const TABLES_ORDER = [
  "configuracion",
  "configuracion_global",
  "monedas",
  "cajas",
  "metodos_pago",
  "categorias",
  "marcas",
  "proveedores",
  "clientes",
  "cliente_limites_credito",
  "productos",
  "producto_proveedores",
  "producto_presentaciones",
  "producto_precios",
  "producto_costos_historicos",
  "compras",
  "compra_items",
  "compra_abonos",
  "ventas",
  "venta_items",
  "venta_pagos",
  "creditos",
  "abonos",
  "retornos",
  "retorno_items",
  "cierres_caja",
  "transacciones",
  "kardex",
];

export async function GET() {
  try {
    await requireSession();
    const data: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES_ORDER) {
      try {
        const res = await pool.query(`SELECT * FROM "${table}"`);
        data[table] = res.rows;
        counts[table] = res.rowCount || 0;
      } catch (err) {
        data[table] = [];
        counts[table] = 0;
      }
    }

    const backupPayload = {
      app: "PosBit",
      version: "0.1.21",
      fecha: new Date().toISOString(),
      counts,
      tables: data,
    };

    const filename = `posbit-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    return new Response(JSON.stringify(backupPayload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Error al exportar base de datos:", error);
    return NextResponse.json(
      { error: "Error al exportar base de datos: " + (error?.message || error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();

    if (!body || !body.tables || typeof body.tables !== "object") {
      return NextResponse.json(
        { error: "El archivo no contiene un formato de respaldo válido de PosBit" },
        { status: 400 }
      );
    }

    const tablesData = body.tables;
    const restoredCounts: Record<string, number> = {};

    await transaction(async (client) => {
      let replicaEnabled = false;
      try {
        await client.query("SET session_replication_role = 'replica'");
        replicaEnabled = true;
      } catch {
        // En caso de usuario sin permisos superuser, se mantiene el orden inverso
      }

      try {
        // 1. Vaciar tablas en orden inverso
        const reverseTables = [...TABLES_ORDER].reverse();
        for (const table of reverseTables) {
          try {
            await client.query(`DELETE FROM "${table}"`);
          } catch (delErr: any) {
            console.warn(`Aviso al vaciar tabla ${table}:`, delErr?.message);
          }
        }

        // 2. Insertar tablas en orden directo
        for (const table of TABLES_ORDER) {
          const rows = tablesData[table];
          if (!Array.isArray(rows) || rows.length === 0) {
            restoredCounts[table] = 0;
            continue;
          }

          // Lotes de 100 registros para optimizar parámetros SQL
          const BATCH_SIZE = 100;
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const columns = Object.keys(batch[0]);
            if (columns.length === 0) continue;

            const colNames = columns.map((c) => `"${c}"`).join(", ");
            const valueClauses: string[] = [];
            const params: any[] = [];
            let paramIdx = 1;

            for (const row of batch) {
              const rowPlaceholders: string[] = [];
              for (const col of columns) {
                rowPlaceholders.push(`$${paramIdx++}`);
                let val = row[col];
                if (val !== null && typeof val === "object" && !(val instanceof Date)) {
                  val = JSON.stringify(val);
                }
                params.push(val);
              }
              valueClauses.push(`(${rowPlaceholders.join(", ")})`);
            }

            const queryText = `INSERT INTO "${table}" (${colNames}) VALUES ${valueClauses.join(", ")}`;
            await client.query(queryText, params);
          }

          restoredCounts[table] = rows.length;
        }

        // 3. Sincronizar secuencias seriales en PostgreSQL
        const serialTables = [
          { table: "productos", col: "id" },
          { table: "producto_costos_historicos", col: "id" },
          { table: "configuracion_global", col: "id" },
        ];

        for (const { table, col } of serialTables) {
          try {
            await client.query(`
              SELECT setval(
                pg_get_serial_sequence('${table}', '${col}'),
                COALESCE((SELECT MAX("${col}") FROM "${table}"), 1),
                (SELECT MAX("${col}") FROM "${table}") IS NOT NULL
              );
            `);
          } catch {
            // Ignorar si la secuencia no aplica
          }
        }
      } finally {
        if (replicaEnabled) {
          await client.query("SET session_replication_role = 'origin'");
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: "Base de datos restaurada correctamente",
      counts: restoredCounts,
    });
  } catch (error: any) {
    console.error("Error al importar base de datos:", error);
    return NextResponse.json(
      { error: "Error al importar base de datos: " + (error?.message || error) },
      { status: 500 }
    );
  }
}
