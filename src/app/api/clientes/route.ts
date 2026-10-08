export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";

// Un límite por moneda del cliente (0 = sin crédito en esa moneda)
const SQL_LIMITES = `
  (SELECT json_agg(
      json_build_object(
        'moneda_id', m.id,
        'codigo', m.codigo,
        'simbolo', m.simbolo,
        'es_base', m.es_base,
        'limite', COALESCE(lc.limite, 0)
      ) ORDER BY m.es_base DESC, m.codigo ASC)
   FROM monedas m
   LEFT JOIN cliente_limites_credito lc ON lc.moneda_id = m.id AND lc.cliente_id = cl.id
   WHERE m.activo = true) as limites_credito`;

async function upsertLimites(client: any, clienteId: number, limites: any) {
  if (!Array.isArray(limites)) return;
  for (const l of limites) {
    if (!l || !l.moneda_id) continue;
    const limite = Math.max(0, Math.round((parseFloat(String(l.limite ?? 0)) || 0) * 100) / 100);
    await client.query(
      `INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite, actualizado_en)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (cliente_id, moneda_id)
       DO UPDATE SET limite = EXCLUDED.limite, actualizado_en = NOW()`,
      [clienteId, l.moneda_id, limite]
    );
  }
}

// Mantiene la columna histórica limite_credito = límite en la moneda base
async function sincronizarLimiteBase(client: any, clienteId: number) {
  await client.query(
    `UPDATE clientes cl
     SET limite_credito = COALESCE(
       (SELECT lc.limite
        FROM cliente_limites_credito lc
        JOIN monedas m ON m.id = lc.moneda_id
        WHERE lc.cliente_id = cl.id AND m.es_base = true), 0)
     WHERE cl.id = $1`,
    [clienteId]
  );
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;
    const activos = searchParams.get("activos") === "true";

    const where = activos ? "WHERE cl.activo = true" : "";
    const totalRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM clientes cl ${where}`
    );
    const total = Number(totalRow?.count || 0);

    const clientes = await query(`
      SELECT cl.*,
        ${SQL_LIMITES},
        (SELECT json_agg(
            json_build_object(
              'codigo', d.codigo, 
              'simbolo', d.simbolo, 
              'es_base', d.es_base,
              'total_saldo', d.total_saldo, 
              'total_saldo_base', d.total_saldo_base
            )
          )
         FROM (
           SELECT mo.codigo, mo.simbolo, mo.es_base,
             SUM(cr.saldo) as total_saldo, 
             SUM(cr.saldo_base) as total_saldo_base
           FROM creditos cr
           JOIN monedas mo ON cr.moneda_id = mo.id
           WHERE cr.cliente_id = cl.id AND cr.estado <> 'Pagado'
           GROUP BY mo.codigo, mo.simbolo, mo.es_base
         ) d
        ) as deuda_desglosada,
        (SELECT COUNT(*) FROM ventas v WHERE v.cliente_id = cl.id) as ventas_count,
        (SELECT COUNT(*) FROM retornos r WHERE r.cliente_id = cl.id) as retornos_count
      FROM clientes cl
      ${where}
      ORDER BY cl.nombre ASC, cl.id ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const clientesProcesados = clientes.map(cliente => {
      const deudas: any[] = cliente.deuda_desglosada || [];

      // Una línea por moneda: cada deuda se muestra en su propia moneda
      const deuda_total = deudas
        .map((row) => ({
          codigo: row.codigo,
          simbolo: row.simbolo,
          es_base: row.es_base,
          monto: parseFloat(row.total_saldo || "0"),
        }))
        .filter((row) => row.monto > 0)
        .sort((a, b) => Number(b.es_base) - Number(a.es_base) || a.codigo.localeCompare(b.codigo))
        .map(({ codigo, simbolo, monto }) => ({ codigo, simbolo, monto }));

      delete cliente.deuda_desglosada;
      
      return {
        ...cliente,
        limites_credito: cliente.limites_credito || [],
        deuda_total
      };
    });

    return NextResponse.json({
      data: clientesProcesados,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito, limite_credito, limites_credito, activo } = body;

    if (!nombre) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO clientes (nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito, limite_credito, activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [nombre, tipo || "Persona Natural", documento || null, email || null, telefono || null, ciudad || null, direccion || null, recibe_credito === true, limite_credito || 0, activo !== false]
      );
      const cliente = ins.rows[0];

      if (Array.isArray(limites_credito)) {
        await upsertLimites(client, cliente.id, limites_credito);
        await sincronizarLimiteBase(client, cliente.id);
      } else if (parseFloat(String(limite_credito || 0)) > 0) {
        // Compatibilidad: si llega un solo límite, se guarda en la moneda base
        const base = await client.query(`SELECT id FROM monedas WHERE es_base = true LIMIT 1`);
        if (base.rows[0]) {
          await upsertLimites(client, cliente.id, [{ moneda_id: base.rows[0].id, limite: limite_credito }]);
          await sincronizarLimiteBase(client, cliente.id);
        }
      }

      const full = await client.query(
        `SELECT cl.*, ${SQL_LIMITES} FROM clientes cl WHERE cl.id = $1`,
        [cliente.id]
      );
      return full.rows[0];
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito, limite_credito, limites_credito, activo } = body;

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const upd = await client.query(
        `UPDATE clientes
         SET nombre = COALESCE($2, nombre),
             tipo = COALESCE($3, tipo),
             documento = COALESCE($4, documento),
             email = COALESCE($5, email),
             telefono = COALESCE($6, telefono),
             ciudad = COALESCE($7, ciudad),
             direccion = COALESCE($8, direccion),
             recibe_credito = COALESCE($9, recibe_credito),
             limite_credito = COALESCE($10, limite_credito),
             activo = COALESCE($11, activo)
         WHERE id = $1
         RETURNING *`,
        [id, nombre, tipo, documento, email, telefono, ciudad, direccion, recibe_credito === true, limite_credito, activo === true]
      );

      if (upd.rows.length === 0) {
        throw new Error("Cliente no encontrado");
      }

      if (Array.isArray(limites_credito)) {
        await upsertLimites(client, id, limites_credito);
        await sincronizarLimiteBase(client, id);
      }

      const full = await client.query(
        `SELECT cl.*, ${SQL_LIMITES} FROM clientes cl WHERE cl.id = $1`,
        [id]
      );
      return full.rows[0];
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al actualizar cliente";
    return NextResponse.json({ error: msg }, { status: msg === "Cliente no encontrado" ? 404 : 500 });
  }
}

