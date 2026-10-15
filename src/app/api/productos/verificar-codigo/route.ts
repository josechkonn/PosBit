export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-server";
import { query } from "@/lib/db";

/**
 * GET /api/productos/verificar-codigo
 *
 * ¿Está libre este código de barras? Pensado para avisar MIENTRAS se escribe,
 * sin esperar a pulsar Guardar. Acepta varios códigos a la vez para que la tabla
 * de presentaciones verifique toda la lista en un solo viaje.
 *
 *   ?tipo=producto&codigo=HAR-001&excluirProductoId=5
 *   ?tipo=caja&codigo=CAJA-1&codigo=CAJA-2&excluirProductoId=5
 *   ?tipo=caja&codigo=CAJA-1&excluirId=<uuid>   (una caja que se está editando)
 *
 * Respuesta:
 *   { resultados: { "HAR-001": { disponible: false, mensaje: "Ya lo usa el producto X" } } }
 *
 * `disponible` compara sin distinguir mayúsculas, igual que el escaneo. Se
 * excluye el producto (y la caja) que se está EDITANDO, para que guardar sin
 * cambios no se marque a sí mismo como duplicado.
 *
 * La comprobación definitiva sigue estando en el servidor al guardar: esto es
 * una ayuda para no descubrir el problema tarde, no un candado.
 */
export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);

    const tipo = searchParams.get("tipo") === "caja" ? "caja" : "producto";
    const excluirProductoId = searchParams.get("excluirProductoId") || null;
    const excluirId = searchParams.get("excluirId") || null;

    const codigos = searchParams
      .getAll("codigo")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 50);

    if (codigos.length === 0) {
      return NextResponse.json({ resultados: {} });
    }

    // Una sola consulta para todos los códigos: cada producto/caja se reporta
    // una vez y se le pega su lista de códigos buscados.
    const filas = await query(
      `WITH buscados AS (
         SELECT DISTINCT lower(codigo) AS codigo
           FROM unnest($1::text[]) AS t(codigo)
       )
       SELECT b.codigo,
              'producto' AS origen,
              pr.nombre AS etiqueta,
              NULL::text AS detalle
         FROM buscados b
         JOIN productos pr ON lower(pr.codigo) = b.codigo
        WHERE ($2::int IS NULL OR pr.id <> $2)
       UNION ALL
       SELECT b.codigo,
              'caja' AS origen,
              pr.nombre AS etiqueta,
              pp.nombre AS detalle
         FROM buscados b
         JOIN producto_presentaciones pp ON lower(pp.codigo) = b.codigo
         JOIN productos pr ON pr.id = pp.producto_id
        WHERE pp.codigo IS NOT NULL
          AND ($3::uuid IS NULL OR pp.id <> $3)
          AND ($2::int IS NULL OR pp.producto_id <> $2)
       -- 'producto' primero: si un código choca con las dos cosas, el aviso
       -- más útil es "ya es el código de este producto".
       ORDER BY 1, 2`,
      [codigos, excluirProductoId ? Number(excluirProductoId) : null, excluirId || null]
    );

    // Se prioriza avisar por un producto: el código de un producto es el que la
    // gente reconoce, así que "ya es el código de X" se entiende mejor que
    // "ya es la caja X de Y".
    const resultados: Record<string, { disponible: boolean; mensaje: string }> = {};
    for (const codigo of codigos) {
      resultados[codigo] = { disponible: true, mensaje: "" };
    }
    for (const f of filas) {
      const codigo = codigos.find((c) => c.toLowerCase() === f.codigo);
      if (!codigo) continue;
      // El primer hallazgo gana (el ORDER BY pone productos antes que cajas).
      if (resultados[codigo].disponible) {
        resultados[codigo] = {
          disponible: false,
          mensaje:
            f.origen === "producto"
              ? `Ya es el código del producto "${f.etiqueta}"`
              : `Ya es el código de la caja "${f.detalle}" de "${f.etiqueta}"`,
        };
      }
    }

    return NextResponse.json({ resultados });
  } catch (error) {
    console.error("Error verificando código:", error);
    return NextResponse.json({ error: "Error al verificar el código" }, { status: 500 });
  }
}
