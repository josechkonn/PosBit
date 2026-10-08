"use client";

import { Modal } from "@/components/ui/modal";
import { Table, Td, Tr } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";
import { Calendar, CreditCard, Hash, Package, User } from "lucide-react";

interface VentaItem {
  id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  precio_unit: number | string;
  precio_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
}

interface VentaDetail {
  id: number;
  numero: string;
  cliente: string | null;
  cliente_nombre: string | null;
  tipo_pago: string | null;
  fecha: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  subtotal: number | string;
  impuesto: number | string;
  total: number | string;
  total_base: number | string;
  tasa?: number | string | null;
  estado: string;
  observaciones: string | null;
}

interface VentaDetailModalProps {
  open: boolean;
  venta: VentaDetail | null;
  items: VentaItem[];
  onClose: () => void;
  onDelete?: (id: number) => void;
}

export function VentaDetailModal({ open, venta, items, onClose, onDelete }: VentaDetailModalProps) {
  const confirm = useConfirm();
  
  if (!venta) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Venta ${venta.numero}`} className="max-w-4xl">
      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <InfoRow
          icon={User}
          label="Cliente"
          value={venta.cliente_nombre || venta.cliente || "Consumidor Final"}
        />
        <InfoRow icon={Calendar} label="Fecha" value={fmtDate(venta.fecha)} />
        <InfoRow icon={CreditCard} label="Método de Pago" value={venta.metodo_pago_nombre || "—"} />
        <InfoRow icon={Hash} label="Caja" value={venta.caja_nombre || "—"} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Forma de pago:</span>
          <StatusBadge status={venta.tipo_pago === "Credito" ? "Crédito" : "Contado"} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Estado:</span>
          <StatusBadge status={venta.estado} />
        </div>
      </div>

      {venta.observaciones && (
        <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Observaciones:</span> {venta.observaciones}
        </div>
      )}

      {/* Items table */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Package size={14} /> Ítems ({items.length})
        </h4>
        <Table headers={["Código", "Producto", "Cantidad", "Precio Unit.", "Subtotal"]}>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td mono>{item.producto_codigo}</Td>
              <Td>{item.producto_nombre}</Td>
              <Td>
                <span className="font-mono font-semibold">{item.cantidad}</span>
              </Td>
              <Td>
                <span className="font-mono">{fmt(item.precio_unit, venta.moneda_codigo)}</span>
              </Td>
              <Td>
                <span className="font-mono font-semibold">{fmt(item.subtotal, venta.moneda_codigo)}</span>
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
            <span className="font-mono font-semibold">{fmt(venta.subtotal, venta.moneda_codigo)}</span>
          </div>
          {parseFloat(String(venta.impuesto)) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">IVA (16%)</span>
              <span className="font-mono">{fmt(venta.impuesto, venta.moneda_codigo)}</span>
            </div>
          )}
          <div className="border-t border-border/60 pt-1.5 flex justify-between text-sm font-bold">
            <span>Total</span>
            <span className="font-mono text-primary">{fmt(venta.total, venta.moneda_codigo)}</span>
          </div>
          {venta.moneda_codigo !== "USD" && venta.tasa != null && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Tasa aplicada</span>
              <span className="font-mono">
                {parseFloat(String(venta.tasa)).toFixed(4)} {venta.moneda_codigo}
              </span>
            </div>
          )}
          {venta.moneda_codigo !== "USD" && (
            <div className="flex justify-between text-xs text-muted-foreground pt-0.5">
              <span>Total base (USD)</span>
              <span className="font-mono">{fmt(venta.total_base, "USD")}</span>
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
                title: "Anular Venta",
                message: `¿Anular/eliminar la venta ${venta.numero}? Esto repondrá las existencias.`,
                variant: "destructive"
              })) {
                onDelete(venta.id);
              }
            }}
          >
            Eliminar Venta
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