// Ajusta el límite de crédito de un cliente en una moneda puntual (usado por el POS)
export async function PATCH(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { id, moneda_id, limite } = body;

    if (!id || !moneda_id || limite === undefined || limite === null) {
      return NextResponse.json({ error: "Campos requeridos: id, moneda_id, limite" }, { status: 400 });
    }

    const valor = Math.max(0, Math.round((parseFloat(String(limite)) || 0) * 100) / 100);

    const result = await transaction(async (client) => {
      const existe = await client.query(`SELECT id FROM clientes WHERE id = $1`, [id]);
      if (existe.rows.length === 0) {
        throw new Error("Cliente no encontrado");
      }

      await client.query(
        `INSERT INTO cliente_limites_credito (cliente_id, moneda_id, limite, actualizado_en)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (cliente_id, moneda_id)
         DO UPDATE SET limite = EXCLUDED.limite, actualizado_en = NOW()`,
        [id, moneda_id, valor]
      );
      await sincronizarLimiteBase(client, id);

      const row = await client.query(
        `SELECT lc.*, m.codigo, m.simbolo, m.es_base
         FROM cliente_limites_credito lc
         JOIN monedas m ON m.id = lc.moneda_id
         WHERE lc.cliente_id = $1 AND lc.moneda_id = $2`,
        [id, moneda_id]
      );
      return row.rows[0];
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error al actualizar el límite de crédito";
    return NextResponse.json({ error: msg }, { status: msg === "Cliente no encontrado" ? 404 : 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }

    const ventas = await queryOne(`SELECT COUNT(*) FROM ventas WHERE cliente_id = $1`, [id]);
    if (ventas && parseInt(ventas.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene ventas asociadas" }, { status: 400 });
    }

    const creditos = await queryOne(`SELECT COUNT(*) FROM creditos WHERE cliente_id = $1`, [id]);
    if (creditos && parseInt(creditos.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene créditos asociados" }, { status: 400 });
    }

    const retornos = await queryOne(`SELECT COUNT(*) FROM retornos WHERE cliente_id = $1`, [id]);
    if (retornos && parseInt(retornos.count) > 0) {
      return NextResponse.json({ error: "No se puede eliminar: tiene retornos asociados" }, { status: 400 });
    }

    await execute(`DELETE FROM clientes WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Error al eliminar cliente" }, { status: 500 });
  }
}
