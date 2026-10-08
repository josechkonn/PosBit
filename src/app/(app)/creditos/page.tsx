"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { HandCoins, CheckCircle2, Wallet } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { AbonoModal } from "@/components/credito/abono-modal";
import { KpiCard } from "@/components/ui/kpi-card";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDate } from "@/lib/format";

interface Credito {
  id: number;
  numero: string;
  cliente_id: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_documento: string | null;
  venta_numero: string | null;
  venta_fecha: string | null;
  fecha: string;
  monto_total: number | string;
  saldo: number | string;
  abonado: number | string;
  abonos_count: number | string;
  estado: string;
  moneda_id: number;
  moneda_codigo: string;
  moneda_simbolo: string;
}

interface PorCobrarItem {
  codigo: string;
  simbolo: string;
  monto: number;
}

interface Summary {
  por_cobrar: PorCobrarItem[];
  pendientes: string;
  pagados: string;
}

export default function CreditosPage() {
  const { toast } = useToast();
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [summary, setSummary] = useState<Summary>({ por_cobrar: [], pendientes: "0", pagados: "0" });
  const [loading, setLoading] = useState(true);
  const [estadoFilter, setEstadoFilter] = useState("Todos");

  const [abonoOpen, setAbonoOpen] = useState(false);
  const [selectedCredito, setSelectedCredito] = useState<Credito | null>(null);

  const fetchCreditos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/creditos?estado=${estadoFilter}`);
      if (res.ok) {
        const data = await res.json();
        setCreditos(data.creditos || []);
        setSummary(data.summary || { por_cobrar: [], pendientes: "0", pagados: "0" });
      }
    } catch (error) {
      console.error("Error al obtener créditos:", error);
    } finally {
      setLoading(false);
    }
  }, [estadoFilter]);

  useEffect(() => {
    fetchCreditos();
  }, [fetchCreditos]);

  const openAbono = (credito: Credito) => {
    setSelectedCredito(credito);
    setAbonoOpen(true);
  };

  const closeAbono = () => {
    setAbonoOpen(false);
    setSelectedCredito(null);
  };

  const handleSuccess = (message: string) => {
    fetchCreditos();
    toast(message, "success");
  };

  const headers: HeaderConfig[] = [
    { key: "numero", label: "N° Crédito", sortable: true },
    { key: "cliente_nombre", label: "Cliente", sortable: true },
    { key: "fecha", label: "Fecha", sortable: true },
    { key: "venta_numero", label: "Venta", sortable: true },
    { key: "monto_total", label: "Total", sortable: true },
    { key: "abonado", label: "Abonado", sortable: true },
    { key: "saldo", label: "Saldo", sortable: true },
    { key: "estado", label: "Estado", sortable: true },
    "Acción",
  ];

  const sorted = useMemo(() => {
    return [...creditos];
  }, [creditos]);

  return (
    <div>
      <PageHeader title="Créditos" subtitle="Control de deudores y cuentas por cobrar" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Por cobrar"
          value={
            summary.por_cobrar.length > 0 ? (
              <div className="flex flex-col gap-0.5 text-base sm:text-lg">
                {summary.por_cobrar.map((pc) => (
                  <span key={pc.codigo}>
                    {fmt(pc.monto, pc.codigo)}
                  </span>
                ))}
              </div>
            ) : (
              "$0.00"
            )
          }
          sub="Saldos pendientes desglosados"
          icon={Wallet}
        />
        <KpiCard
          label="Créditos pendientes"
          value={String(summary.pendientes)}
          sub="Créditos sin pagar"
          icon={HandCoins}
        />
        <KpiCard
          label="Créditos pagados"
          value={String(summary.pagados)}
          sub="Créditos saldados"
          icon={CheckCircle2}
        />
      </div>

      <div className="mb-4 w-48">
        <Select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value)}>
          <option value="Todos">Todos los estados</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Parcial">Parcial</option>
          <option value="Pagado">Pagado</option>
        </Select>
      </div>

      <Table headers={headers}>
        {loading ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              Cargando...
            </Td>
          </Tr>
        ) : sorted.length === 0 ? (
          <Tr>
            <Td colSpan={9} className="text-center py-8 text-muted-foreground">
              {estadoFilter === "Todos"
                ? "No hay créditos registrados"
                : `No hay créditos con estado "${estadoFilter}"`}
            </Td>
          </Tr>
        ) : (
          sorted.map((c) => {
            const saldo = parseFloat(String(c.saldo));
            return (
              <Tr key={c.id}>
                <Td mono>{c.numero}</Td>
                <Td>
                  <span className="font-semibold">{c.cliente_nombre}</span>
                  {c.cliente_documento && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.cliente_documento}</span>
                  )}
                </Td>
                <Td>{fmtDate(c.fecha)}</Td>
                <Td mono>{c.venta_numero || "—"}</Td>
                <Td>
                  <span className="font-mono">{fmt(c.monto_total, c.moneda_codigo)}</span>
                </Td>
                <Td>
                  <span className="font-mono text-success-strong">{fmt(c.abonado, c.moneda_codigo)}</span>
                </Td>
                <Td>
                  <span className={`font-mono font-semibold ${saldo > 0 ? "text-danger" : "text-success-strong"}`}>
                    {fmt(c.saldo, c.moneda_codigo)}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={c.estado} />
                </Td>
                <Td>
                  {c.estado !== "Pagado" ? (
                    <button
                      onClick={() => openAbono(c)}
                      className="rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                    >
                      Registrar Abono
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Saldado</span>
                  )}
                </Td>
              </Tr>
            );
          })
        )}
      </Table>

      <AbonoModal
        open={abonoOpen}
        credito={selectedCredito}
        onClose={closeAbono}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
