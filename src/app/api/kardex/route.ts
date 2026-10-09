export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query, queryOne, execute, transaction } from "@/lib/db";
import { aBase, tasaUsd, monedaCostoDeProducto } from "@/lib/money";

export async function GET() {
  try {
    await requireSession();
    const movimientos = await query(`
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

      // `costo_unit` en la moneda de COMPRA del producto y `costo_unit_base` en USD
      // Catálogo completo (incluso monedas inactivas) para resolver la cadena
      const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
      const monedaBase = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
      const monedaCosto = monedaCostoDeProducto(producto.rows[0], monedaBase, monedasCatalogo);
      const costoUnitBase = aBase(Number(producto.rows[0].costo_base) || 0, tasaUsd(monedaCosto, monedasCatalogo));

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
