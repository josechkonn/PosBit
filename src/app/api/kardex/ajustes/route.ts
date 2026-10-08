export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { transaction } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Debe proveer al menos un ítem" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      for (const item of items) {
        if (!item.producto_id || !item.tipo || !item.cantidad || parseFloat(item.cantidad) <= 0) {
          throw new Error("Datos de ítem inválidos");
        }

        const qty = parseFloat(item.cantidad);
        
        // Bloquear producto
        const pRes = await client.query(`SELECT * FROM productos WHERE id = $1 FOR UPDATE`, [item.producto_id]);
        if (pRes.rows.length === 0) throw new Error(`Producto con ID ${item.producto_id} no encontrado`);
        const producto = pRes.rows[0];

        const saldoAnterior = parseFloat(producto.stock);
        let nuevoStock = saldoAnterior;
        let cantKardex = 0;

        if (item.tipo === "Salida") {
          if (saldoAnterior < qty) {
            throw new Error(`Existencias insuficientes para el producto ${producto.nombre} (Existencias actuales: ${saldoAnterior})`);
          }
          nuevoStock = saldoAnterior - qty;
          cantKardex = -qty;
        } else if (item.tipo === "Entrada") {
          nuevoStock = saldoAnterior + qty;
          cantKardex = qty;
        } else {
          throw new Error("Tipo de ajuste inválido");
        }

        // Actualizar stock
        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, producto.id]);

        // Registrar en kardex (usamos 'Ajuste' como tipo global)
        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual, creado_por)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            producto.id,
            "Ajuste",
            item.motivo || 'Ajuste manual',
            cantKardex,
            producto.costo_base,
            producto.costo_base,
            saldoAnterior,
            nuevoStock,
            session.user?.id || null
          ]
        );
      }
      return { success: true };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al registrar ajuste" }, { status: 500 });
  }
}
