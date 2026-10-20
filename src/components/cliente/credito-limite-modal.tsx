"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";
import { useReglasConversion } from "@/lib/use-reglas-conversion";
import type { MonedaConversion } from "@/lib/money";

export interface MonedaCredito {
  moneda_id: string;
  codigo: string;
  simbolo?: string;
  es_base?: boolean;
  decimales?: number;
  limite: number;
  deuda: number;
}

type Operacion = "add" | "remove";

interface CreditoLimiteModalProps {
  open: boolean;
  clienteId: string;
  clienteNombre: string;
  /** Monedas con su límite y deuda actual. */
  monedas: MonedaCredito[];
  /** Moneda preseleccionada (la de la fila desde la que se abrió). */
  monedaInicial?: string;
  /** Operación preseleccionada por los botones + / − de cada moneda. */
  operacionInicial?: Operacion;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function CreditoLimiteModal({
  open,
  clienteId,
  clienteNombre,
  monedas,
  monedaInicial,
  operacionInicial = "add",
  onClose,
  onSuccess,
}: CreditoLimiteModalProps) {
  const [monedaId, setMonedaId] = useState("");
  const [operacion, setOperacion] = useState<Operacion>("add");
  const [monto, setMonto] = useState("");
  const [catalogoMonedas, setCatalogoMonedas] = useState<MonedaConversion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { convertirProducto } = useReglasConversion(catalogoMonedas);

  useEffect(() => {
    if (open) {
      if (catalogoMonedas.length === 0) {
        fetch("/api/monedas")
          .then((r) => r.json())
          .then((data) => setCatalogoMonedas(Array.isArray(data) ? data : []))
          .catch(() => {});
      }
    }
  }, [open, catalogoMonedas.length]);

  useEffect(() => {
    if (open) {
      setMonedaId(monedaInicial || monedas[0]?.moneda_id || "");
      setOperacion(operacionInicial);
      setMonto("");
      setError("");
      setLoading(false);
    }
  }, [open, monedaInicial, operacionInicial, monedas]);

  const moneda = useMemo(
    () => monedas.find((m) => m.moneda_id === monedaId) ?? null,
    [monedas, monedaId]
  );

  const valor = parseFloat(monto) || 0;
  const limiteActual = moneda?.limite ?? 0;
  const nuevoLimite = operacion === "add" ? limiteActual + valor : Math.max(0, limiteActual - valor);
  const disponibleActual = limiteActual - (moneda?.deuda ?? 0);

  const handleMonedaChange = (nuevaMonedaId: string) => {
    if (nuevaMonedaId === monedaId) return;
    const num = parseFloat(monto.replace(",", "."));
    if (Number.isFinite(num) && num > 0) {
      const actualMon = catalogoMonedas.find((m) => String(m.id) === String(monedaId));
      const nuevaMon = catalogoMonedas.find((m) => String(m.id) === String(nuevaMonedaId));
      if (actualMon && nuevaMon) {
        const dec = Number(nuevaMon.decimales ?? 2);
        const conv = convertirProducto(num, actualMon, nuevaMon, "venta", dec);
        setMonto(String(conv));
      }
    }
    setMonedaId(nuevaMonedaId);
  };

  const submit = async () => {
    if (!moneda || valor <= 0) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/clientes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: clienteId,
          moneda_id: moneda.moneda_id,
          limite: nuevoLimite,
          // Añadir crédito también habilita al cliente: un límite > 0 no sirve
          // de nada si `recibe_credito` sigue en false (el POS lo bloquea).
          ...(operacion === "add" ? { recibe_credito: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al actualizar el crédito");

      onSuccess(
        operacion === "add"
          ? `Crédito añadido: límite de ${moneda.codigo} ahora en ${fmt(nuevoLimite, moneda.codigo)}`
          : `Crédito reducido: límite de ${moneda.codigo} ahora en ${fmt(nuevoLimite, moneda.codigo)}`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustar crédito"
      className="max-w-lg w-[90vw]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={loading || valor <= 0}
            className="flex-1"
          >
            <Check size={13} />
            {loading ? "Guardando..." : operacion === "add" ? "Añadir crédito" : "Quitar crédito"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">Cliente:</span>{" "}
        <span className="font-semibold">{clienteNombre}</span>
      </div>

      <Field label="Moneda">
        <Select value={monedaId} onChange={(e) => handleMonedaChange(e.target.value)}>
          {monedas.map((m) => (
            <option key={m.moneda_id} value={m.moneda_id}>
              {m.codigo}
              {m.es_base ? " (base)" : ""}
            </option>
          ))}
        </Select>
      </Field>

      {moneda && (
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Límite actual</span>
            <span className="font-mono font-semibold">{fmt(limiteActual, moneda.codigo)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Deuda</span>
            <span className="font-mono font-semibold text-danger">{fmt(moneda.deuda, moneda.codigo)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
            <span className="text-muted-foreground">Disponible</span>
            <span
              className={cn(
                "font-mono font-bold",
                disponibleActual > 0 ? "text-success-strong" : "text-muted-foreground"
              )}
            >
              {fmt(disponibleActual, moneda.codigo)}
            </span>
          </div>
        </div>
      )}

      {/* Operación: los botones + / − de cada moneda llegan con una ya elegida. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {(["add", "remove"] as const).map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => setOperacion(op)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              operacion === op
                ? op === "add"
                  ? "bg-card text-success-strong shadow-sm font-semibold"
                  : "bg-card text-danger shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {op === "add" ? <Plus size={13} /> : <Minus size={13} />}
            {op === "add" ? "Añadir" : "Quitar"}
          </button>
        ))}
      </div>

      <Field label={`Monto a ${operacion === "add" ? "añadir" : "quitar"}${moneda ? ` (${moneda.codigo})` : ""}`}>
        <Input
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          type="number"
          min={0}
          step="0.01"
          placeholder="0.00"
          autoFocus
        />
      </Field>

      {moneda && valor > 0 && (
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
            operacion === "add"
              ? "border-success-border/60 bg-success-soft/60"
              : "border-danger-border/60 bg-danger-soft/60"
          )}
        >
          <span className="text-muted-foreground">Nuevo límite</span>
          <span
            className={cn(
              "font-mono font-bold",
              operacion === "add" ? "text-success-strong" : "text-danger-strong"
            )}
          >
            {fmt(nuevoLimite, moneda.codigo)}
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        El crédito define cuánto puede deber el cliente en esta moneda. <strong>0</strong> significa que no
        puede comprar a crédito en esa moneda. Añadir crédito habilita al cliente automáticamente.
      </p>
    </Modal>
  );
}
