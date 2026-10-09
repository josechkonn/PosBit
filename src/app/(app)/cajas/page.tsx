"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, ArrowDown, ArrowUp, Lock, Unlock, DollarSign, Wallet, Vault } from "lucide-react";
import { ActionButtons } from "@/components/ui/action-buttons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Caja {
  id: string;
  nombre: string;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  es_base: boolean;
  saldo_actual: number | string;
  total_entradas: number | string;
  total_salidas: number | string;
  estado: string;
  transacciones_count: number | string;
  fecha_apertura: string | null;
}

interface Moneda {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  es_base: boolean;
}

export default function CajasPage() {
  const { toast } = useToast();

  const [cajas, setCajas] = useState<Caja[]>([]);
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [loading, setLoading] = useState(true);

  // Sorting
  const [sortKey, setSortKey] = useState<string>("nombre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Modals
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [closeBoxModalOpen, setCloseBoxModalOpen] = useState(false);
  const [selectedCaja, setSelectedCaja] = useState<Caja | null>(null);

  // Movement Form
  const [movTipo, setMovTipo] = useState<"Entrada" | "Salida">("Entrada");
  const [movMonto, setMovMonto] = useState("");
  const [movDescripcion, setMovDescripcion] = useState("");
  const [submittingMov, setSubmittingMov] = useState(false);

  // Close Box Form
  const [closeObservaciones, setCloseObservaciones] = useState("");
  const [submittingClose, setSubmittingClose] = useState(false);

  // Re-open Box Modal
  const [openBoxModalOpen, setOpenBoxModalOpen] = useState(false);
  const [saldoApertura, setSaldoApertura] = useState("");
  const [submittingOpen, setSubmittingOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resCajas, resMonedas] = await Promise.all([
        fetch("/api/cajas"),
        fetch("/api/monedas"),
      ]);
      if (resCajas.ok) {
        const data = await resCajas.json();
        setCajas(Array.isArray(data) ? data : []);
      }
      if (resMonedas.ok) {
        const data = await resMonedas.json();
        setMonedas(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Error fetching cajas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const sortedCajas = useMemo(() => {
    if (!sortKey) return cajas;

    return [...cajas].sort((a, b) => {
      let aVal: any = a[sortKey as keyof Caja];
      let bVal: any = b[sortKey as keyof Caja];

      if (["saldo_actual", "total_entradas", "total_salidas", "transacciones_count"].includes(sortKey)) {
        aVal = parseFloat(String(aVal));
        bVal = parseFloat(String(bVal));
      }

      if (aVal === null || aVal === undefined) aVal = "";
      if (bVal === null || bVal === undefined) bVal = "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }

      const comp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? comp : -comp;
    });
  }, [cajas, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "id", label: "#", sortable: true },
    { key: "nombre", label: "Nombre", sortable: true },
    "Moneda",
    { key: "saldo_actual", label: "Saldo Actual", sortable: true },
    { key: "total_entradas", label: "Depósitos (+)", sortable: true },
    { key: "total_salidas", label: "Retiros (-)", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
    { key: "transacciones_count", label: "Movimientos", sortable: true },
    "Acciones",
  ];

  // Open Movement modal (deposit / withdrawal)
  const handleOpenMovement = (caja: Caja, tipo: "Entrada" | "Salida") => {
    setSelectedCaja(caja);
    setMovTipo(tipo);
    setMovMonto("");
    setMovDescripcion("");
    setMovementModalOpen(true);
  };

  // Submit manual transaction
  const handleSaveMovement = async () => {
    if (!selectedCaja || !movMonto) return;
    const montoNum = parseFloat(movMonto);
    if (isNaN(montoNum) || montoNum <= 0) {
      toast("Ingresa un monto válido mayor a 0", "warning");
      return;
    }

    setSubmittingMov(true);
    try {
      const res = await fetch("/api/transacciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_id: selectedCaja.id,
          tipo: movTipo,
          monto: montoNum,
          descripcion: movDescripcion.trim() || (movTipo === "Entrada" ? "Depósito manual" : "Retiro manual"),
        }),
      });

      if (res.ok) {
        toast(
          movTipo === "Entrada"
            ? `Depósito de ${fmt(montoNum, selectedCaja.moneda_codigo)} realizado exitosamente`
            : `Retiro de ${fmt(montoNum, selectedCaja.moneda_codigo)} realizado exitosamente`,
          "success"
        );
        setMovementModalOpen(false);
        fetchData();
      } else {
        const error = await res.json();
        toast(error.error || "Error al registrar movimiento", "error");
      }
    } catch {
      toast("Error al registrar movimiento", "error");
    } finally {
      setSubmittingMov(false);
    }
  };

  // Open Close Box modal
  const handleOpenCloseBox = (caja: Caja) => {
    setSelectedCaja(caja);
    setCloseObservaciones("");
    setCloseBoxModalOpen(true);
  };

  // Submit Close Box (leaves balance in 0)
  const handleConfirmCloseBox = async () => {
    if (!selectedCaja) return;

    setSubmittingClose(true);
    try {
      const res = await fetch("/api/cierres-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_id: selectedCaja.id,
          observaciones: closeObservaciones.trim() || null,
        }),
      });

      if (res.ok) {
        toast(`Cierre de caja "${selectedCaja.nombre}" completado. Saldo restablecido a 0.00`, "success");
        setCloseBoxModalOpen(false);
        fetchData();
      } else {
        const error = await res.json();
        toast(error.error || "Error al cerrar caja", "error");
      }
    } catch {
      toast("Error al cerrar caja", "error");
    } finally {
      setSubmittingClose(false);
    }
  };

  // Re-open caja
  const handleReopenCaja = (caja: Caja) => {
    setSelectedCaja(caja);
    setSaldoApertura("");
    setOpenBoxModalOpen(true);
  };

  const handleConfirmOpenCaja = async () => {
    if (!selectedCaja) return;
    setSubmittingOpen(true);
    try {
      const res = await fetch("/api/cajas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          id: selectedCaja.id, 
          accion: "abrir",
          saldo_apertura: parseFloat(saldoApertura) || 0
        }),
      });

      if (res.ok) {
        toast(`Caja "${selectedCaja.nombre}" abierta exitosamente con fondo de ${fmt(parseFloat(saldoApertura) || 0, selectedCaja.moneda_codigo)}`, "success");
        setOpenBoxModalOpen(false);
        fetchData();
      } else {
        const error = await res.json();
        toast(error.error || "Error al abrir caja", "error");
      }
    } catch {
      toast("Error al abrir caja", "error");
    } finally {
      setSubmittingOpen(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cajas"
        subtitle="Gestión de cajas, depósitos, retiros y saldos por moneda"
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cajas.map((c) => (
          <div key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {c.nombre}
              </span>
              <Badge label={`${c.moneda_simbolo} ${c.moneda_codigo}`} variant={c.es_base ? "purple" : "info"} />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-foreground">
              {fmt(c.saldo_actual, c.moneda_codigo)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs border-t border-border/40 pt-2">
              <div className="flex items-center gap-1 text-emerald-400 font-mono font-medium">
                <ArrowDown size={12} /> {fmt(c.total_entradas, c.moneda_codigo)}
              </div>
              <div className="flex items-center gap-1 text-rose-400 font-mono font-medium">
                <ArrowUp size={12} /> {fmt(c.total_salidas, c.moneda_codigo)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando cajas...
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {sortedCajas.map((c) => (
            <Tr key={c.id}>
              <Td mono>{String(c.id).padStart(2, "0")}</Td>
              <Td>
                <span className="font-semibold">{c.nombre}</span>
              </Td>
              <Td>
                <Badge label={`${c.moneda_simbolo} ${c.moneda_codigo}`} variant={c.es_base ? "purple" : "info"} />
              </Td>
              <Td>
                <span className="font-mono font-bold text-foreground text-base">
                  {fmt(c.saldo_actual, c.moneda_codigo)}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-emerald-400 font-semibold">
                  +{fmt(c.total_entradas, c.moneda_codigo)}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-rose-400 font-semibold">
                  -{fmt(c.total_salidas, c.moneda_codigo)}
                </span>
              </Td>
              <Td>
                <StatusBadge status={c.estado} />
              </Td>
              <Td>
                <span className="font-mono">{c.transacciones_count}</span>
              </Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  {c.estado === "Abierta" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                        onClick={() => handleOpenMovement(c, "Entrada")}
                        title="Registrar depósito"
                      >
                        <ArrowDown size={13} /> Depósito
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        onClick={() => handleOpenMovement(c, "Salida")}
                        title="Registrar retiro"
                      >
                        <ArrowUp size={13} /> Retiro
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleOpenCloseBox(c)}
                        title="Cierre de caja"
                      >
                        <Lock size={13} /> Cerrar
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-primary"
                      onClick={() => handleReopenCaja(c)}
                    >
                      <Unlock size={13} /> Abrir Caja
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {/* Movement Modal (Deposit / Withdrawal) */}
      <Modal
        open={movementModalOpen}
        onClose={() => setMovementModalOpen(false)}
        title={movTipo === "Entrada" ? `Depósito a ${selectedCaja?.nombre}` : `Retiro de ${selectedCaja?.nombre}`}
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setMovementModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              className={cn("flex-1", movTipo === "Entrada" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700")}
              onClick={handleSaveMovement}
              disabled={submittingMov}
            >
              {submittingMov ? "Registrando..." : movTipo === "Entrada" ? "Confirmar Depósito" : "Confirmar Retiro"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={`Monto en ${selectedCaja?.moneda_codigo || ""}`}>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={movMonto}
              onChange={(e) => setMovMonto(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Descripción / Motivo">
            <Input
              type="text"
              placeholder={movTipo === "Entrada" ? "Ej: Depósito adicional..." : "Ej: Retiro por gasto..."}
              value={movDescripcion}
              onChange={(e) => setMovDescripcion(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      {/* Close Box Modal */}
      <Modal
        open={closeBoxModalOpen}
        onClose={() => setCloseBoxModalOpen(false)}
        title={`Cierre de ${selectedCaja?.nombre}`}
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setCloseBoxModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="flex-1" onClick={handleConfirmCloseBox} disabled={submittingClose}>
              {submittingClose ? "Cerrando..." : "Confirmar Cierre"}
            </Button>
          </>
        }
      >
        {selectedCaja && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Depósitos (+):</span>
                <span className="font-mono text-emerald-400 font-semibold">+{fmt(selectedCaja.total_entradas, selectedCaja.moneda_codigo)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Retiros (-):</span>
                <span className="font-mono text-rose-400 font-semibold">-{fmt(selectedCaja.total_salidas, selectedCaja.moneda_codigo)}</span>
              </div>
              <div className="border-t border-border/60 pt-2 flex justify-between font-bold">
                <span>Saldo Final a Cerrar:</span>
                <span className="font-mono text-primary text-base">{fmt(selectedCaja.saldo_actual, selectedCaja.moneda_codigo)}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 p-2.5 rounded text-amber-300">
              Al confirmar el cierre, el saldo actual de la caja se registrará en el historial de cierres y la caja quedará restablecida en <strong>0.00</strong>.
            </p>

            <Field label="Observaciones del cierre (opcional)">
              <Input
                type="text"
                placeholder="Observaciones adicionales..."
                value={closeObservaciones}
                onChange={(e) => setCloseObservaciones(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Open Box Modal */}
      <Modal
        open={openBoxModalOpen}
        onClose={() => setOpenBoxModalOpen(false)}
        title={`Abrir Caja: ${selectedCaja?.nombre}`}
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setOpenBoxModalOpen(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleConfirmOpenCaja} disabled={submittingOpen}>
              {submittingOpen ? "Abriendo..." : "Confirmar Apertura"}
            </Button>
          </>
        }
      >
        {selectedCaja && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ingresa el saldo base (fondo de cambio) con el que inicia el turno esta caja.
            </p>
            <Field label={`Saldo de apertura en ${selectedCaja.moneda_codigo}`}>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={saldoApertura}
                onChange={(e) => setSaldoApertura(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
