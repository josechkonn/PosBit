"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Download, Lock } from "lucide-react";
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
import * as XLSX from "xlsx";

interface CierreCaja {
  id: number;
  caja_id: number;
  caja_nombre: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  fecha_apertura: string;
  fecha_cierre: string;
  saldo_apertura: number | string;
  total_entradas: number | string;
  total_salidas: number | string;
  saldo_cierre: number | string;
  observaciones: string | null;
}

interface Caja {
  id: number;
  nombre: string;
  moneda_codigo: string;
  estado: string;
  saldo_actual: number | string;
  total_entradas: number | string;
  total_salidas: number | string;
}

export default function CierresCajaPage() {
  const { toast } = useToast();

  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cajaFilter, setCajaFilter] = useState<string>("todos");

  // Sorting
  const [sortKey, setSortKey] = useState<string>("fecha_cierre");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // New Closure Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCajaId, setSelectedCajaId] = useState<string>("");
  const [observaciones, setObservaciones] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resCierres, resCajas] = await Promise.all([
        fetch("/api/cierres-caja"),
        fetch("/api/cajas"),
      ]);
      if (resCierres.ok) {
        const data = await resCierres.json();
        setCierres(Array.isArray(data) ? data : []);
      }
      if (resCajas.ok) {
        const data = await resCajas.json();
        const openBoxes = (Array.isArray(data) ? data : []).filter((c: Caja) => c.estado === "Abierta");
        setCajas(openBoxes);
        if (openBoxes.length > 0 && !selectedCajaId) {
          setSelectedCajaId(openBoxes[0].id.toString());
        }
      }
    } catch (error) {
      console.error("Error fetching cierres:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedCajaId]);

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
    let list = cierres;

    if (cajaFilter !== "todos") {
      list = list.filter((c) => c.caja_id.toString() === cajaFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.caja_nombre.toLowerCase().includes(q) ||
          (c.observaciones && c.observaciones.toLowerCase().includes(q))
      );
    }

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let aVal: any = a[sortKey as keyof CierreCaja];
        let bVal: any = b[sortKey as keyof CierreCaja];

        if (["saldo_apertura", "total_entradas", "total_salidas", "saldo_cierre"].includes(sortKey)) {
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
  }, [cierres, search, cajaFilter, sortKey, sortOrder]);

  const headers: HeaderConfig[] = [
    { key: "caja_nombre", label: "Caja", sortable: true },
    "Moneda",
    { key: "fecha_apertura", label: "Apertura", sortable: true },
    { key: "fecha_cierre", label: "Cierre", sortable: true },
    { key: "saldo_apertura", label: "Saldo Apertura", sortable: true },
    { key: "total_entradas", label: "Entradas (+)", sortable: true },
    { key: "total_salidas", label: "Salidas (-)", sortable: true },
    { key: "saldo_cierre", label: "Saldo Cierre", sortable: true },
    "Observaciones",
  ];

  const handleExportExcel = () => {
    if (filtered.length === 0) {
      toast("No hay cierres de caja para exportar", "warning");
      return;
    }

    const rows = filtered.map((c) => ({
      Caja: c.caja_nombre,
      Moneda: c.moneda_codigo,
      Apertura: fmtDateTime(c.fecha_apertura),
      Cierre: fmtDateTime(c.fecha_cierre),
      "Saldo Apertura": parseFloat(String(c.saldo_apertura)),
      Entradas: parseFloat(String(c.total_entradas)),
      Salidas: parseFloat(String(c.total_salidas)),
      "Saldo Cierre": parseFloat(String(c.saldo_cierre)),
      Observaciones: c.observaciones || "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cierres_Caja");
    XLSX.writeFile(workbook, `cierres_caja_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("Archivo Excel descargado", "success");
  };

  const activeCaja = cajas.find((c) => c.id.toString() === selectedCajaId);

  const handleSaveCloseBox = async () => {
    if (!selectedCajaId) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/cierres-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_id: parseInt(selectedCajaId),
          observaciones: observaciones.trim() || null,
        }),
      });

      if (res.ok) {
        toast(`Cierre de caja registrado exitosamente. Saldo de la caja en 0.00`, "success");
        setModalOpen(false);
        setObservaciones("");
        fetchData();
      } else {
        const error = await res.json();
        toast(error.error || "Error al cerrar caja", "error");
      }
    } catch {
      toast("Error al cerrar caja", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cierres de Caja"
        subtitle="Historial de cierres de caja por moneda"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus size={14} /> Nuevo Cierre
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchBar
          placeholder="Buscar por caja u observaciones..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
          Cargando cierres de caja...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-foreground">No hay cierres de caja registrados</p>
          <p className="mt-1 text-sm text-muted-foreground">Realiza un cierre de caja al finalizar el turno</p>
        </div>
      ) : (
        <Table headers={headers} sortKey={sortKey} sortOrder={sortOrder} onSort={handleSort}>
          {filtered.map((c) => (
            <Tr key={c.id}>
              <Td>
                <span className="font-semibold">{c.caja_nombre}</span>
              </Td>
              <Td>
                <Badge label={`${c.moneda_simbolo} ${c.moneda_codigo}`} variant="info" />
              </Td>
              <Td mono>{fmtDateTime(c.fecha_apertura)}</Td>
              <Td mono>{fmtDateTime(c.fecha_cierre)}</Td>
              <Td mono>{fmt(c.saldo_apertura, c.moneda_codigo)}</Td>
              <Td mono className="text-emerald-400 font-semibold">+{fmt(c.total_entradas, c.moneda_codigo)}</Td>
              <Td mono className="text-rose-400 font-semibold">-{fmt(c.total_salidas, c.moneda_codigo)}</Td>
              <Td mono className="font-bold text-primary">{fmt(c.saldo_cierre, c.moneda_codigo)}</Td>
              <Td className="max-w-xs truncate">{c.observaciones || "—"}</Td>
            </Tr>
          ))}
        </Table>
      )}

      {/* New Closure Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo Cierre de Caja"
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="flex-1" onClick={handleSaveCloseBox} disabled={submitting || cajas.length === 0}>
              {submitting ? "Cerrando..." : "Confirmar Cierre"}
            </Button>
          </>
        }
      >
        {cajas.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay cajas abiertas para cerrar actualmente.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="Seleccionar Caja a Cerrar">
              <Select
                value={selectedCajaId}
                onChange={(e) => setSelectedCajaId(e.target.value)}
                aria-label="Caja a cerrar"
              >
                {cajas.map((c) => (
                  <option key={c.id} value={c.id.toString()}>
                    {c.nombre} ({c.moneda_codigo}) — Saldo: {fmt(c.saldo_actual, c.moneda_codigo)}
                  </option>
                ))}
              </Select>
            </Field>

            {activeCaja && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entradas (+):</span>
                  <span className="font-mono text-emerald-400 font-semibold">+{fmt(activeCaja.total_entradas, activeCaja.moneda_codigo)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Salidas (-):</span>
                  <span className="font-mono text-rose-400 font-semibold">-{fmt(activeCaja.total_salidas, activeCaja.moneda_codigo)}</span>
                </div>
                <div className="border-t border-border/60 pt-2 flex justify-between font-bold">
                  <span>Saldo a registrar en cierre:</span>
                  <span className="font-mono text-primary text-base">{fmt(activeCaja.saldo_actual, activeCaja.moneda_codigo)}</span>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 p-2.5 rounded text-amber-300">
              Al confirmar el cierre, la caja cambiará su estado a <strong>Cerrada</strong> y su saldo actual se restablecerá a <strong>0.00</strong>.
            </p>

            <Field label="Observaciones (opcional)">
              <Input
                type="text"
                placeholder="Observaciones de cierre..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
