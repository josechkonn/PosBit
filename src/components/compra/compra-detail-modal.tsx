"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Package, Calendar, Truck, CreditCard, Hash, FileText, DollarSign, History } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Table, Td, Tr } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CompraItem {
  id: string;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  costo_unit: number | string;
  costo_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
  presentacion_nombre?: string | null;
  presentacion_unidades?: number | null;
  cantidad_presentaciones?: number | null;
  costo_presentacion?: number | string | null;
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
  // Nuevos campos de pago
  estado_pago?: 'pagado' | 'parcial' | 'pendiente';
  saldo_pendiente?: number | string;
}

interface Abono {
  id: string;
  fecha: string;
  monto: number | string;
  moneda_codigo: string;
  moneda_simbolo: string;
  tasa_cambio: number | string;
  monto_base: number | string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  observaciones: string | null;
  creado_en: string;
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
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'items' | 'abonos'>('items');
  const [abonos, setAbonos] = useState<Abono[]>([]);
  const [loadingAbonos, setLoadingAbonos] = useState(false);

  const fetchAbonos = useCallback(async () => {
    if (!compra) return;
    setLoadingAbonos(true);
    try {
      const res = await fetch(`/api/compras/${compra.id}/abonos`);
      if (res.ok) {
        const data = await res.json();
        setAbonos(data.abonos || []);
      }
    } catch (e) {
      console.error("Error cargando abonos:", e);
    } finally {
      setLoadingAbonos(false);
    }
  }, [compra]);

  useEffect(() => {
    if (open) {
      fetchAbonos();
    }
  }, [open, fetchAbonos]);

  if (!compra) return null;

  const compraItems = items.filter((i) => true);

  return (
    <Modal open={open} onClose={onClose} title={`Compra ${compra.numero}`} className="max-w-5xl">
      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoRow icon={Truck} label="Proveedor" value={compra.proveedor_nombre} />
        <InfoRow icon={Calendar} label="Fecha" value={fmtDate(compra.fecha)} />
        <InfoRow icon={CreditCard} label="Método Pago" value={compra.metodo_pago_nombre || "—"} />
        <InfoRow icon={Hash} label="Caja" value={compra.caja_nombre || "—"} />
        <InfoRow icon={FileText} label="Referencia" value={compra.referencia || "—"} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Estado:</span>
          <StatusBadge status={compra.estado} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Estado pago:</span>
          <StatusBadge status={compra.estado_pago || 'pagado'} />
        </div>
        {Number(compra.saldo_pendiente || 0) > 0 && (
          <div className="flex items-center gap-2 text-red-500">
            <DollarSign size={14} />
            <span className="text-xs font-medium">Saldo: {fmt(Number(compra.saldo_pendiente), "USD")}</span>
          </div>
        )}
      </div>

      {compra.observaciones && (
        <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Observaciones:</span> {compra.observaciones}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border mb-4">
        <nav className="flex gap-1" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'items'}
            onClick={() => setActiveTab('items')}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
              activeTab === 'items'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Package size={14} className="inline mr-1" /> Ítems ({items.length})
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'abonos'}
            onClick={() => { setActiveTab('abonos'); fetchAbonos(); }}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5",
              activeTab === 'abonos'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <History size={14} /> Abonos
            {Number(compra.saldo_pendiente || 0) > 0 && (
              <span className="bg-red-500/20 text-red-500 text-[10px] px-1.5 py-0.5 rounded">
                {Number(compra.saldo_pendiente || 0).toFixed(2)} USD
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ── Tab Ítems ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'items' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {/* Items table */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <Package size={14} /> Ítems ({items.length})
              </h4>
              <Table headers={["Código", "Producto", "Cantidad", "Costo", "Subtotal"]}>
                {items.map((item) => {
                  const esPresentacion = !!item.presentacion_nombre && Number(item.presentacion_unidades) > 1;
                  const unidades = Number(item.presentacion_unidades) || 0;
                  const cantidadPres = Number(item.cantidad_presentaciones) || 0;
                  return (
                    <Tr key={item.id}>
                      <Td mono>{item.producto_codigo}</Td>
                      <Td>
                        <div>{item.producto_nombre}</div>
                        {esPresentacion && (
                          <div className="text-[11px] text-muted-foreground">
                            {item.presentacion_nombre} de {unidades} unidades
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono font-semibold">
                          {esPresentacion ? `${Number(item.cantidad_presentaciones || 0)} ${item.presentacion_nombre}` : item.cantidad}
                        </span>
                        {esPresentacion && (
                          <div className="text-[11px] text-muted-foreground">
                            {item.cantidad} unidades
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono">
                          {esPresentacion && item.costo_presentacion != null
                            ? fmt(item.costo_presentacion, compra.moneda_codigo)
                            : fmt(item.costo_unit, compra.moneda_codigo)}
                        </span>
                        {esPresentacion && (
                          <div className="text-[11px] text-muted-foreground">
                            {fmt(item.costo_unit, compra.moneda_codigo)} / unid.
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono font-semibold">{fmt(item.subtotal, compra.moneda_codigo)}</span>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            </div>

            {/* Totals */}
            <div className="flex justify-end mb-4">
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
          </motion.div>
        )}

        {/* ── Tab Abonos ── */}
        {activeTab === 'abonos' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {/* Historial de abonos */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                <History size={14} /> Historial de Abonos ({abonos.length})
              </h4>
              {loadingAbonos ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : abonos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay abonos registrados.
                </div>
              ) : (
                <Table headers={["Fecha", "Monto", "Moneda", "Tasa", "Monto (USD)", "Método", "Caja", "Obs."]}>
                  {abonos.map((abono) => (
                    <Tr key={abono.id}>
                      <Td mono>{fmtDate(abono.fecha)}</Td>
                      <Td>
                        <span className="font-mono font-semibold">
                          {fmt(abono.monto, abono.moneda_codigo)}
                        </span>
                      </Td>
                      <Td>{abono.moneda_simbolo} {abono.moneda_codigo}</Td>
                      <Td mono>{parseFloat(String(abono.tasa_cambio)).toFixed(4)}</Td>
                      <Td>
                        <span className="font-mono font-semibold text-primary">
                          {fmt(abono.monto_base, "USD")}
                        </span>
                      </Td>
                      <Td>{abono.metodo_pago_nombre || "—"}</Td>
                      <Td>{abono.caja_nombre || "—"}</Td>
                      <Td className="text-xs text-muted-foreground max-w-[150px] truncate">{abono.observaciones || "—"}</Td>
                    </Tr>
                  ))}
                </Table>
              )}
              {!loadingAbonos && abonos.length > 0 && (
                <div className="mt-3 flex justify-end">
                  <div className="w-72 space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total abonado (USD)</span>
                      <span className="font-mono font-semibold text-primary">
                        {fmt(abonos.reduce((s, a) => s + Number(a.monto_base), 0), "USD")}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold">
                      <span>Saldo pendiente</span>
                      <span className="font-mono text-red-500">{fmt(Number(compra.saldo_pendiente || 0), "USD")}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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