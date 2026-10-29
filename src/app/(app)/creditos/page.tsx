"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { HandCoins, CheckCircle2, Wallet } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { AbonoModal } from "@/components/credito/abono-modal";
import { KpiCard } from "@/components/ui/kpi-card";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDate } from "@/lib/format";

interface Credito {
  id: string;
  numero: string;
  cliente_id: string;
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
  moneda_id: string;
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

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  cursor?: string | null;
  hasMore?: boolean;
}

const PAGE_SIZE = 20;

export default function CreditosPage() {
  const { toast } = useToast();
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [summary, setSummary] = useState<Summary>({ por_cobrar: [], pendientes: "0", pagados: "0" });
  const [loading, setLoading] = useState(true);
  const [estadoFilter, setEstadoFilter] = useState("Todos");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const [abonoOpen, setAbonoOpen] = useState(false);
  const [selectedCredito, setSelectedCredito] = useState<Credito | null>(null);

  const fetchCreditos = useCallback(
    async (opts?: { silent?: boolean; page?: number; search?: string; estado?: string }) => {
      const isSilent = opts?.silent ?? false;
      const pageToFetch = opts?.page !== undefined ? opts.page : currentPage;
      const searchToFetch = opts?.search !== undefined ? opts.search : search;
      const estadoToFetch = opts?.estado !== undefined ? opts.estado : estadoFilter;

      if (!isSilent) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        if (estadoToFetch && estadoToFetch !== "Todos") {
          params.set("estado", estadoToFetch);
        }
        if (searchToFetch.trim()) {
          params.set("search", searchToFetch.trim());
        }
        params.set("page", String(pageToFetch));
        params.set("limit", String(PAGE_SIZE));

        const res = await fetch(`/api/creditos?${params.toString()}`);
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (res.ok) {
          const data = await res.json();
          setCreditos(data.creditos || []);
          setSummary(data.summary || { por_cobrar: [], pendientes: "0", pagados: "0" });
          if (data.pagination) {
            setPagination(data.pagination);
          }
        }
      } catch (error) {
        console.error("Error al obtener créditos:", error);
      } finally {
        if (!isSilent) {
          setLoading(false);
        }
      }
    },
    [currentPage, search, estadoFilter]
  );

  // Carga inicial y cambio de filtros con debounce para búsqueda
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCreditos({ page: currentPage, search, estado: estadoFilter });
    }, 250);
    return () => clearTimeout(timer);
  }, [currentPage, search, estadoFilter, fetchCreditos]);

  // Actualización en segundo plano silenciosa (no resetea el DOM ni muestra "Cargando...")
  useEffect(() => {
    const handleRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (abonoOpen) return;
      fetchCreditos({ silent: true });
    };

    const interval = setInterval(handleRefresh, 15000);
    window.addEventListener("focus", handleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleRefresh);
    };
  }, [fetchCreditos, abonoOpen]);

  const openAbono = (credito: Credito) => {
    setSelectedCredito(credito);
    setAbonoOpen(true);
  };

  const closeAbono = () => {
    setAbonoOpen(false);
    setSelectedCredito(null);
  };

  const handleSuccess = (message: string) => {
    fetchCreditos({ silent: true });
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBar
            placeholder="Buscar por N° crédito, cliente, documento o N° venta..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={estadoFilter}
            onChange={(e) => {
              setEstadoFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="cursor-pointer"
          >
            <option value="Todos">Todos los estados</option>
            <option value="Pendiente">Pendientes</option>
            <option value="Parcial">Parciales</option>
            <option value="Pagado">Pagados</option>
          </Select>
        </div>
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
              {search || estadoFilter !== "Todos"
                ? "No se encontraron créditos para los filtros seleccionados"
                : "No hay créditos registrados"}
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
                      className="cursor-pointer rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
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

      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.limit}
        noun="créditos"
        onPageChange={(page) => setCurrentPage(page)}
      />

      <AbonoModal
        open={abonoOpen}
        credito={selectedCredito}
        onClose={closeAbono}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
