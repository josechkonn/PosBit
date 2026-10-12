"use client";

import { useEffect, useMemo, useState } from "react";
import {
  convertirConMetodo,
  reglasConversion,
  type MonedaConversion,
  type ReglasConversionGlobal,
} from "@/lib/money";

/** Fragmento de `configuracion_global` que define el motor de conversión. */
type CfgMotor = {
  metodo_conversion_compras?: string | null;
  metodo_conversion_ventas?: string | null;
  moneda_transito_compras_id?: string | null;
  moneda_transito_ventas_id?: string | null;
};

/**
 * Carga `/api/configuracion-global` y expone las reglas del motor + un
 * `convertirProducto` que respeta el método configurado para el lado pedido:
 *   - tipo "compra": costo de compra (usa la regla de COMPRAS).
 *   - tipo "venta":  precio de venta (usa la regla de VENTAS).
 *
 * Comparte la EXACTA misma regla que el servidor (`reglasConversion` en
 * `money.ts`): si el usuario activa triangulación, el costo que se ve en el
 * modal de producto se convierte igual que el que calcula la API (y las
 * compras), evitando que "lo que se muestra" y "lo que se guarda" difieran.
 *
 * Mientras la configuración no ha cargado se cae a "directa" (comportamiento
 * histórico), así el modal no parpadea ni cambia valores a medio editar.
 */
export function useReglasConversion(monedas: MonedaConversion[]) {
  const [cfg, setCfg] = useState<CfgMotor | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/configuracion-global")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d && typeof d === "object") setCfg(d as CfgMotor);
      })
      .catch(() => {
        // Sin red a la API: seguimos con la regla por defecto (directa).
      });
    return () => {
      vivo = false;
    };
  }, []);

  const reglas: ReglasConversionGlobal = useMemo(
    () => reglasConversion(cfg, monedas),
    [cfg, monedas]
  );

  const convertirProducto = (
    monto: number,
    desde: MonedaConversion | null | undefined,
    hasta: MonedaConversion | null | undefined,
    tipo: "compra" | "venta",
    decimales = 2
  ): number => {
    const regla = tipo === "compra" ? reglas.compras : reglas.ventas;
    return convertirConMetodo(monto, desde, hasta, {
      metodo: regla.metodo,
      monedaTransito: regla.monedaTransito,
      catalogo: monedas,
    }, decimales);
  };

  return { reglas, convertirProducto };
}