"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDate } from "@/lib/format";
import {
  CheckCircle2,
  DollarSign,
  Plus,
  X,
  CreditCard,
  User,
  Calendar,
  History,
  AlertTriangle,
  FileText,
  Wallet,
} from "lucide-react";
import { tasaUsd, aBase, redondear, convertirConMetodo } from "@/lib/money";

interface Venta {
  id: string;
  numero: string;
  cliente: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_pago: string | null;
  fecha: string;
  creado_en: string;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  total: number | string;
  total_base: number | string;
  estado: string;
  observaciones: string | null;
  credito_id?: string | null;
  credito_numero?: string | null;
  credito_monto_total?: number | string | null;
  credito_saldo?: number | string | null;
  credito_estado?: string | null;
}

interface MetodoPago {
  id: string;
  nombre: string;
  tipo?: string;
  activo: boolean;
  caja_id: string | null;
  caja_nombre?: string | null;
  moneda_codigo?: string | null;
  moneda_simbolo?: string | null;
}

interface Caja {
  id: string;
  nombre: string;
  estado: string;
  activo: boolean;
  moneda_id?: string | null;
  saldo_actual?: number | string;
}

interface Moneda {
  id: string;
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  es_base: boolean;
  tasa_ref_moneda_id?: string | null;
  usa_tasa_usd_directa?: boolean | null;
  tasa_usd_directa?: number | string | null;
  decimales?: number;
}

interface Abono {
  id: string;
  fecha: string;
  monto: number;
  monto_base: number;
  moneda_codigo?: string;
  moneda_simbolo?: string;
  metodo_pago_nombre?: string;
  caja_nombre?: string;
  observaciones?: string;
}

