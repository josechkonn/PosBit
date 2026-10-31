"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { MetodoPagoSelect } from "@/components/ui/metodo-pago-select";
import { fmt, fechaLocalISO } from "@/lib/format";
import { decimalesDeMoneda, redondear, redondearSegunMoneda } from "@/lib/money";
import { useReglasConversion } from "@/lib/use-reglas-conversion";

interface Credito {
  id: string;
  numero: string;
  cliente_id: string;
  cliente_nombre: string;
  venta_numero: string | null;
  fecha: string;
  monto_total: number | string;
  saldo: number | string;
  abonado: number | string;
  estado: string;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
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
  decimales?: number;
  es_base: boolean;
}

interface AbonoModalProps {
  open: boolean;
  credito: Credito | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function AbonoModal({ open, credito, onClose, onSuccess }: AbonoModalProps) {
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [metodoPagoId, setMetodoPagoId] = useState<string>("");
  const [cajaId, setCajaId] = useState<string>("");
  const [observaciones, setObservaciones] = useState("");
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { reglas, convertirProducto } = useReglasConversion(monedas);

  useEffect(() => {
    if (open && credito) {
      const decInicial = decimalesDeMoneda(credito.moneda_codigo);
      const saldoInicial = redondear(parseFloat(String(credito.saldo ?? 0)), decInicial);
      setMonto(String(saldoInicial));
      setFecha(fechaLocalISO());
      setMetodoPagoId("");
      setCajaId("");
      setObservaciones("");
      setError("");
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
      if (monedas.length === 0) {
        fetch("/api/monedas")
          .then((r) => r.json())
          .then((data) => setMonedas(Array.isArray(data) ? data : []))
          .catch(() => {});
      }
    }
  }, [open, credito]); // eslint-disable-line react-hooks/exhaustive-deps

  const saldo = parseFloat(String(credito?.saldo ?? 0));

  const getSaldoEnMonedaAbono = () => {
    if (!monedaAbono || !monedaCredito || !credito) return null;
    if (monedaAbono.id === monedaCredito.id) return null;

    // saldo (moneda del crédito) → moneda del abono, con la cadena de conversiones y múltiplo de redondeo
    return convertirProducto(saldo, monedaCredito, monedaAbono, "venta", decimalesDeMoneda(monedaAbono));
  };

  const handleMetodoChange = (id: string) => {
    const metodoAnterior = metodosPago.find((m) => m.id === metodoPagoId);
    const metodoNuevo = metodosPago.find((m) => m.id === id);
    const mAnterior = metodoAnterior
      ? monedas.find((m) => m.id === metodoAnterior.moneda_id || m.codigo === metodoAnterior.moneda_codigo)
      : monedas.find((m) => m.id === credito?.moneda_id);
    const mNuevo = metodoNuevo
      ? monedas.find((m) => m.id === metodoNuevo.moneda_id || m.codigo === metodoNuevo.moneda_codigo)
      : monedas.find((m) => m.id === credito?.moneda_id);

    setMetodoPagoId(id);
    setCajaId(metodoNuevo?.caja_id ? String(metodoNuevo.caja_id) : "");

    const val = parseFloat(monto.replace(",", "."));
    if (credito && monedas.length > 0 && mNuevo) {
      const mCredito = monedas.find((m) => m.id === credito.moneda_id) ?? mNuevo;
      const decNuevo = decimalesDeMoneda(mNuevo);
      const decAnt = decimalesDeMoneda(mAnterior);
      const multiploAnt =
        decAnt === 0 && reglas.redondeo?.activo && Number(reglas.redondeo?.multiplo) > 0
          ? Number(reglas.redondeo.multiplo)
          : 0;
      const tolAnt = multiploAnt > 0 ? Math.max(0.5, multiploAnt / 2) : decAnt === 0 ? 0.5 : 0.05;
      const saldoEnAnt =
        mAnterior && mAnterior.id !== mCredito.id
          ? convertirProducto(saldo, mCredito, mAnterior, "venta", decAnt)
          : redondear(saldo, decAnt);

      // Si el usuario tenía el saldo total en la moneda anterior (o vacío), al cambiar método se pone el saldo total en la nueva moneda
      if (!val || val <= 0 || Math.abs(val - saldoEnAnt) <= tolAnt) {
        const nuevoSaldoConv =
          mNuevo.id === mCredito.id
            ? redondearSegunMoneda(saldo, mNuevo, reglas.redondeo, decNuevo)
            : convertirProducto(saldo, mCredito, mNuevo, "venta", decNuevo);
        setMonto(String(nuevoSaldoConv));
      } else if (mAnterior && mAnterior.id !== mNuevo.id) {
        setMonto(String(convertirProducto(val, mAnterior, mNuevo, "venta", decNuevo)));
      }
    }
  };

  const metodoSeleccionado = metodosPago.find(m => m.id === metodoPagoId);
  const monedaAbono = monedas.find(m => m.id === metodoSeleccionado?.moneda_id || m.codigo === metodoSeleccionado?.moneda_codigo);
  const monedaCredito = monedas.find(m => m.id === credito?.moneda_id);

  const saldoEnMonedaAbono = getSaldoEnMonedaAbono();
  const decActiva = decimalesDeMoneda(monedaAbono ?? credito?.moneda_codigo);
  const multiploActivo =
    decActiva === 0 && reglas.redondeo?.activo && Number(reglas.redondeo?.multiplo) > 0
      ? Number(reglas.redondeo.multiplo)
      : 0;
  const tolActiva = multiploActivo > 0 ? Math.max(0.5, multiploActivo / 2) : decActiva === 0 ? 0.5 : 0.05;

  const getEquivalente = () => {
    if (!monto || !monedaAbono || !monedaCredito || !credito) return null;
    const val = parseFloat(monto);
    if (isNaN(val) || val <= 0) return null;
    
    if (monedaAbono.id === monedaCredito.id) return null; // Misma moneda

    if (saldoEnMonedaAbono !== null && Math.abs(val - saldoEnMonedaAbono) <= tolActiva) {
      return redondear(saldo, decimalesDeMoneda(monedaCredito));
    }

    // monto del abono → moneda del crédito (misma cadena que en el backend)
    return convertirProducto(val, monedaAbono, monedaCredito, "venta", decimalesDeMoneda(monedaCredito));
  };

  const equivalente = getEquivalente();
  const montoMaxPermitido = (saldoEnMonedaAbono !== null ? saldoEnMonedaAbono : saldo) + tolActiva;

  const handleSubmit = async () => {
    if (!credito) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/creditos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credito_id: credito.id,
          monto: parseFloat(monto),
          fecha,
          moneda_id: monedaAbono?.id || credito.moneda_id,
          metodo_pago_id: metodoPagoId || null,
          caja_id: cajaId || null,
          observaciones: observaciones || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al registrar abono");
      onSuccess(`Abono de ${fmt(monto, monedaAbono?.codigo || credito.moneda_codigo)} registrado correctamente`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  if (!credito) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Abonar a Crédito ${credito.numero}`}
      className="max-w-lg w-[90vw]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || !parseFloat(monto) || parseFloat(monto) <= 0 || parseFloat(monto) > montoMaxPermitido}
            className="flex-1"
          >
            {loading ? "Registrando..." : "Registrar Abono"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm space-y-1">
        <p>
          <span className="text-muted-foreground">Cliente:</span>{" "}
          <span className="font-semibold">{credito.cliente_nombre}</span>
        </p>
        {credito.venta_numero && (
          <p>
            <span className="text-muted-foreground">Venta:</span>{" "}
            <span className="font-mono">{credito.venta_numero}</span>
          </p>
        )}
        <p>
          <span className="text-muted-foreground">Saldo pendiente:</span>{" "}
          <span className="font-mono font-semibold text-danger">{fmt(saldo, credito.moneda_codigo)}</span>
          {saldoEnMonedaAbono !== null && monedaAbono && (
            <span className="ml-2 font-mono text-xs font-semibold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              ≈ {fmt(saldoEnMonedaAbono, monedaAbono.codigo)}
            </span>
          )}
        </p>
      </div>

      <div className="space-y-4 pt-1">
        <Field label={`Monto a Abonar (${monedaAbono ? monedaAbono.simbolo : credito.moneda_simbolo})`}>
          <Input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            type="number"
            min={0}
            step={decActiva === 0 ? (multiploActivo > 0 ? String(multiploActivo) : "1") : "0.01"}
            placeholder={decActiva === 0 ? "0" : "Monto del abono"}
          />
          {equivalente !== null && (
            <div className="text-xs text-muted-foreground mt-1">
              Equivale a descontar <strong>{fmt(equivalente, credito.moneda_codigo)}</strong> de la deuda.
            </div>
          )}
        </Field>
        <Field label="Fecha">
          <Input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" />
        </Field>
        <Field label="Método de pago (opcional)">
          <MetodoPagoSelect
            metodos={metodosPago}
            value={metodoPagoId || null}
            onChange={(id) => handleMetodoChange(id === null ? "" : String(id))}
            allowEmptyLabel="Sin método de pago"
            placeholder="Sin método de pago"
            className="w-full"
          />
        </Field>
        <Field label="Observaciones">
          <textarea
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Notas del abono..."
            rows={2}
            maxLength={500}
          />
        </Field>
      </div>
    </Modal>
  );
}
