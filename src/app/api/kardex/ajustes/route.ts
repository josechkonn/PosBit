export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { transaction } from "@/lib/db";
import { monedaCostoDeProducto, convertirConMetodo, reglasConversion } from "@/lib/money";
import { getConfiguracionGlobal } from "@/lib/global-config";

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

        // ── Caja (presentación) ──
        // El cliente puede pedir "2 cajas"; la caja solo es un FACTOR de
        // conversión. El factor se resuelve AQUÍ, contra la BD, y nunca se
        // confía en el que manda el navegador: se valida que la caja exista,
        // que siga activa y que sea del producto de esta línea. El movimiento
        // se sigue guardando en UNIDADES, que es la unidad base del inventario.
        let factor = 1;
        let etiquetaCaja: string | null = null;
        if (item.presentacion_id) {
          const presRes = await client.query(
            `SELECT id, nombre, unidades, activo
               FROM producto_presentaciones
              WHERE id = $1 AND producto_id = $2`,
            [item.presentacion_id, item.producto_id]
          );
          if (presRes.rows.length === 0) {
            throw new Error(`La caja indicada no corresponde a ${producto.nombre}`);
          }
          const pres = presRes.rows[0];
          if (pres.activo === false) {
            throw new Error(`La caja "${pres.nombre}" de ${producto.nombre} está dada de baja`);
          }
          factor = Math.max(1, parseInt(String(pres.unidades), 10) || 1);
          etiquetaCaja = pres.nombre;
        }

        // Cantidad real en unidades (lo que entra al stock y al kardex).
        const qtyUnidades = Math.round(qty * factor);

        const saldoAnterior = parseFloat(producto.stock);
        let nuevoStock = saldoAnterior;
        let cantKardex = 0;

        if (item.tipo === "Salida") {
          if (saldoAnterior < qtyUnidades) {
            throw new Error(`Existencias insuficientes para el producto ${producto.nombre} (Existencias actuales: ${saldoAnterior})`);
          }
          nuevoStock = saldoAnterior - qtyUnidades;
          cantKardex = -qtyUnidades;
        } else if (item.tipo === "Entrada") {
          nuevoStock = saldoAnterior + qtyUnidades;
          cantKardex = qtyUnidades;
        } else {
          throw new Error("Tipo de ajuste inválido");
        }

        // Actualizar stock
        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [nuevoStock, producto.id]);

        // Registrar en kardex (usamos 'Ajuste' como tipo global)
        // `costo_unit` en la moneda de COMPRA del producto, `costo_unit_base` en USD
        // Catálogo completo (incluso monedas inactivas) para resolver la cadena
        const monedasCatalogo = (await client.query(`SELECT * FROM monedas`)).rows;
        const monedaBase = monedasCatalogo.find((m: any) => m.es_base) || monedasCatalogo[0];
        const monedaCosto = monedaCostoDeProducto(producto, monedaBase, monedasCatalogo);
        // El costo estático → USD respeta el método de compras configurado
        // (directa o triangulación), igual que las compras y el alta de producto.
        const cfgGlobal = await getConfiguracionGlobal({
          query: (text: string, params?: any[]) => client.query(text, params),
        });
        const costoUnitBase = convertirConMetodo(Number(producto.costo_base) || 0, monedaCosto, monedaBase, {
          ...reglasConversion(cfgGlobal, monedasCatalogo).compras,
          catalogo: monedasCatalogo,
        }, 2);

        await client.query(
          `INSERT INTO kardex (producto_id, fecha, tipo, motivo, cantidad, costo_unit, costo_unit_base, saldo_anterior, saldo_actual, creado_por)
           VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            producto.id,
            "Ajuste",
            // La caja queda anotada en el motivo para que el histórico diga
            // "2 Cajas ×24" y no un 48 anónimo. `cantidad` sigue en unidades.
            item.motivo
              ? `${item.motivo}${etiquetaCaja ? ` (${qty} × ${etiquetaCaja} ×${factor})` : ""}`
              : etiquetaCaja
                ? `Ajuste manual (${qty} × ${etiquetaCaja} ×${factor})`
                : "Ajuste manual",
            cantKardex,
            producto.costo_base,
            costoUnitBase,
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
