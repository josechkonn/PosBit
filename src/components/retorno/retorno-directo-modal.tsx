"use client";

import { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmt } from "@/lib/format";

interface ItemOriginal {
  producto_id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  precio_unit?: number | string;
  precio_unit_base?: number | string;
  costo_unit?: number | string;
  costo_unit_base?: number | string;
  subtotal?: number | string;
}

interface RetornoDirectoModalProps {
  open: boolean;
  tipo: "Cliente" | "Proveedor";
  referenciaId: number | null;
  referenciaNumero: string;
  clienteId?: number | null;
  proveedorId?: number | null;
  tipoPago?: string | null;
  items: ItemOriginal[];
  monedaCodigo?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

interface ItemRetorno {
  producto_id: number;
  cantidad: number;
  seleccionado: boolean;
}

export function RetornoDirectoModal({
  open,
  tipo,
  referenciaId,
  referenciaNumero,
  clienteId,
  proveedorId,
  tipoPago,
  items,
  monedaCodigo,
  onClose,
  onSuccess,
}: RetornoDirectoModalProps) {
  const [itemsRetorno, setItemsRetorno] = useState<ItemRetorno[]>([]);
  const [abonarCredito, setAbonarCredito] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const esCliente = tipo === "Cliente";
  const esCredito = tipoPago === "Credito";

  useEffect(() => {
    if (open && items.length > 0) {
      setItemsRetorno(
        items.map((item) => ({
          producto_id: item.producto_id,
          cantidad: 0,
          seleccionado: false,
        }))
      );
      setAbonarCredito(true);
      setMotivo("");
      setError("");
    }
  }, [open, items]);

  const toggleItem = (productoId: number) => {
    setItemsRetorno((prev) =>
      prev.map((item) => {
        if (item.producto_id === productoId) {
          const seleccionado = !item.seleccionado;
          const original = items.find((i) => i.producto_id === productoId);
          return {
            ...item,
            seleccionado,
            cantidad: seleccionado ? (original?.cantidad || 1) : 0,
          };
        }
        return item;
      })
    );
  };

  const updateCantidad = (productoId: number, cant: number) => {
    const original = items.find((i) => i.producto_id === productoId);
    const max = original?.cantidad || 1;
    const clamped = Math.max(0, Math.min(cant, max));
    setItemsRetorno((prev) =>
      prev.map((item) =>
        item.producto_id === productoId
          ? { ...item, cantidad: clamped, seleccionado: clamped > 0 }
          : item
      )
    );
  };

  const itemsSeleccionados = itemsRetorno.filter((i) => i.seleccionado && i.cantidad > 0);

  // Precio unitario en la moneda del documento (venta o compra)
  const precioDe = (item: ItemOriginal) => {
    const precioDoc = esCliente ? item.precio_unit : item.costo_unit;
    const precioBase = esCliente ? item.precio_unit_base : item.costo_unit_base;
    return (
      parseFloat(String(precioDoc ?? precioBase ?? 0)) || parseFloat(String(precioBase || 0))
    );
  };

  const totalSeleccionado = itemsSeleccionados.reduce((s, i) => {
    const original = items.find((x) => x.producto_id === i.producto_id);
    return s + (original ? precioDe(original) * i.cantidad : 0);
  }, 0);

  const handleSubmit = async () => {
    if (itemsSeleccionados.length === 0) return;
    setLoading(true);
    setError("");

    try {
      const body: any = {
        tipo,
        fecha: new Date().toISOString().split("T")[0],
        motivo: motivo || null,
        items: itemsSeleccionados.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
        })),
      };

      if (esCliente) {
        body.venta_id = referenciaId;
        body.cliente_id = clienteId || null;
        body.abonar_credito = esCredito ? abonarCredito : false;
      } else {
        body.compra_id = referenciaId;
        body.proveedor_id = proveedorId || null;
      }

      const res = await fetch("/api/retornos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al registrar retorno");

      const totalItems = itemsSeleccionados.reduce((s, i) => s + i.cantidad, 0);
      const montoMsg =
        data?.total_moneda !== undefined && data?.total_moneda !== null
          ? ` — ${fmt(data.total_moneda, data.moneda_codigo || monedaCodigo || "USD")}`
          : "";
      onSuccess(
        esCliente
          ? `Retorno de ${totalItems} unidad(es) registrado para ${referenciaNumero}${montoMsg}`
          : `Devolución de ${totalItems} unidad(es) registrada para ${referenciaNumero}${montoMsg}`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  if (!referenciaId || items.length === 0) return null;

  const titulo = esCliente
    ? `Retornar productos — ${referenciaNumero}`
    : `Devolver productos — ${referenciaNumero}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      className="max-w-2xl w-[90vw]"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || itemsSeleccionados.length === 0}
            className="flex-1"
          >
            <RotateCcw size={13} />
            {loading
              ? "Procesando..."
              : esCliente
                ? `Registrar Retorno (${itemsSeleccionados.length})`
                : `Registrar Devolución (${itemsSeleccionados.length})`}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm space-y-0.5 mb-4">
        <p>
          <span className="text-muted-foreground">{esCliente ? "Venta" : "Compra"}:</span>{" "}
          <span className="font-mono font-semibold">{referenciaNumero}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {esCliente
            ? "Selecciona los productos que el cliente devuelve. Las existencias se incrementarán."
            : "Selecciona los productos a devolver al proveedor. Las existencias se reducirán."}
        </p>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const retorno = itemsRetorno.find((r) => r.producto_id === item.producto_id);
          const seleccionado = retorno?.seleccionado || false;
          const cantRetorno = retorno?.cantidad || 0;
          const precioUnit = precioDe(item);

          return (
            <div
              key={item.producto_id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                seleccionado
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/60 bg-background hover:border-border"
              }`}
              onClick={() => toggleItem(item.producto_id)}
            >
              <input
                type="checkbox"
                checked={seleccionado}
                onChange={() => toggleItem(item.producto_id)}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded border-border accent-primary flex-shrink-0"
              />

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {item.producto_nombre}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{item.producto_codigo}</span>
                  <span>·</span>
                  <span>
                    {esCliente ? "Vendido" : "Comprado"}: <strong>{item.cantidad}</strong>
                  </span>
                  {precioUnit > 0 && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{fmt(precioUnit, monedaCodigo || "USD")} c/u</span>
                    </>
                  )}
                </div>
              </div>

              {seleccionado && (
                <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-muted-foreground">Cant:</span>
                  <Input
                    value={cantRetorno}
                    onChange={(e) => updateCantidad(item.producto_id, parseInt(e.target.value, 10) || 0)}
                    type="number"
                    min={1}
                    max={item.cantidad}
                    className="w-16 text-center text-sm h-8"
                  />
                  <span className="text-xs text-muted-foreground">/ {item.cantidad}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {itemsSeleccionados.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            Total a devolver ({itemsSeleccionados.length} ítem{itemsSeleccionados.length === 1 ? "" : "s"})
          </span>
          <span className="font-mono font-semibold text-primary">
            {fmt(totalSeleccionado, monedaCodigo || "USD")}
          </span>
        </div>
      )}

      {esCliente && esCredito && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="text-sm">
            <span className="font-medium">Abonar al crédito de la venta</span>
            <p className="text-xs text-muted-foreground">Descuenta el monto devuelto de la deuda del cliente</p>
          </div>
          <Switch checked={abonarCredito} onCheckedChange={setAbonarCredito} />
        </div>
      )}

      <div className="mt-4">
        <Field label="Motivo (opcional)">
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: producto dañado, error en cantidad..."
            maxLength={500}
          />
        </Field>
      </div>
    </Modal>
  );
}
