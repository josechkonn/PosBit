export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const monedas = await query(`
      SELECT m.*, 
        (SELECT COUNT(*) FROM cajas WHERE moneda_id = m.id) as cajas_count
      FROM monedas m 
      ORDER BY m.es_base DESC, m.codigo ASC, m.id ASC
    `);
    return NextResponse.json(monedas);
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener monedas" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(["admin"]);
    const body = await request.json();
    const {
      nombre, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo,
      usa_tasa_usd_directa, tasa_usd_directa,
    } = body;

    if (!nombre || !codigo || !simbolo || tasa === undefined) {
      return NextResponse.json({ error: "Campos requeridos: nombre, codigo, simbolo, tasa" }, { status: 400 });
    }

    const directaValor = Number(tasa_usd_directa);
    const directaActiva = !es_base && usa_tasa_usd_directa === true;

    const result = await transaction(async (client) => {
      if (es_base) {
        await client.query("UPDATE monedas SET es_base = false WHERE es_base = true");
      }

      const res = await client.query(
        `INSERT INTO monedas (nombre, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo, usa_tasa_usd_directa, tasa_usd_directa) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING *`,
        [
          nombre, codigo, simbolo, tasa, tasa_ref_moneda_id || null, decimales ?? 2, es_base || false, activo !== false,
          directaActiva, directaActiva && Number.isFinite(directaValor) && directaValor > 0 ? directaValor : null,
        ]
      );

      const moneda = res.rows[0];

      if (moneda.activo) {
        await client.query(
          `INSERT INTO cajas (nombre, moneda_id, saldo_actual, estado) 
           VALUES ($1, $2, 0.00, 'Abierta')`,
          [`Caja ${moneda.codigo}`, moneda.id]
        );

        const cajaRes = await client.query(
          `SELECT id FROM cajas WHERE moneda_id = $1 ORDER BY id DESC LIMIT 1`,
          [moneda.id]
        );

        if (cajaRes.rows.length > 0) {
          const cajaId = cajaRes.rows[0].id;
          await client.query(
            `INSERT INTO metodos_pago (nombre, tipo, caja_id, activo) VALUES 
              ($1, 'Efectivo', $2, true),
              ($3, 'Electronico', $2, true),
              ($4, 'Tarjeta', $2, true)`,
            [`Efectivo ${moneda.codigo}`, cajaId, `Transferencia ${moneda.codigo}`, `Tarjeta ${moneda.codigo}`]
          );
        }
      }

      return moneda;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear moneda" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireRole(["admin"]);
    const body = await request.json();
    const {
      id, nombre, codigo, simbolo, tasa, tasa_ref_moneda_id, decimales, es_base, activo,
      usa_tasa_usd_directa, tasa_usd_directa,
    } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    // tasa_ref_moneda_id sí admite volver a NULL (referencia USD), por eso
    // se distingue "no vino en el body" de "vino null".
    const vieneRef = Object.prototype.hasOwnProperty.call(body, "tasa_ref_moneda_id");
    // tasa_usd_directa también admite volver a NULL (desactivar el valor).
    const vieneDirecta = Object.prototype.hasOwnProperty.call(body, "tasa_usd_directa");
    const directaValor = Number(tasa_usd_directa);
    const directaActiva = es_base === true ? false : usa_tasa_usd_directa;

    const result = await transaction(async (client) => {
      if (es_base) {
        await client.query("UPDATE monedas SET es_base = false WHERE es_base = true AND id != $1", [id]);
      }

      const res = await client.query(
        `UPDATE monedas 
         SET nombre = COALESCE($2, nombre), 
             codigo = COALESCE($3, codigo), 
             simbolo = COALESCE($4, simbolo), 
             tasa = COALESCE($5, tasa), 
             decimales = COALESCE($6, decimales),
             es_base = COALESCE($7, es_base),
             activo = COALESCE($8, activo),
             tasa_ref_moneda_id = CASE WHEN $9 THEN $10::uuid ELSE tasa_ref_moneda_id END,
             usa_tasa_usd_directa = COALESCE($11, usa_tasa_usd_directa),
             tasa_usd_directa = CASE WHEN $12 THEN $13::numeric ELSE tasa_usd_directa END
         WHERE id = $1 
         RETURNING *`,
        [
          id, nombre, codigo, simbolo, tasa, decimales, es_base, activo,
          vieneRef, vieneRef ? tasa_ref_moneda_id || null : null,
          directaActiva,
          vieneDirecta,
          vieneDirecta && Number.isFinite(directaValor) && directaValor > 0 ? directaValor : null,
        ]
      );

      return res.rows[0];
    });

    if (!result) {
      return NextResponse.json({ error: "Moneda no encontrada" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Error al actualizar moneda" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireRole(["admin"]);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const moneda = await queryOne(`SELECT * FROM monedas WHERE id = $1`, [id]);
    if (!moneda) {
      return NextResponse.json({ error: "Moneda no encontrada" }, { status: 404 });
    }

    if (moneda.es_base) {
      return NextResponse.json({ error: "No se puede eliminar la moneda base" }, { status: 400 });
    }

    await execute(`DELETE FROM monedas WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar moneda" }, { status: 500 });
  }
}
