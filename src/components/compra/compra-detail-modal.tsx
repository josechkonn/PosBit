"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Package, Calendar, Truck, CreditCard, Hash, FileText } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Table, Td, Tr } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";

interface CompraItem {
  id: string;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  costo_unit: number | string;
  costo_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
}

interface CompraDetail {
  id: string;
  numero: string;
  proveedor_nombre: string;
  fecha: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  subtotal: number | string;
  total: number | string;
  total_base: number | string;
  tasa?: number | string | null;
  estado: string;
  observaciones: string | null;
  referencia: string | null;
  items_count: number | string;
}

interface CompraDetailModalProps {
  open: boolean;
  compra: CompraDetail | null;
  items: CompraItem[];
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export function CompraDetailModal({ open, compra, items, onClose, onDelete }: CompraDetailModalProps) {
  const confirm = useConfirm();
  if (!compra) return null;

  const compraItems = items.filter((i) => true); // already filtered by parent

  return (
    <Modal open={open} onClose={onClose} title={`Compra ${compra.numero}`} className="max-w-4xl">
      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <InfoRow icon={Truck} label="Proveedor" value={compra.proveedor_nombre} />
        <InfoRow icon={Calendar} label="Fecha" value={fmtDate(compra.fecha)} />
        <InfoRow icon={CreditCard} label="Método de Pago" value={compra.metodo_pago_nombre || "—"} />
        <InfoRow icon={Hash} label="Caja" value={compra.caja_nombre || "—"} />
        <InfoRow icon={FileText} label="Referencia" value={compra.referencia || "—"} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Estado:</span>
          <StatusBadge status={compra.estado} />
        </div>
      </div>

      {compra.observaciones && (
        <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Observaciones:</span> {compra.observaciones}
        </div>
      )}

      {/* Items table */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Package size={14} /> Ítems ({compraItems.length})
        </h4>
        <Table headers={["Código", "Producto", "Cantidad", "Costo Unit.", "Subtotal"]}>
          {compraItems.map((item) => (
            <Tr key={item.id}>
              <Td mono>{item.producto_codigo}</Td>
              <Td>{item.producto_nombre}</Td>
              <Td>
                <span className="font-mono font-semibold">{item.cantidad}</span>
              </Td>
              <Td>
                <span className="font-mono">{fmt(item.costo_unit, compra.moneda_codigo)}</span>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{fmt(item.subtotal, compra.moneda_codigo)}</span>
              </Td>
            </Tr>
          ))}
        </Table>
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-72 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono font-semibold">{fmt(compra.subtotal, compra.moneda_codigo)}</span>
          </div>
          <div className="border-t border-border/60 pt-1.5 flex justify-between text-sm font-bold">
            <span>Total</span>
            <span className="font-mono text-primary">{fmt(compra.total, compra.moneda_codigo)}</span>
          </div>
          {compra.moneda_codigo !== "USD" && compra.tasa != null && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tasa aplicada</span>
              <span className="font-mono">
                {parseFloat(String(compra.tasa)).toFixed(4)} {compra.moneda_codigo}
              </span>
            </div>
          )}
          {compra.moneda_codigo !== "USD" && (
            <div className="flex justify-between text-xs text-muted-foreground pt-0.5">
              <span>Total base (USD)</span>
              <span className="font-mono">{fmt(compra.total_base, "USD")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Delete action */}
      {onDelete && (
        <div className="mt-6 flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await confirm({
                title: "Eliminar Compra",
                message: `¿Eliminar la compra ${compra.numero}? Esto revertirá las existencias.`,
                variant: "destructive"
              })) {
                onDelete(compra.id);
              }
            }}
          >
            Eliminar Compra
          </Button>
        </div>
      )}
    </Modal>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} className="text-muted-foreground/60 flex-shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground truncate">{value}</span>
    </div>
  );
}
