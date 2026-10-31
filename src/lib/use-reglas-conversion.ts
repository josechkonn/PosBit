"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  convertirConMetodo,
  decimalesDeMoneda,
  reglasConversion,
  type MonedaConversion,
  type ReglasConversionGlobal,
} from "@/lib/money";

/** Fragmento de `configuracion_global` que define el motor de conversión y redondeo. */
type CfgMotor = {
  metodo_conversion_compras?: string | null;
  metodo_conversion_ventas?: string | null;
  moneda_transito_compras_id?: string | null;
  moneda_transito_ventas_id?: string | null;
  redondeo_activo?: boolean | null;
  redondeo_multiplo?: number | string | null;
  redondeo_no_bajar_de_costo?: boolean | null;
};

let cachedCfgMotor: CfgMotor | null = null;

/**
 * Carga `/api/configuracion-global` y expone las reglas del motor + un
 * `convertirProducto` que respeta el método configurado para el lado pedido:
 *   - tipo "compra": costo de compra (usa la regla de COMPRAS).
 *   - tipo "venta":  precio de venta / cobros / deudas (usa la regla de VENTAS
 *                    + múltiplo de redondeo cuando la moneda destino es COP / sin decimales).
 */
export function useReglasConversion(monedas: MonedaConversion[]) {
  const [cfg, setCfg] = useState<CfgMotor | null>(cachedCfgMotor);

  useEffect(() => {
    let vivo = true;
    fetch("/api/configuracion-global")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === "object") {
          cachedCfgMotor = d as CfgMotor;
          if (vivo) setCfg(d as CfgMotor);
        }
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

  const convertirProducto = useCallback(
    (
      monto: number,
      desde: MonedaConversion | null | undefined,
      hasta: MonedaConversion | null | undefined,
      tipo: "compra" | "venta",
      decimales?: number
    ): number => {
      const regla = tipo === "compra" ? reglas.compras : reglas.ventas;
      const decEf = decimales !== undefined ? decimales : decimalesDeMoneda(hasta, 2);
      return convertirConMetodo(
        monto,
        desde,
        hasta,
        {
          metodo: regla.metodo,
          monedaTransito: regla.monedaTransito,
          catalogo: monedas,
          redondeo: tipo === "venta" ? reglas.redondeo ?? null : null,
        },
        decEf
      );
    },
    [reglas, monedas]
  );

  return { reglas, convertirProducto, cfgLoaded: cfg !== null };
}