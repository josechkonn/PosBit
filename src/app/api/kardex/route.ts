export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";

export async function GET() {
  try {
    await requireSession();
    const movimientos = await query(`
      SELECT 
        k.*,
        p.nombre as producto_nombre,
        p.codigo as producto_codigo
      FROM kardex k
      JOIN productos p ON k.producto_id = p.id
      ORDER BY k.fecha DESC, k.id DESC
    `);
    return NextResponse.json(movimientos);
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

      const res = await client.query(
        `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual) 
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [producto_id, tipo, motivo || "Ajuste manual", cantidad, producto.rows[0].costo_base, producto.rows[0].costo_base, stockAnterior, nuevoStock]
      );

      return res.rows[0];
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al crear movimiento" }, { status: 500 });
  }
}
