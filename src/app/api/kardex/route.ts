export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { monedaCostoDeProducto, convertirConMetodo, reglasConversion } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

/** Columnas ordenables (whitelist) → expresión SQL. Evita inyección por `sortKey`. */
const SORT_COLUMNS: Record<string, string> = {
  fecha: "k.fecha",
  producto_codigo: "p.codigo",
  producto_nombre: "p.nombre",
  tipo: "k.tipo",
  motivo: "k.motivo",
  cantidad: "k.cantidad",
  costo_unit: "k.costo_unit",
  saldo_anterior: "k.saldo_anterior",
  saldo_actual: "k.saldo_actual",
};

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(1000, Math.max(1, parseInt(limitParam, 10) || 20)) : 20;
    const offset = (page - 1) * limit;
    const search = (searchParams.get("search") || "").trim();
    const tipo = (searchParams.get("tipo") || "todos").trim();

    // Filtros
    const where: string[] = [];
    const params: any[] = [];
    if (tipo === "Entrada" || tipo === "Salida" || tipo === "Ajuste") {
      params.push(tipo);
      where.push(`k.tipo = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(p.nombre ILIKE $${params.length} OR p.codigo ILIKE $${params.length} OR k.motivo ILIKE $${params.length})`
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Orden (server-side, con desempate estable por id)
    const sortCol = SORT_COLUMNS[searchParams.get("sortKey") || "fecha"] || "k.fecha";
    const sortOrder = (searchParams.get("sortOrder") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const totalRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM kardex k
       JOIN productos p ON k.producto_id = p.id
       ${whereSql}`,
      params
    );
    const total = Number(totalRow?.count || 0);

    // Totales globales del kardex (independientes del filtro/página)
    const statsRow = await queryOne<{ entradas: string; salidas: string; ajustes: string }>(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'Entrada' THEN ABS(cantidad) ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo = 'Salida' THEN ABS(cantidad) ELSE 0 END), 0) AS salidas,
        COUNT(*) FILTER (WHERE tipo = 'Ajuste') AS ajustes
      FROM kardex
    `);

    const movimientos = await query(
      `
      SELECT
        k.*,
        p.nombre as producto_nombre,
        p.codigo as producto_codigo,
        p.moneda_base_id,
        p.moneda_costo_id,
        pm.codigo as producto_moneda_codigo,
        pm.simbolo as producto_moneda_simbolo
      FROM kardex k
      JOIN productos p ON k.producto_id = p.id
      LEFT JOIN monedas pm ON COALESCE(p.moneda_costo_id, p.moneda_base_id) = pm.id
      ${whereSql}
      ORDER BY ${sortCol} ${sortOrder}, k.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      movimientos,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      stats: {
        entradas: Number(statsRow?.entradas || 0),
        salidas: Number(statsRow?.salidas || 0),
        ajustes: Number(statsRow?.ajustes || 0),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener kardex" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const { producto_id, tipo, motivo, cantidad } = body;

    if (!producto_id || !tipo || !cantidad) {
      return NextResponse.json({ error: "Campos requeridos: producto_id, tipo, cantidad" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const producto = await client.query(`SELECT * FROM productos WHERE id = $1`, [producto_id]);
      if (producto.rows.length === 0) {
        throw new Error("Producto no encontrado");
      }

      const stockAnterior = producto.rows[0].stock;
      let nuevoStock = stockAnterior;

      if (tipo === "Entrada") {
        nuevoStock = stockAnterior + cantidad;
      } else if (tipo === "Salida") {
        if (stockAnterior < cantidad) {
          throw new Error("Existencias insuficientes");
        }
        nuevoStock = stockAnterior - cantidad;
      } else if (tipo === "Ajuste") {
        nuevoStock = stockAnterior + cantidad;
        if (nuevoStock < 0) {
          throw new Error("El ajuste resultaría en existencias negativas");
        }
      }

      await client.query(
        `UPDATE productos SET stock = $1 WHERE id = $2`,
        [nuevoStock, producto_id]
      );

      // `costo_unit` en la moneda de COMPRA del producto y `costo_unit_base` en USD
      // Catálogo completo (incluso monedas inactivas) para resolver la cadena
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaBase = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
      const monedaCosto = monedaCostoDeProducto(producto.rows[0], monedaBase, monedasCatalogo);
      // El costo estático → USD respeta el método de compras configurado
      // (directa o triangulación), igual que las compras y el alta de producto.
      const cfgGlobal = await getConfiguracionGlobal({
        query: (text: string, params?: any[]) => client.query(text, params),
      });
      const costoUnitBase = convertirConMetodo(Number(producto.rows[0].costo_base) || 0, monedaCosto, monedaBase, {
        ...reglasConversion(cfgGlobal, monedasCatalogo).compras,
        catalogo: monedasCatalogo,
      }, 2);

      const res = await client.query(
        `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [
          producto_id,
          tipo,
          motivo || "Ajuste manual",
          cantidad,
          producto.rows[0].costo_base,
          costoUnitBase,
          stockAnterior,
          nuevoStock,
        ]
      );

      return res.rows[0];
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al crear movimiento" }, { status: 500 });
  }
}