interface VentaPagoModalProps {
  open: boolean;
  venta: Venta | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface LineaPago {
  key: number;
  metodoId: string;
  cajaId: string;
  montoStr: string;
}

export function VentaPagoModal({
  open,
  venta,
  onClose,
  onSuccess,
}: VentaPagoModalProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [cfgGlobal, setCfgGlobal] = useState<any>(null);
  const [abonosPrevios, setAbonosPrevios] = useState<Abono[]>([]);
  const [creditoDetalle, setCreditoDetalle] = useState<any>(null);

  // Form State
  const [isPagoMixto, setIsPagoMixto] = useState(false);
  const [metodoSeleccionadoId, setMetodoSeleccionadoId] = useState<string>("");
  const [cajaSeleccionadaId, setCajaSeleccionadaId] = useState<string>("");
  const [montoSimpleStr, setMontoSimpleStr] = useState<string>("");
  const [fechaPago, setFechaPago] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [observaciones, setObservaciones] = useState<string>("");

  // Modo Mixto Lines
  const [lineasPago, setLineasPago] = useState<LineaPago[]>([
    { key: 1, metodoId: "", cajaId: "", montoStr: "" },
  ]);

  // Cargar datos al abrir
  const loadInitialData = useCallback(async () => {
    if (!venta) return;
    setLoading(true);
    try {
      const creditoRefId = venta.credito_id || venta.id;
      const [resMet, resCaj, resMon, resCfg, resAbonos] = await Promise.all([
        fetch("/api/metodos-pago"),
        fetch("/api/cajas"),
        fetch("/api/monedas"),
        fetch("/api/configuracion-global"),
        fetch(`/api/creditos/${creditoRefId}/abonos`),
      ]);

      const [metodosData, cajasData, monedasData, cfgData, abonosData] = await Promise.all([
        resMet.ok ? resMet.json() : [],
        resCaj.ok ? resCaj.json() : [],
        resMon.ok ? resMon.json() : [],
        resCfg.ok ? resCfg.json() : null,
        resAbonos.ok ? resAbonos.json() : { abonos: [], credito: null },
      ]);

      const metodosActivos = Array.isArray(metodosData)
        ? metodosData.filter((m: any) => m.activo)
        : [];
      setMetodosPago(metodosActivos);

      const cajasAbiertas = Array.isArray(cajasData)
        ? cajasData.filter((c: any) => c.activo && c.estado === "Abierta")
        : [];
      setCajas(cajasAbiertas);

      const monedasList = Array.isArray(monedasData) ? monedasData : [];
      setMonedas(monedasList);
      setCfgGlobal(cfgData);

      setAbonosPrevios(abonosData.abonos || []);
      if (abonosData.credito) {
        setCreditoDetalle(abonosData.credito);
      }

      // Default selection
      if (metodosActivos.length > 0) {
        const defaultMetodo = metodosActivos[0];
        setMetodoSeleccionadoId(defaultMetodo.id);
        if (defaultMetodo.caja_id) {
          setCajaSeleccionadaId(defaultMetodo.caja_id);
        } else if (cajasAbiertas.length > 0) {
          setCajaSeleccionadaId(cajasAbiertas[0].id);
        }
        setLineasPago([
          {
            key: 1,
            metodoId: defaultMetodo.id,
            cajaId: defaultMetodo.caja_id || (cajasAbiertas[0]?.id ?? ""),
            montoStr: "",
          },
        ]);
      }
    } catch (err) {
      console.error("Error al cargar datos del pago de venta:", err);
      toast("Error al cargar datos de cobro", "error");
    } finally {
      setLoading(false);
    }
  }, [venta, toast]);

  useEffect(() => {
    if (open && venta) {
      setMontoSimpleStr("");
      setObservaciones("");
      setIsPagoMixto(false);
      setFechaPago(new Date().toISOString().split("T")[0]);
      loadInitialData();
    }
  }, [open, venta, loadInitialData]);

  // Moneda base del sistema (USD)
  const monedaBase: Moneda = useMemo(() => {
    return monedas.find((m) => m.es_base) || { id: "1", nombre: "Dólar", codigo: "USD", simbolo: "$", tasa: 1, es_base: true, decimales: 2 };
  }, [monedas]);

  // Moneda del crédito/venta
  const monedaVenta = useMemo(() => {
    const cod = creditoDetalle?.moneda_codigo || venta?.moneda_codigo;
    return monedas.find((m) => m.codigo === cod) || monedaBase;
  }, [creditoDetalle, venta, monedas, monedaBase]);

  // Saldo pendiente actual en la moneda del crédito
  const saldoPendienteEnMonedaCredito = useMemo(() => {
    const fuente = creditoDetalle || venta;
    if (!fuente) return 0;
    const val = fuente.saldo !== undefined ? fuente.saldo : fuente.credito_saldo;
    return Math.max(0, parseFloat(String(val || 0)));
  }, [creditoDetalle, venta]);

  // Reglas de conversión de ventas
  const metodoConversionVentas = useMemo(() => {
    return cfgGlobal?.metodo_conversion_ventas || "directa";
  }, [cfgGlobal]);

  const monedaTransitoVentas = useMemo(() => {
    if (!cfgGlobal?.moneda_transito_ventas_id) return null;
    return monedas.find((m) => String(m.id) === String(cfgGlobal.moneda_transito_ventas_id)) || null;
  }, [cfgGlobal, monedas]);

  // Método simple seleccionado
  const metodoSimple = useMemo(() => {
    return metodosPago.find((m) => String(m.id) === String(metodoSeleccionadoId)) || metodosPago[0];
  }, [metodosPago, metodoSeleccionadoId]);

  // Moneda del método simple
  const monedaSimpleObj = useMemo(() => {
    if (!metodoSimple?.moneda_codigo) return monedaBase;
    return monedas.find((m) => m.codigo === metodoSimple.moneda_codigo) || monedaBase;
  }, [metodoSimple, monedas, monedaBase]);

  // Saldo pendiente equivalente en la moneda del método de pago seleccionado
  const saldoPendienteEnMonedaSimple = useMemo(() => {
    if (saldoPendienteEnMonedaCredito <= 0) return 0;
    if (String(monedaVenta.id) === String(monedaSimpleObj.id)) {
      return redondear(saldoPendienteEnMonedaCredito, Number(monedaSimpleObj.decimales ?? 2));
    }
    return convertirConMetodo(
      saldoPendienteEnMonedaCredito,
      monedaVenta,
      monedaSimpleObj,
      {
        metodo: metodoConversionVentas,
        monedaTransito: monedaTransitoVentas,
        catalogo: monedas,
      },
      Number(monedaSimpleObj.decimales ?? 2)
    );
  }, [saldoPendienteEnMonedaCredito, monedaVenta, monedaSimpleObj, metodoConversionVentas, monedaTransitoVentas, monedas]);

  // Manejo de cambio de método de pago simple
  const handleSelectMetodoSimple = (metodo: MetodoPago) => {
    setMetodoSeleccionadoId(metodo.id);
    if (metodo.caja_id) {
      setCajaSeleccionadaId(metodo.caja_id);
    }
  };

  // Monto ingresado convertido a la moneda del crédito (modo simple)
  const montoIngresadoEnMonedaCreditoSimple = useMemo(() => {
    if (!montoSimpleStr || parseFloat(montoSimpleStr) <= 0) {
      return 0;
    }
    const montoVal = parseFloat(montoSimpleStr);
    if (String(monedaSimpleObj.id) === String(monedaVenta.id)) {
      return redondear(montoVal, Number(monedaVenta.decimales ?? 2));
    }
    return convertirConMetodo(
      montoVal,
      monedaSimpleObj,
      monedaVenta,
      {
        metodo: metodoConversionVentas,
        monedaTransito: monedaTransitoVentas,
        catalogo: monedas,
      },
      Number(monedaVenta.decimales ?? 2)
    );
  }, [montoSimpleStr, monedaSimpleObj, monedaVenta, metodoConversionVentas, monedaTransitoVentas, monedas]);

  // Cálculo en modo mixto
  const pagosMixtosResueltos = useMemo(() => {
    return lineasPago.map((l) => {
      const met = metodosPago.find((m) => String(m.id) === String(l.metodoId));
      const mon = met?.moneda_codigo ? monedas.find((m) => m.codigo === met.moneda_codigo) : monedaBase;
      const montoNum = parseFloat(l.montoStr) || 0;
      const montoEnMonedaCredito = convertirConMetodo(
        montoNum,
        mon,
        monedaVenta,
        {
          metodo: metodoConversionVentas,
          monedaTransito: monedaTransitoVentas,
          catalogo: monedas,
        },
        Number(monedaVenta.decimales ?? 2)
      );
      return {
        ...l,
        metodo: met,
        moneda: mon,
        montoNum,
        montoEnMonedaCredito,
      };
    });
  }, [lineasPago, metodosPago, monedas, monedaBase, monedaVenta, metodoConversionVentas, monedaTransitoVentas]);

  const totalMontoEnMonedaCreditoMixto = useMemo(() => {
    return pagosMixtosResueltos.reduce((acc, curr) => acc + curr.montoEnMonedaCredito, 0);
  }, [pagosMixtosResueltos]);

  // Total efectivo a abonar en la moneda del crédito
  const totalAbonoEnMonedaCredito = isPagoMixto
    ? totalMontoEnMonedaCreditoMixto
    : montoIngresadoEnMonedaCreditoSimple;

  // Nuevo saldo restante calculado
  const nuevoSaldoEnMonedaCredito = Math.max(
    0,
    saldoPendienteEnMonedaCredito - totalAbonoEnMonedaCredito
  );
  const quedaraPagado = nuevoSaldoEnMonedaCredito <= 0.009 && totalAbonoEnMonedaCredito > 0;

  // Llenar porcentaje rápido
  const handleSetPorcentaje = (pct: number) => {
    const montoEnMoneda = redondear(saldoPendienteEnMonedaSimple * pct, 2);
    setMontoSimpleStr(montoEnMoneda.toString());
  };

  // Envío del pago
  const handleProcesarPago = async (forzarCompleto = false) => {
    if (!venta) return;
    const creditoRefId = venta.credito_id || creditoDetalle?.id || venta.id;

    let payload: any = {
      fecha: fechaPago,
      observaciones: observaciones.trim() || undefined,
    };

    if (forzarCompleto) {
      // Cobrar completo en la moneda del método seleccionado
      payload.monto = saldoPendienteEnMonedaSimple;
      payload.moneda_id = monedaSimpleObj?.id || monedaBase.id;
      payload.metodo_pago_id = metodoSeleccionadoId || null;
      payload.caja_id = cajaSeleccionadaId || null;
    } else if (isPagoMixto) {
      // Validación líneas mixtas
      const validas = pagosMixtosResueltos.filter((p) => p.montoNum > 0 && p.metodoId);
      if (validas.length === 0) {
        toast("Debes ingresar al menos un método con monto válido", "warning");
        return;
      }
      if (totalMontoEnMonedaCreditoMixto > saldoPendienteEnMonedaCredito + 0.01) {
        toast(
          `El total abonado (${totalMontoEnMonedaCreditoMixto.toFixed(2)} ${monedaVenta.codigo}) supera el saldo pendiente (${saldoPendienteEnMonedaCredito.toFixed(2)} ${monedaVenta.codigo})`,
          "warning"
        );
        return;
      }
      payload.lineas = validas.map((p) => ({
        monto: p.montoNum,
        moneda_id: p.moneda?.id || monedaBase.id,
        metodo_pago_id: p.metodoId,
        caja_id: p.cajaId || null,
      }));
    } else {
      // Modo simple con monto especificado (o saldo total si está vacío)
      const montoFinal = montoSimpleStr && parseFloat(montoSimpleStr) > 0
        ? parseFloat(montoSimpleStr)
        : saldoPendienteEnMonedaSimple;

      const montoEnMonedaCreditoFinal = convertirConMetodo(
        montoFinal,
        monedaSimpleObj,
        monedaVenta,
        {
          metodo: metodoConversionVentas,
          monedaTransito: monedaTransitoVentas,
          catalogo: monedas,
        },
        Number(monedaVenta.decimales ?? 2)
      );

      if (montoEnMonedaCreditoFinal > saldoPendienteEnMonedaCredito + 0.01) {
        toast(
          `El abono (${montoEnMonedaCreditoFinal.toFixed(2)} ${monedaVenta.codigo}) excede el saldo pendiente (${saldoPendienteEnMonedaCredito.toFixed(2)} ${monedaVenta.codigo})`,
          "warning"
        );
        return;
      }

      payload.monto = montoFinal;
      payload.moneda_id = monedaSimpleObj?.id || monedaBase.id;
      payload.metodo_pago_id = metodoSeleccionadoId || null;
      payload.caja_id = cajaSeleccionadaId || null;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/creditos/${creditoRefId}/abonos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Error al procesar el cobro");
      }

      toast(
        quedaraPagado || forzarCompleto
          ? "¡Venta saldada en su totalidad exitosamente!"
          : "Abono registrado con éxito",
        "success"
      );
      onSuccess();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error al registrar cobro", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!venta) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Abonar / Cobrar Venta a Crédito — ${venta.numero}`}
      className="max-w-none w-[90vw] h-[88vh] overflow-y-auto"
    >
      <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[minmax(0,1fr)] gap-6">
        {/* ========================================================================= */}
        {/* COLUMNA 1: FORMAS DE PAGO (col-span-3)                                   */}
        {/* ========================================================================= */}
        <div className="col-span-3 min-h-0 space-y-3 border-r border-border pr-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <label className="text-xs font-extrabold text-foreground uppercase tracking-wider">
                Forma de Cobro
              </label>
              <button
                type="button"
                onClick={() => setIsPagoMixto(!isPagoMixto)}
                className="text-[11px] font-bold text-primary hover:underline cursor-pointer flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded-md transition-colors"
              >
                {isPagoMixto ? "⬅️ Simple" : "🔀 Mixto"}
              </button>
            </div>

            {!isPagoMixto ? (
              /* Lista Vertical de Métodos de Pago */
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {metodosPago.map((m) => {
                  const isSelected = (metodoSeleccionadoId || metodosPago[0]?.id) === m.id;
                  const iconText = m.nombre.toLowerCase().includes("efectivo")
                    ? "💵"
                    : m.nombre.toLowerCase().includes("punto") || m.nombre.toLowerCase().includes("tarjeta")
                    ? "💳"
                    : m.nombre.toLowerCase().includes("zelle")
                    ? "⚡"
                    : m.nombre.toLowerCase().includes("móvil") || m.nombre.toLowerCase().includes("movil")
                    ? "📱"
                    : m.nombre.toLowerCase().includes("transf")
                    ? "🏦"
                    : "💰";

                  return (
                    <button
                      key={`metodo-btn-${m.id}`}
                      type="button"
                      onClick={() => handleSelectMetodoSimple(m)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30 shadow-xs font-bold"
                          : "border-border/80 bg-card hover:bg-muted/40 text-foreground hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${
                            isSelected
                              ? "bg-primary text-primary-foreground font-bold"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {iconText}
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-extrabold truncate leading-tight">
                            {m.nombre}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {m.moneda_codigo && (
                              <span className="text-[10px] font-mono opacity-80 leading-tight">
                                {m.moneda_codigo}
                              </span>
                            )}
                            {m.caja_nombre && (
                              <span className="text-[10px] text-muted-foreground truncate leading-tight">
                                • {m.caja_nombre}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Modo Mixto: Múltiples Líneas de Cobro */
              <div className="space-y-3 pt-1">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    Desglose de montos:
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] font-semibold"
                    onClick={() =>
                      setLineasPago((prev) => [
                        ...prev,
                        {
                          key: Date.now(),
                          metodoId: metodosPago[0]?.id ?? "",
                          cajaId: metodosPago[0]?.caja_id || (cajas[0]?.id ?? ""),
                          montoStr: "",
                        },
                      ])
                    }
                  >
                    <Plus size={12} /> Añadir
                  </Button>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {lineasPago.map((linea) => {
                    return (
                      <div
                        key={linea.key}
                        className="rounded-xl border border-border/70 bg-muted/30 p-2.5 space-y-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <select
                            value={linea.metodoId}
                            onChange={(e) => {
                              const val = e.target.value;
                              const selectedMet = metodosPago.find((m) => String(m.id) === String(val));
                              setLineasPago((prev) =>
                                prev.map((p) =>
                                  p.key === linea.key
                                    ? {
                                        ...p,
                                        metodoId: val,
                                        cajaId: selectedMet?.caja_id || p.cajaId,
                                      }
                                    : p
                                )
                              );
                            }}
                            className="h-9 min-w-0 flex-1 text-xs rounded-lg border border-border bg-card px-2"
                          >
                            {metodosPago.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.nombre} ({m.moneda_codigo || "USD"})
                              </option>
                            ))}
                          </select>

                          <Input
                            className="h-9 w-28 text-right font-mono text-xs font-bold"
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Monto"
                            value={linea.montoStr}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLineasPago((prev) =>
                                prev.map((p) => (p.key === linea.key ? { ...p, montoStr: v } : p))
                              );
                            }}
                          />

                          {lineasPago.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLineasPago((prev) => prev.filter((p) => p.key !== linea.key))
                              }
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition-colors"
                              title="Quitar línea"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>

                        {/* Caja selector for this mixed line */}
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="w-10">Caja:</span>
                          <select
                            value={linea.cajaId}
                            onChange={(e) =>
                              setLineasPago((prev) =>
                                prev.map((p) =>
                                  p.key === linea.key ? { ...p, cajaId: e.target.value } : p
                                )
                              )
                            }
                            className="h-7 flex-1 text-[11px] rounded border border-border/60 bg-background px-1.5"
                          >
                            <option value="">(Sin caja asignada)</option>
                            {cajas.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nombre}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMNA 2: DETALLES DE PAGO Y ACCIONES (col-span-4)                      */}
        {/* ========================================================================= */}
        <div className="col-span-4 min-h-0 space-y-4 border-r border-border pr-4 flex flex-col justify-between">
          <div className="space-y-4">
            {/* Monto Ingresado */}
            {!isPagoMixto ? (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-extrabold text-foreground uppercase tracking-wider">
                    Monto a Cobrar ({monedaSimpleObj?.codigo || "USD"})
                  </label>
                  <span className="text-[11px] text-muted-foreground italic">
                    Saldo: {saldoPendienteEnMonedaSimple} {monedaSimpleObj?.codigo}
                  </span>
                </div>
                <Input
                  className="h-14 text-right font-mono text-xl font-black border-2 border-primary/40 focus:border-primary shadow-xs"
                  type="number"
                  step="any"
                  min="0"
                  value={montoSimpleStr}
                  placeholder={saldoPendienteEnMonedaSimple.toString()}
                  onChange={(e) => setMontoSimpleStr(e.target.value)}
                />

                {/* Botones de porcentaje rápido */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => handleSetPorcentaje(0.25)}
                    className="text-xs font-bold py-1 px-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-center"
                  >
                    25%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPorcentaje(0.5)}
                    className="text-xs font-bold py-1 px-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-center"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPorcentaje(1.0)}
                    className="text-xs font-bold py-1 px-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary cursor-pointer transition-colors text-center"
                  >
                    100% (Total)
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1">
                <span className="text-xs font-bold text-muted-foreground">
                  Total abonado en moneda de la venta:
                </span>
                <p className="font-mono text-xl font-black text-primary">
                  {fmt(totalMontoEnMonedaCreditoMixto, monedaVenta.codigo)}
                </p>
              </div>
            )}

            {/* Selector de Caja de Entrada */}
            {!isPagoMixto && (
              <div>
                <label className="text-xs font-bold text-foreground">
                  Caja de Entrada (Ingreso de fondos)
                </label>
                <select
                  value={cajaSeleccionadaId}
                  onChange={(e) => setCajaSeleccionadaId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">(Sin ingreso automático a caja)</option>
                  {cajas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.saldo_actual ? `— Saldo: ${fmt(Number(c.saldo_actual), "USD")}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Fecha del Cobro */}
            <div>
              <label className="text-xs font-bold text-foreground">Fecha del Cobro</label>
              <Input
                type="date"
                className="mt-1 h-10 text-sm"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
              />
            </div>

            {/* Nota / Observación */}
            <div>
              <label className="text-xs font-bold text-foreground">
                Nota / Referencia (opcional)
              </label>
              <Input
                className="mt-1 h-10 text-sm"
                placeholder="Ej: Cobro en tienda, transf ref #9988..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </div>
          </div>

          {/* BOTONES PRINCIPALES DE ACCIÓN DIRECTA */}
          <div className="pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={submitting || loading || saldoPendienteEnMonedaCredito <= 0.009}
                onClick={() => handleProcesarPago(true)}
                className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center tracking-wide gap-1.5"
              >
                <CheckCircle2 size={18} />
                {submitting ? "Procesando..." : "Cobrar Completo"}
              </button>

              <button
                type="button"
                disabled={
                  submitting ||
                  loading ||
                  (isPagoMixto
                    ? totalMontoEnMonedaCreditoMixto <= 0
                    : !montoSimpleStr && saldoPendienteEnMonedaCredito <= 0.009)
                }
                onClick={() => handleProcesarPago(false)}
                className="w-full h-14 bg-sky-500 hover:bg-sky-600 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center tracking-wide gap-1.5"
              >
                <DollarSign size={18} />
                {submitting ? "Procesando..." : "Registrar Abono"}
              </button>
            </div>

            <Button
              variant="outline"
              className="w-full h-10 text-sm font-medium"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* COLUMNA 3: CLIENTE, RESUMEN Y HISTORIAL (col-span-5)                     */}
        {/* ========================================================================= */}
        <div className="col-span-5 min-h-0 overflow-y-auto pr-1 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            {/* Tarjeta Cliente */}
            <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <User size={16} />
                  </div>
                  <span className="text-xs font-black uppercase tracking-wider text-foreground">
                    Cliente
                  </span>
                </div>
                <Badge
                  variant="info"
                  label={creditoDetalle?.cliente_nombre || venta.cliente_nombre || venta.cliente || "Consumidor Final"}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <span className="text-muted-foreground">N° Venta:</span>{" "}
                  <span className="font-mono font-bold text-foreground">{venta.numero}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Fecha:</span>{" "}
                  <span className="font-medium text-foreground">{fmtDate(venta.fecha)}</span>
                </div>
                {creditoDetalle?.cliente_documento && (
                  <div>
                    <span className="text-muted-foreground">Documento:</span>{" "}
                    <span className="font-mono text-foreground">{creditoDetalle.cliente_documento}</span>
                  </div>
                )}
                {creditoDetalle?.cliente_telefono && (
                  <div>
                    <span className="text-muted-foreground">Teléfono:</span>{" "}
                    <span className="text-foreground">{creditoDetalle.cliente_telefono}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tarjeta Resumen Financiero */}
            <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-black uppercase tracking-wider text-foreground">
                  Estado Financiero
                </span>
                <span className="text-[11px] font-bold text-muted-foreground">
                  Moneda Venta: {monedaVenta.codigo}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Total Venta:</span>
                  <span className="font-mono font-bold text-foreground">
                    {fmt(venta.total, monedaVenta.codigo)}
                  </span>
                </div>

                {/* Saldo Pendiente Actual */}
                <div className="flex justify-between items-center p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30">
                  <span className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Deuda Pendiente Actual:
                  </span>
                  <span className="font-mono text-base font-black text-rose-600 dark:text-rose-400">
                    {fmt(saldoPendienteEnMonedaCredito, monedaVenta.codigo)}
                  </span>
                </div>

                {/* Nuevo Saldo Estimado */}
                {totalAbonoEnMonedaCredito > 0 && (
                  <div
                    className={`flex justify-between items-center p-2.5 rounded-lg border transition-all ${
                      quedaraPagado
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    <span className="text-xs font-bold">
                      {quedaraPagado ? "¡La deuda quedará totalmente pagada! 🎉" : "Deuda restante estimada:"}
                    </span>
                    <span className="font-mono text-sm font-black">
                      {quedaraPagado ? `0.00 ${monedaVenta.codigo}` : fmt(nuevoSaldoEnMonedaCredito, monedaVenta.codigo)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Historial de Abonos Previos */}
            <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <div className="flex items-center gap-1.5">
                  <History size={15} className="text-muted-foreground" />
                  <span className="text-xs font-black uppercase tracking-wider text-foreground">
                    Abonos Previos ({abonosPrevios.length})
                  </span>
                </div>
              </div>

              {abonosPrevios.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center italic">
                  Esta venta a crédito aún no registra abonos previos
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {abonosPrevios.map((ab) => (
                    <div
                      key={ab.id}
                      className="p-2 rounded-lg border border-border/60 bg-muted/20 text-xs flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{fmtDate(ab.fecha)}</span>
                          {ab.metodo_pago_nombre && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              {ab.metodo_pago_nombre}
                            </span>
                          )}
                        </div>
                        {ab.observaciones && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5">
                            {ab.observaciones}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-foreground">
                          {fmt(ab.monto, ab.moneda_codigo || monedaVenta.codigo)}
                        </span>
                        {ab.moneda_codigo && ab.moneda_codigo !== "USD" && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            ≈ {fmt(ab.monto_base, "USD")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
