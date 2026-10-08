"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowDown, ArrowUp, Plus, Download, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Select } from "@/components/ui/select";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface Transaccion {
  id: number;
  caja_id: number;
  caja_nombre: string;
  fecha: string;
  tipo: "Entrada" | "Salida";
  monto: number | string;
  moneda_id: number;
  moneda_codigo: string;
  moneda_simbolo: string;
  descripcion: string | null;
  referencia_tipo: string | null;
  referencia_id: number | null;
}

interface Caja {
  id: number;
  nombre: string;
  moneda_codigo: string;
  estado: string;
}

export default function TransaccionesPage() {
  const { toast } = useToast();

  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [cajaFilter, setCajaFilter] = useState<string>("todos");

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // New Transaction Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [newCajaId, setNewCajaId] = useState<string>("");
  const [newTipo, setNewTipo] = useState<"Entrada" | "Salida">("Entrada");
  const [newMonto, setNewMonto] = useState("");
  const [newDescripcion, setNewDescripcion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resTrans, resCajas] = await Promise.all([
        fetch("/api/transacciones"),
        fetch("/api/cajas"),
      ]);
      if (resTrans.ok) {
        const data = await resTrans.json();
        setTransacciones(Array.isArray(data) ? data : []);
      }
      if (resCajas.ok) {
        const data = await resCajas.json();
        const active = (Array.isArray(data) ? data : []).filter((c: Caja) => c.estado === "Abierta");
        setCajas(active);
        if (active.length > 0 && !newCajaId) {
          setNewCajaId(active[0].id.toString());
        }
      }
    } catch (error) {
      console.error("Error fetching transacciones:", error);
    } finally {
      setLoading(false);
    }
  }, [newCajaId]);

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

  const filtered = useMemo(() => {
    let list = transacciones;

    if (tipoFilter !== "todos") {
      list = list.filter((t) => t.tipo === tipoFilter);
    }

    if (cajaFilter !== "todos") {
      list = list.filter((t) => t.caja_id.toString() === cajaFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.caja_nombre.toLowerCase().includes(q) ||
          (t.descripcion && t.descripcion.toLowerCase().includes(q)) ||
          (t.referencia_tipo && t.referencia_tipo.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof Transaccion];
        let bVal: any = b[sortKey as keyof Transaccion];

        if (sortKey === "monto") {
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
    }

    return list;
  }, [transacciones, search, tipoFilter, cajaFilter, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "fecha", label: "Fecha", sortable: true },
    { key: "caja_nombre", label: "Caja", sortable: true },
    { key: "tipo", label: "Tipo", sortable: true },
    { key: "monto", label: "Monto", sortable: true },
    "Moneda",
    { key: "descripcion", label: "Descripción", sortable: true },
    "Referencia",
  ];

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      toast("No hay transacciones para exportar", "warning");
      return;
    }

    const rows = filtered.map((t) => ({
      Fecha: fmtDateTime(t.fecha),
      Caja: t.caja_nombre,
      Tipo: t.tipo,
      Monto: parseFloat(String(t.monto)),
      Moneda: t.moneda_codigo,
      Descripción: t.descripcion || "N/A",
      Referencia: t.referencia_tipo ? `${t.referencia_tipo} #${t.referencia_id}` : "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transacciones");
    XLSX.writeFile(workbook, `transacciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Archivo Excel descargado", "success");
  };

  const handleSaveTransaction = async () => {
    if (!newCajaId || !newMonto) return;
    const montoNum = parseFloat(newMonto);
    if (isNaN(montoNum) || montoNum <= 0) {
      toast("Ingresa un monto válido mayor a 0", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transacciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_id: parseInt(newCajaId),
          tipo: newTipo,
          monto: montoNum,
          descripcion: newDescripcion.trim() || null,
        }),
      });

      if (res.ok) {
        toast("Transacción registrada exitosamente", "success");
        setModalOpen(false);
        setNewMonto("");
        setNewDescripcion("");
        fetchData();
      } else {
        const error = await res.json();
        toast(error.error || "Error al registrar transacción", "error");
      }
    } catch {
      toast("Error al registrar transacción", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Transacciones"
        subtitle="Movimientos de dinero por caja"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus size={14} /> Nueva Transacción
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchBar
          placeholder="Buscar por caja o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value)}
          className="w-40 bg-card"
          aria-label="Filtrar por tipo"
        >
          <option value="todos">Todos los tipos</option>
          <option value="Entrada">Entradas (+)</option>
          <option value="Salida">Salidas (-)</option>
        </Select>
        <Select
          value={cajaFilter}
          onChange={(e) => setCajaFilter(e.target.value)}
          className="w-44 bg-card"
          aria-label="Filtrar por caja"
        >
          <option value="todos">Todas las cajas</option>
          {cajas.map((c) => (
            <option key={c.id} value={c.id.toString()}>
              {c.nombre}
            </option>
          ))}
        </Select>
        <Button variant="outline" onClick={handleExportExcel}>
          <Download size={13} /> Exportar Excel
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Cargando transacciones...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No se encontraron transacciones</p>
          <p className="mt-1 text-sm text-muted-foreground">Registra un movimiento manual o realiza ventas/compras</p>
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {filtered.map((t) => (
            <Tr key={t.id}>
              <Td mono>{fmtDateTime(t.fecha)}</Td>
              <Td>
                <span className="font-medium">{t.caja_nombre}</span>
              </Td>
              <Td>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold",
                    t.tipo === "Entrada" ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {t.tipo === "Entrada" ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                  {t.tipo}
                </div>
              </Td>
              <Td>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    t.tipo === "Entrada" ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {t.tipo === "Entrada" ? "+" : "-"}{fmt(t.monto, t.moneda_codigo)}
                </span>
              </Td>
              <Td>
                <Badge label={t.moneda_codigo} variant="neutral" />
              </Td>
              <Td className="max-w-xs truncate">{t.descripcion || "—"}</Td>
              <Td>
                {t.referencia_tipo ? (
                  <Badge label={`${t.referencia_tipo} #${t.referencia_id}`} variant="info" />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {/* New Transaction Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva Transacción Manual"
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleSaveTransaction} disabled={submitting}>
              {submitting ? "Guardando..." : "Guardar Transacción"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Caja">
            <Select
              value={newCajaId}
              onChange={(e) => setNewCajaId(e.target.value)}
              aria-label="Caja destino"
            >
              {cajas.map((c) => (
                <option key={c.id} value={c.id.toString()}>
                  {c.nombre} ({c.moneda_codigo})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de Movimiento">
            <Select
              value={newTipo}
              onChange={(e) => setNewTipo(e.target.value as "Entrada" | "Salida")}
              aria-label="Tipo"
            >
              <option value="Entrada">Entrada / Depósito (+)</option>
              <option value="Salida">Salida / Retiro (-)</option>
            </Select>
          </Field>
          <Field label="Monto">
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={newMonto}
              onChange={(e) => setNewMonto(e.target.value)}
            />
          </Field>
          <Field label="Descripción">
            <Input
              type="text"
              placeholder="Ej: Ajuste de caja, gasto menor..."
              value={newDescripcion}
              onChange={(e) => setNewDescripcion(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
