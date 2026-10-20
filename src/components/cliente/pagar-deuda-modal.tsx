"use client";

import { useEffect, useMemo, useState } from "react";
import { HandCoins, ReceiptText } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { MetodoPagoSelect } from "@/components/ui/metodo-pago-select";
import { fmt, fechaLocalISO } from "@/lib/format";
import { useReglasConversion } from "@/lib/use-reglas-conversion";
import { cn } from "@/lib/utils";

export interface DeudaMoneda {
  moneda_id: string;
  codigo: string;
  deuda: number;
}

export interface CreditoPendiente {
  id: string;
  numero: string;
  fecha: string;
  saldo: number | string;
  moneda_id: string;
  moneda_codigo: string;
}

interface MetodoPago {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: string | null;
  moneda_codigo: string;
  moneda_id?: string;
  activo?: boolean;
}

interface Moneda {
  id: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: string | null;
  usa_tasa_usd_directa?: boolean | null;
  tasa_usd_directa?: number | string | null;
  decimales?: number;
  es_base: boolean;
}

interface PagarDeudaModalProps {
  open: boolean;
  clienteId: string;
  clienteNombre: string;
  /** Deuda actual por moneda (para el resumen). */
  deudas: DeudaMoneda[];
  /** Facturas pendientes del cliente (saldo > 0). */
  creditos: CreditoPendiente[];
  /** Moneda preseleccionada (la de la fila desde la que se abrió). */
  monedaInicial?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

type EstadoPreview = "completa" | "parcial" | "pendiente";

interface LineaPreview {
  credito: CreditoPendiente;
  estado: EstadoPreview;
  monto: number;
}

export function PagarDeudaModal({
  open,
  clienteId,
  clienteNombre,
  deudas,
  creditos,
  monedaInicial,
  onClose,
  onSuccess,
}: PagarDeudaModalProps) {
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [monedaId, setMonedaId] = useState("");
  const [metodoPagoId, setMetodoPagoId] = useState("");
  const [cajaId, setCajaId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { convertirProducto } = useReglasConversion(monedas);

  useEffect(() => {
    if (open) {
      setMonto("");
      setFecha(fechaLocalISO());
      setMetodoPagoId("");
      setCajaId("");
      setObservaciones("");
      setError("");
      setLoading(false);
      if (monedas.length === 0) {
        fetch("/api/monedas")
          .then((r) => r.json())
          .then((data) => setMonedas(Array.isArray(data) ? data : []))
          .catch(() => {});
      }
      if (metodosPago.length === 0) {
        fetch("/api/metodos-pago")
          .then((r) => r.json())
          .then((data) => {
            const active = (Array.isArray(data) ? data : []).filter(
              (m: MetodoPago) => m.activo !== false && m.caja_id
            );
            setMetodosPago(active);
          })
          .catch(() => {});
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Método de pago y moneda preseleccionados una vez cargados catálogo y métodos
  useEffect(() => {
    if (open && metodosPago.length > 0 && !metodoPagoId) {
      const inicial =
        metodosPago.find((mp) => mp.moneda_id === monedaInicial) ??
        metodosPago.find((mp) => {
          const m = monedas.find((x) => x.id === mp.moneda_id || x.codigo === mp.moneda_codigo);
          return m?.es_base;
        }) ??
        metodosPago[0];

      if (inicial) {
        setMetodoPagoId(String(inicial.id));
        setCajaId(inicial.caja_id ? String(inicial.caja_id) : "");
        const mObj = monedas.find((m) => m.id === inicial.moneda_id || m.codigo === inicial.moneda_codigo);
        if (mObj) {
          setMonedaId(mObj.id);
        }
      }
    }
  }, [open, metodosPago, metodoPagoId, monedaInicial, monedas]);

  const valor = parseFloat(monto) || 0;
  const metodoSeleccionado = metodosPago.find((m) => m.id === metodoPagoId);
  const monedaPago =
    monedas.find((m) => m.id === metodoSeleccionado?.moneda_id || m.codigo === metodoSeleccionado?.moneda_codigo) ??
    monedas.find((m) => m.id === monedaId) ??
    monedas.find((m) => m.es_base) ??
    monedas[0];
  const baseMoneda = monedas.find((m) => m.es_base) ?? monedas[0];

  // Las deudas se pagan desde la factura más antigua (mismo orden que el backend).
  const pendientesFifo = useMemo(
    () =>
      [...creditos].sort((a, b) =>
        a.fecha === b.fecha ? b.id.localeCompare(a.id) : a.fecha < b.fecha ? -1 : 1
      ),
    [creditos]
  );

  const preview = useMemo<{ lineas: LineaPreview[]; restoBase: number }>(() => {
    const lineas: LineaPreview[] = [];
    if (!monedaPago || !baseMoneda || valor <= 0 || pendientesFifo.length === 0) {
      return {
        lineas: pendientesFifo.map((c) => ({ credito: c, estado: "pendiente", monto: 0 })),
        restoBase: 0,
      };
    }
    let pool = convertirProducto(valor, monedaPago, baseMoneda, "venta", 6);
    for (const c of pendientesFifo) {
      const mCredito = monedas.find((m) => m.id === c.moneda_id) ?? baseMoneda;
      const saldo = Number(c.saldo);
      const saldoBase = convertirProducto(saldo, mCredito, baseMoneda, "venta", 6);
      if (pool <= 0.0005) {
        lineas.push({ credito: c, estado: "pendiente", monto: 0 });
        continue;
      }
      const takeBase = Math.min(pool, saldoBase);
      const take = saldoBase > 0 ? (takeBase * saldo) / saldoBase : saldo;
      const takeFinal = Math.min(take, saldo);
      pool -= takeBase;
      lineas.push({
        credito: c,
        estado: takeBase >= saldoBase - 0.005 ? "completa" : "parcial",
        monto: takeFinal,
      });
    }
    return { lineas, restoBase: pool > 0 ? pool : 0 };
  }, [monedaPago, baseMoneda, valor, pendientesFifo, monedas, convertirProducto]);

  const deudaTotalBase = useMemo(
    () =>
      pendientesFifo.reduce((s, c) => {
        const mCredito = monedas.find((m) => m.id === c.moneda_id) ?? baseMoneda;
        return s + (monedas.length > 0 ? convertirProducto(Number(c.saldo), mCredito, baseMoneda, "venta", 6) : Number(c.saldo));
      }, 0),
    [pendientesFifo, monedas, baseMoneda, convertirProducto]
  );

  const comoBase =
    monedaPago && baseMoneda && valor > 0 && String(monedaPago.id) !== String(baseMoneda.id)
      ? convertirProducto(valor, monedaPago, baseMoneda, "venta", 2)
      : null;

  const handleMetodoChange = (id: string) => {
    const metodoAnterior = metodosPago.find((m) => m.id === metodoPagoId);
    const metodoNuevo = metodosPago.find((m) => m.id === id);
    const mAnterior = metodoAnterior
      ? monedas.find((m) => m.id === metodoAnterior.moneda_id || m.codigo === metodoAnterior.moneda_codigo)
      : monedaPago;
    const mNuevo = metodoNuevo
      ? monedas.find((m) => m.id === metodoNuevo.moneda_id || m.codigo === metodoNuevo.moneda_codigo)
      : undefined;

    setMetodoPagoId(id);
    setCajaId(metodoNuevo?.caja_id ? String(metodoNuevo.caja_id) : "");

    if (mNuevo) {
      setMonedaId(mNuevo.id);
      const num = parseFloat(monto.replace(",", "."));
      if (Number.isFinite(num) && num > 0 && mAnterior && mAnterior.id !== mNuevo.id) {
        const dec = Number(mNuevo.decimales ?? 2);
        const convertido = convertirProducto(num, mAnterior, mNuevo, "venta", dec);
        setMonto(String(convertido));
      }
    }
  };

  /** Rellena el monto con la deuda total, expresada en la moneda seleccionada. */
  const rellenarTotal = () => {
    if (!monedaPago || !baseMoneda || deudaTotalBase <= 0) return;
    const dec = Number(monedaPago.decimales ?? 2);
    const totalEnMoneda = convertirProducto(deudaTotalBase, baseMoneda, monedaPago, "venta", dec);
    setMonto(String(totalEnMoneda));
  };

  const submit = async () => {
    if (!monedaPago || valor <= 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/creditos/pagar-deuda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          monto: valor,
          moneda_id: monedaPago.id,
          fecha,
          metodo_pago_id: metodoPagoId || null,
          caja_id: cajaId || null,
          observaciones: observaciones || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al aplicar el pago");

      const completadas = data.creditos_completados ?? 0;
      const aplicadas = Array.isArray(data?.aplicado) ? data.aplicado.length : 0;
      let msg = `Pago aplicado a ${aplicadas} factura(s)`;
      if (completadas > 0) msg += `, ${completadas} saldada(s)`;
      if ((data.sobrante_base ?? 0) > 0.005 && baseMoneda) {
        msg += `. Sobrante no aplicado: ${fmt(data.sobrante_base, baseMoneda.codigo)}`;
      }
      onSuccess(msg);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const deudasActivas = deudas.filter((d) => d.deuda > 0.005);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pagar deuda"
      className="w-[92vw] max-w-xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="hidden text-sm sm:block">
            {valor > 0 && monedaPago ? (
              <span className="text-muted-foreground">
                Aplicar{" "}
                <strong className="font-mono font-semibold text-foreground">
                  {fmt(valor, monedaPago.codigo)}
                </strong>
              </span>
            ) : (
              <span className="text-muted-foreground">Ingresa un monto</span>
            )}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="flex-1 sm:flex-none"
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={loading || valor <= 0 || !monedaPago}
              className="flex-1 sm:flex-none"
            >
              <HandCoins size={15} />
              {loading ? "Aplicando..." : "Aplicar pago"}
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Resumen del cliente */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <ReceiptText size={13} /> Deuda total
            </div>
            <div className="mt-1 font-mono text-2xl font-bold leading-none text-foreground">
              {fmt(deudaTotalBase, baseMoneda?.codigo ?? "USD")}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {pendientesFifo.length} factura{pendientesFifo.length === 1 ? "" : "s"} pendiente
              {pendientesFifo.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold text-foreground">{clienteNombre}</div>
            <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
              {deudasActivas.length === 0 ? (
                <span className="text-xs font-medium text-success-strong">Sin deuda pendiente</span>
              ) : (
                deudasActivas.map((d) => (
                  <span
                    key={d.moneda_id}
                    className="rounded-full bg-danger/10 px-2 py-0.5 font-mono text-xs font-semibold text-danger"
                  >
                    {fmt(d.deuda, d.codigo)}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Método de pago + Fecha */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Método de pago">
          <MetodoPagoSelect
            metodos={metodosPago}
            value={metodoPagoId || null}
            onChange={(id) => handleMetodoChange(id === null ? "" : String(id))}
            placeholder="Seleccionar método de pago"
            className="w-full"
          />
        </Field>
        <Field label="Fecha">
          <Input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" />
        </Field>
      </div>

      {/* Monto a pagar */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            Monto a pagar {monedaPago ? `(${monedaPago.codigo})` : ""}
          </span>
          <button
            type="button"
            onClick={rellenarTotal}
            disabled={!monedaPago || deudaTotalBase <= 0}
            className="text-xs font-semibold text-primary transition-colors hover:text-primary-600 disabled:pointer-events-none disabled:opacity-40"
          >
            Pagar todo
          </button>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-muted-foreground">
            {monedaPago?.codigo ?? ""}
          </span>
          <Input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            autoFocus
            className="pl-14 font-mono text-base font-semibold"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {comoBase !== null && baseMoneda ? (
            <>
              Equivale a <strong>{fmt(comoBase, baseMoneda.codigo)}</strong> · se reparte entre las
              facturas automáticamente
            </>
          ) : (
            "Se reparte automáticamente entre las facturas más antiguas."
          )}
        </p>
      </div>

      {/* Observaciones */}
      <Field label="Observaciones (opcional)">
        <textarea
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Notas del pago..."
          rows={2}
          maxLength={500}
        />
      </Field>

      {/* Facturas pendientes + preview de cobertura */}
      {pendientesFifo.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Facturas pendientes
            </span>
            <span className="text-[11px] text-muted-foreground">Más antigua primero</span>
          </div>
          <div className="max-h-44 divide-y divide-border/40 overflow-y-auto">
            {preview.lineas.map(({ credito, estado, monto: montoAplicado }) => (
              <div key={credito.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold text-foreground">
                      {credito.numero}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmtDate(credito.fecha)}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
                  {fmt(credito.saldo, credito.moneda_codigo)}
                </span>
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    estado === "completa" && "bg-success-soft text-success-strong",
                    estado === "parcial" && "bg-amber-500/10 text-amber-600",
                    estado === "pendiente" && "bg-muted text-muted-foreground"
                  )}
                >
                  {estado === "completa"
                    ? "Se paga"
                    : estado === "parcial"
                      ? `Abona ${fmt(montoAplicado, credito.moneda_codigo)}`
                      : "Pendiente"}
                </span>
              </div>
            ))}
          </div>
          {preview.restoBase > 0 && baseMoneda && (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-4 py-2 text-xs">
              <span className="text-muted-foreground">Resto sin aplicar</span>
              <strong className="font-mono text-foreground">
                {fmt(preview.restoBase, baseMoneda.codigo)}
              </strong>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function fmtDate(iso: string) {
  const d = iso ? new Date(`${iso}T00:00:00`) : null;
  if (!d || isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("es-BO");
}