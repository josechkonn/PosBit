"use client";

import { Modal } from "@/components/ui/modal";
import { Table, Td, Tr } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fmt, fmtDate } from "@/lib/format";
import { Calendar, Hash, Package, Tag, User } from "lucide-react";

interface RetornoItem {
  id: string;
  retorno_id: string;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  subtotal_base: number | string;
  subtotal_moneda?: number | string;
}

interface Retorno {
  id: string;
  numero: string;
  tipo: string;
  venta_numero: string | null;
  compra_numero: string | null;
  cliente_nombre: string | null;
  proveedor_nombre: string | null;
  fecha: string;
  motivo: string | null;
  estado: string;
  total_base?: number | string;
  total_moneda?: number | string;
  moneda_codigo?: string | null;
}

interface RetornoDetailModalProps {
  open: boolean;
  retorno: Retorno | null;
  items: RetornoItem[];
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export function RetornoDetailModal({ open, retorno, items, onClose, onDelete }: RetornoDetailModalProps) {
  const confirm = useConfirm();
  if (!retorno) return null;

  const isCliente = retorno.tipo === "Cliente";
  const monedaCodigo = retorno.moneda_codigo || "USD";
  const total = items.reduce(
    (s, i) => s + parseFloat(String(i.subtotal_moneda ?? i.subtotal_base ?? 0)),
    0
  );
  const totalBase = items.reduce((s, i) => s + parseFloat(String(i.subtotal_base || 0)), 0);
  const esBase = monedaCodigo === "USD";

  return (
    <Modal open={open} onClose={onClose} title={`${isCliente ? "Retorno" : "Devolución"} ${retorno.numero}`} className="max-w-3xl">
      <div className="grid grid-cols-2 gap-4 mb-6">
        <InfoRow icon={Tag} label="Tipo" value={isCliente ? "Retorno de Cliente" : "Devolución a Proveedor"} />
        <InfoRow icon={Calendar} label="Fecha" value={fmtDate(retorno.fecha)} />
        <InfoRow
          icon={User}
          label={isCliente ? "Cliente" : "Proveedor"}
          value={isCliente ? retorno.cliente_nombre || "Consumidor Final" : retorno.proveedor_nombre || "—"}
        />
        <InfoRow
          icon={Hash}
          label={isCliente ? "Venta" : "Compra"}
          value={isCliente ? retorno.venta_numero || "—" : retorno.compra_numero || "—"}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Estado:</span>
          <StatusBadge status={retorno.estado} />
        </div>
      </div>

      {retorno.motivo && (
        <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Motivo:</span> {retorno.motivo}
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Package size={14} /> Ítems ({items.length})
        </h4>
        <Table headers={["Código", "Producto", "Cantidad", "Subtotal"]}>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td mono>{item.producto_codigo}</Td>
              <Td>{item.producto_nombre}</Td>
              <Td>
                <span className="font-mono font-semibold">{item.cantidad}</span>
              </Td>
              <Td>
                <span className="font-mono">
                  {fmt(item.subtotal_moneda ?? item.subtotal_base, monedaCodigo)}
                </span>
              </Td>
            </Tr>
          ))}
        </Table>
      </div>

      <div className="flex justify-end">
        <div className="w-72 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total devuelto</span>
            <span className="font-mono font-semibold text-primary">{fmt(total, monedaCodigo)}</span>
          </div>
          {!esBase && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Equivalente (base)</span>
              <span className="font-mono text-muted-foreground">{fmt(totalBase, "USD")}</span>
            </div>
          )}
        </div>
      </div>

      {onDelete && (
        <div className="mt-6 flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await confirm({
                title: "Anular Retorno",
                message: `¿Anular/eliminar el retorno ${retorno.numero}? Esto revertirá las existencias y los abonos generados.`,
                variant: "destructive"
              })) {
                onDelete(retorno.id);
              }
            }}
          >
            Eliminar Retorno
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
