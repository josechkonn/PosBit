"use client";

import { useState, useEffect } from "react";
import {
  CreditCard,
  DollarSign,
  Download,
  FileText,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Award,
  Activity,
  PieChart,
  Coins,
  Wallet,
  CheckCircle2,
  Receipt,
  Scale,
} from "lucide-react";
import { CategoryPieChart, MonthlyBarChart } from "@/components/charts/charts";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/ui/date-range";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Pagination } from "@/components/ui/pagination";
import { CHART_COLORS } from "@/lib/chart-colors";
import { exportarReporteExcel, exportarReportePDF } from "@/lib/export-reportes";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "ventas", label: "Ventas" },
  { id: "finanzas", label: "Finanzas" },
  { id: "compras", label: "Compras" },
  { id: "inventario", label: "Inventario" },
  { id: "tops", label: "Los 10" },
];

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ReportesPage() {
  const [active, setActive] = useState("ventas");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [presetActivo, setPresetActivo] = useState<"hoy" | "mes" | "anio" | "todo" | "custom">("todo");
  const [stockBajoPage, setStockBajoPage] = useState(1);
  const STOCK_BAJO_PAGE_SIZE = 8;

  const aplicarPreset = (p: "hoy" | "mes" | "anio" | "todo") => {
    setPresetActivo(p);
    const h = hoyISO();
    const anio = h.slice(0, 4);
    const mes = h.slice(5, 7);

    if (p === "hoy") {
      setFechaInicio(h);
      setFechaFin(h);
    } else if (p === "mes") {
      setFechaInicio(`${anio}-${mes}-01`);
      setFechaFin(h);
    } else if (p === "anio") {
      setFechaInicio(`${anio}-01-01`);
      setFechaFin(h);
    } else {
      setFechaInicio("");
      setFechaFin("");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("tipo", active);
        if (fechaInicio) params.set("fecha_inicio", fechaInicio);
        if (fechaFin) params.set("fecha_fin", fechaFin);
        const res = await fetch(`/api/reportes?${params.toString()}`);
        const result = await res.json();
        setData(result);
      } catch (error) {
        console.error("Error fetching reports:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [active, fechaInicio, fechaFin]);

  const handlePDF = () => {
    if (data) exportarReportePDF(data, active);
  };

  const handleExcel = () => {
    if (data) exportarReporteExcel(data, active);
  };

  const cobrosGlobales: any[] = data?.__cobros_globales || [];

  if (loading && !data) {
    return (
      <div>
        <PageHeader
          title="Reportes"
          subtitle="Análisis y estadísticas del negocio"
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled>
                <Download size={14} /> Exportar PDF
              </Button>
              <Button variant="outline" disabled>
                <FileText size={14} /> Exportar Excel
              </Button>
            </div>
          }
        />
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Cargando reportes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        subtitle="Análisis, ventas reales, deudas y finanzas del negocio"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handlePDF} disabled={!data}>
              <Download size={14} /> Exportar PDF
            </Button>
            <Button variant="outline" onClick={handleExcel} disabled={!data}>
              <FileText size={14} /> Exportar Excel
            </Button>
          </div>
        }
      />

      {/* Controles de Navegación y Filtros Rápidos */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <Tabs items={tabs} value={active} onChange={setActive} />

        <div className="flex flex-wrap items-center gap-2">
          {/* Accesos Rápidos */}
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-1 text-xs">
            <button
              type="button"
              onClick={() => aplicarPreset("hoy")}
              className={cn(
                "rounded-md px-2.5 py-1 font-semibold transition-all",
                presetActivo === "hoy"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => aplicarPreset("mes")}
              className={cn(
                "rounded-md px-2.5 py-1 font-semibold transition-all",
                presetActivo === "mes"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Este Mes
            </button>
            <button
              type="button"
              onClick={() => aplicarPreset("anio")}
              className={cn(
                "rounded-md px-2.5 py-1 font-semibold transition-all",
                presetActivo === "anio"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Este Año
            </button>
            <button
              type="button"
              onClick={() => aplicarPreset("todo")}
              className={cn(
                "rounded-md px-2.5 py-1 font-semibold transition-all",
                presetActivo === "todo"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Todo
            </button>
          </div>

          <DateRangeFilter
            desde={fechaInicio}
            hasta={fechaFin}
            onChange={(desde, hasta) => {
              setPresetActivo("custom");
              setFechaInicio(desde);
              setFechaFin(hasta);
            }}
          />
        </div>
      </div>

      {/* ── ZONA SEPARADA DESTACADA: Arqueo y Cobros Reales por Moneda Física ── */}
      {cobrosGlobales.length > 0 && (active === "ventas" || active === "finanzas") && (
        <Card className="border-primary/20 bg-gradient-to-br from-card via-card to-primary/[0.04] shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs">
                  <Coins size={20} />
                </div>
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    Cobros Reales por Moneda (Arqueo de Entradas)
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Dinero físico y bancario que efectivamente ingresó a caja por cada moneda en el período (separado de la facturación global).
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 font-mono text-xs font-bold text-success">
                <CheckCircle2 size={13} />
                Ingresos Reales Recibidos
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cobrosGlobales.map((cg: any) => (
                <div
                  key={cg.moneda_codigo}
                  className="flex flex-col justify-between rounded-xl border border-border/80 bg-background/80 p-4 shadow-xs transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs font-bold text-foreground">
                        {cg.moneda_simbolo} {cg.moneda_codigo}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {cg.count_operaciones} cobro{cg.count_operaciones === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-3 font-mono text-2xl font-black tracking-tight text-foreground">
                      {fmt(cg.total, cg.moneda_codigo)}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-success">
                        Ventas: {fmt(cg.total_ventas, cg.moneda_codigo)}
                      </span>
                      {cg.total_abonos > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                          Abonos: {fmt(cg.total_abonos, cg.moneda_codigo)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Desglose por método de pago */}
                  {cg.metodos?.length > 0 && (
                    <div className="mt-4 border-t border-border/60 pt-3 space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Por método de pago:
                      </div>
                      {cg.metodos.map((m: any, idx: number) => {
                        const pct = cg.total > 0 ? ((m.total / cg.total) * 100).toFixed(0) : "0";
                        return (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                              <span className="text-foreground text-xs font-medium truncate max-w-[130px]">
                                {m.nombre}
                              </span>
                              <span className="text-[10px] text-muted-foreground">({m.count})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-foreground">
                                {fmt(m.total, cg.moneda_codigo)}
                              </span>
                              <span className="font-mono text-[10px] font-bold text-muted-foreground w-8 text-right">
                                {pct}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Desglose por Moneda del Sistema ── */}
      {data &&
        Object.entries(data).map(([codigoMoneda, monedaData]: [string, any]) => {
          if (codigoMoneda.startsWith("__")) return null;
          const moneda = monedaData.moneda;
          const resumen = monedaData.resumen;
          const rf = monedaData.resumenFinanzas;

          return (
            <div key={codigoMoneda} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="rounded-lg bg-muted px-2.5 py-1 font-mono text-sm font-bold text-foreground shadow-2xs">
                  {moneda.simbolo} {moneda.codigo}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">{moneda.nombre}</span>
                {moneda.es_base && (
                  <span className="rounded-full bg-purple-soft px-2.5 py-0.5 text-xs font-bold text-purple-strong">
                    Moneda Base
                  </span>
                )}
              </div>

              {/* ── SECCIÓN VENTAS ── */}
              {active === "ventas" && resumen && (
                <div className="space-y-4">
                  {/* Tarjetas KPI Principales: Total vs Contado vs Deuda */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 1. Total Ventas Facturadas */}
                    <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-primary/[0.04] p-5 shadow-xs transition-all">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Total Ventas Facturadas</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <TrendingUp size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-3xl font-black text-foreground">
                        {fmt(resumen.total, moneda.codigo)}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{resumen.count} ventas emitidas</span>
                        <span className="font-semibold text-primary">Contado + Crédito</span>
                      </div>
                    </div>

                    {/* 2. Ventas de Contado (Cobro Inmediato) */}
                    <div className="rounded-2xl border border-success/30 bg-gradient-to-br from-card via-card to-success/[0.04] p-5 shadow-xs transition-all">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider text-success">
                          Venta Cobrada (Contado)
                        </span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-success/15 text-success">
                          <DollarSign size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-3xl font-black text-success">
                        {fmt(resumen.ventaContado, moneda.codigo)}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{resumen.countContado} transacciones</span>
                        <span className="rounded-full bg-success/10 px-2 py-0.5 font-bold text-success text-[11px]">
                          Cobro Inmediato
                        </span>
                      </div>
                    </div>

                    {/* 3. Ventas a Crédito (Deuda Generada) */}
                    <div className="rounded-2xl border border-warning/30 bg-gradient-to-br from-card via-card to-warning/[0.04] p-5 shadow-xs transition-all">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider text-warning">
                          Venta a Crédito (Deuda)
                        </span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-warning/15 text-warning">
                          <CreditCard size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-3xl font-black text-warning">
                        {fmt(resumen.ventaCredito, moneda.codigo)}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{resumen.countCredito} fiadas / crédito</span>
                        <span className="rounded-full bg-warning/10 px-2 py-0.5 font-bold text-warning text-[11px]">
                          Por Cobrar
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Barra Visual de Distribución Contado vs Crédito */}
                  {resumen.total > 0 && (
                    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <PieChart size={14} className="text-primary" /> Proporción de Facturación
                        </span>
                        <div className="flex items-center gap-4 font-mono font-bold text-xs">
                          <span className="text-success flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-success inline-block" />
                            Contado: {((resumen.ventaContado / resumen.total) * 100).toFixed(1)}%
                          </span>
                          <span className="text-warning flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-warning inline-block" />
                            Crédito: {((resumen.ventaCredito / resumen.total) * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-success transition-all duration-500"
                          style={{ width: `${(resumen.ventaContado / resumen.total) * 100}%` }}
                          title={`Contado: ${fmt(resumen.ventaContado, moneda.codigo)}`}
                        />
                        <div
                          className="bg-warning transition-all duration-500"
                          style={{ width: `${(resumen.ventaCredito / resumen.total) * 100}%` }}
                          title={`Crédito: ${fmt(resumen.ventaCredito, moneda.codigo)}`}
                        />
                      </div>
                    </div>
                  )}

                  {/* Tarjetas Secundarias: Abonos recibidos, Ticket promedio, Impuestos */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-primary" /> Abonos Recibidos
                      </div>
                      <div className="mt-1.5 font-mono text-xl font-bold text-foreground">
                        {fmt(resumen.abonosCobrados, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {resumen.countAbonos} abono{resumen.countAbonos === 1 ? "" : "s"} cobrado{resumen.countAbonos === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Wallet size={14} className="text-success" /> Dinero Total Cobrado
                      </div>
                      <div className="mt-1.5 font-mono text-xl font-bold text-success">
                        {fmt(resumen.totalCobradoReal, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Ventas Contado + Abonos
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Receipt size={14} className="text-primary" /> Ticket Promedio
                      </div>
                      <div className="mt-1.5 font-mono text-xl font-bold text-foreground">
                        {resumen.count > 0 ? fmt(resumen.total / resumen.count, moneda.codigo) : fmt(0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Por venta emitida</div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <FileText size={14} className="text-muted-foreground" /> Descuentos e IVA
                      </div>
                      <div className="mt-1.5 font-mono text-sm font-bold text-foreground flex justify-between">
                        <span>Desc: {fmt(resumen.descuento || 0, moneda.codigo)}</span>
                        <span>IVA: {fmt(resumen.impuesto || 0, moneda.codigo)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Subtotal: {fmt(resumen.subtotal, moneda.codigo)}
                      </div>
                    </div>
                  </div>

                  {/* Gráficos de Ventas Diarias */}
                  {monedaData.ventasDiarias && monedaData.ventasDiarias.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <TrendingUp size={16} /> Ventas por Día ({moneda.codigo})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <MonthlyBarChart
                          data={monedaData.ventasDiarias.map((d: any) => ({
                            mes: d.fecha,
                            ventas: parseFloat(d.total),
                          }))}
                          dataKey="ventas"
                          name="Ventas Totales"
                          color={CHART_COLORS[0]}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Ventas por Método de Pago */}
                  {monedaData.ventasPorMetodo && monedaData.ventasPorMetodo.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Ventas por Método de Pago ({moneda.codigo})</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {monedaData.ventasPorMetodo.map((m: any, i: number) => {
                          const totalNum = resumen.total > 0 ? ((m.total / resumen.total) * 100).toFixed(1) : "0";
                          return (
                            <div
                              key={m.nombre || i}
                              className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
                            >
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                                />
                                <div>
                                  <div className="text-sm font-semibold">{m.nombre || "Sin método"}</div>
                                  <div className="text-xs text-muted-foreground">{m.count} operaciones ({totalNum}%)</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-sm font-bold">{fmt(m.total, moneda.codigo)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* ── SECCIÓN FINANZAS ── */}
              {active === "finanzas" && (rf || monedaData.rentabilidad) && (
                <div className="space-y-4">
                  {/* Grid de 6 KPIs Financieros */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* 1. Ventas Totales Facturadas */}
                    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Facturación Total (Bruto)</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <TrendingUp size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-2xl font-black text-foreground">
                        {fmt(rf?.ventasTotales ?? monedaData.rentabilidad?.ingresos ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Venta Contado + Venta a Crédito
                      </div>
                    </div>

                    {/* 2. Dinero Real Cobrado */}
                    <div className="rounded-2xl border border-success/30 bg-card p-5 shadow-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider text-success">
                          Ingresos Reales Cobrados
                        </span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-success/15 text-success">
                          <DollarSign size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-2xl font-black text-success">
                        {fmt(rf?.ingresosReales ?? monedaData.rentabilidad?.ingresos ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Contado ({fmt(rf?.ventaContado ?? 0, moneda.codigo)}) + Abonos ({fmt(rf?.abonosCobrados ?? 0, moneda.codigo)})
                      </div>
                    </div>

                    {/* 3. Costo de Mercancía Vendida */}
                    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Costo Mercancía (CMV)</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <Package size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-2xl font-black text-muted-foreground">
                        {fmt(rf?.costoMercancia ?? monedaData.rentabilidad?.costos ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Costo de adquisición de lo vendido
                      </div>
                    </div>

                    {/* 4. Ganancia Bruta y Margen */}
                    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.04] p-5 shadow-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">
                          Ganancia Bruta
                        </span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                          <Activity size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-2xl font-black text-primary">
                        {fmt(rf?.gananciaBruta ?? monedaData.rentabilidad?.gananciaBruta ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Ventas menos CMV</span>
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono font-bold text-primary">
                          Margen: {(rf?.margenPct ?? 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* 5. Compras del Período */}
                    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Compras del Período</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                          <ShoppingCart size={16} />
                        </div>
                      </div>
                      <div className="mt-2 font-mono text-2xl font-black text-foreground">
                        {fmt(rf?.comprasPeriodo ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {rf?.countCompras ?? 0} compras recibidas
                      </div>
                    </div>

                    {/* 6. Flujo de Caja Operativo */}
                    <div className={cn(
                      "rounded-2xl border p-5 shadow-xs",
                      (rf?.flujoCajaOperativo ?? 0) >= 0
                        ? "border-success/30 bg-gradient-to-br from-card via-card to-success/[0.03]"
                        : "border-danger/30 bg-gradient-to-br from-card via-card to-danger/[0.03]"
                    )}>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Flujo de Caja Operativo</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted">
                          <Scale size={16} />
                        </div>
                      </div>
                      <div className={cn(
                        "mt-2 font-mono text-2xl font-black",
                        (rf?.flujoCajaOperativo ?? 0) >= 0 ? "text-success" : "text-danger"
                      )}>
                        {fmt(rf?.flujoCajaOperativo ?? 0, moneda.codigo)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Ingresos Reales menos Compras
                      </div>
                    </div>
                  </div>

                  {/* Estado de Resultados Simplificado y Balance de Deudas */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Tarjeta de Estado de Resultados */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText size={16} /> Estado de Resultados ({moneda.codigo})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 font-mono text-sm">
                        <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                          <span className="text-muted-foreground font-sans">Total Ventas Facturadas (Bruto)</span>
                          <span className="font-bold text-foreground">
                            +{fmt(rf?.ventasTotales ?? 0, moneda.codigo)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                          <span className="text-muted-foreground font-sans">(-) Descuentos Otorgados</span>
                          <span className="text-muted-foreground">
                            -{fmt(rf?.descuento ?? 0, moneda.codigo)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                          <span className="text-muted-foreground font-sans">(=) Ventas Netas</span>
                          <span className="font-bold text-foreground">
                            {fmt((rf?.ventasTotales ?? 0) - (rf?.descuento ?? 0), moneda.codigo)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-b border-border/60">
                          <span className="text-muted-foreground font-sans">(-) Costo de Mercancía Vendida (CMV)</span>
                          <span className="text-danger font-semibold">
                            -{fmt(rf?.costoMercancia ?? 0, moneda.codigo)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2.5 bg-primary/[0.06] px-3 rounded-xl border border-primary/20">
                          <span className="font-bold text-foreground font-sans">(=) Ganancia Bruta Operativa</span>
                          <span className="text-lg font-black text-primary">
                            {fmt(rf?.gananciaBruta ?? 0, moneda.codigo)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground font-sans pt-1">
                          * Margen sobre facturación: <strong className="font-mono text-foreground font-bold">{(rf?.margenPct ?? 0).toFixed(1)}%</strong>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Tarjeta de Balance de Deudas y Cartera */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <CreditCard size={16} /> Cuentas por Cobrar y Pagar ({moneda.codigo})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-xl border border-warning/30 bg-warning/[0.04] p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-warning">
                              Cuentas por Cobrar (Deuda Total Clientes)
                            </span>
                            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-bold text-warning">
                              {rf?.countDeudores ?? 0} deudor{rf?.countDeudores === 1 ? "" : "es"}
                            </span>
                          </div>
                          <div className="mt-2 font-mono text-2xl font-black text-warning">
                            {fmt(rf?.cuentasPorCobrar ?? monedaData.cuentasPorCobrar ?? 0, moneda.codigo)}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs border-t border-warning/20 pt-2 font-mono">
                            <div>
                              <span className="text-muted-foreground font-sans block">Deuda creada hoy/período:</span>
                              <span className="font-bold text-foreground">{fmt(rf?.ventaCredito ?? 0, moneda.codigo)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground font-sans block">Deuda cobrada (abonos):</span>
                              <span className="font-bold text-success">+{fmt(rf?.abonosCobrados ?? 0, moneda.codigo)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              Cuentas por Pagar (Proveedores)
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                              {rf?.countProveedoresDeuda ?? 0} pendientes
                            </span>
                          </div>
                          <div className="mt-2 font-mono text-2xl font-black text-foreground">
                            {fmt(rf?.cuentasPorPagar ?? monedaData.cuentasPorPagar ?? 0, moneda.codigo)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Saldo adeudado por compras recibidas
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {/* ── SECCIÓN COMPRAS ── */}
              {active === "compras" && monedaData.resumen && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KpiCard
                      label="Total Compras"
                      value={fmt(monedaData.resumen.total, moneda.codigo)}
                      sub={`${monedaData.resumen.count} órdenes`}
                      icon={ShoppingCart}
                    />
                    <KpiCard
                      label="Órdenes de Compra"
                      value={monedaData.resumen.count.toString()}
                      sub="Órdenes recibidas"
                      icon={FileText}
                    />
                    <KpiCard
                      label="Promedio por Orden"
                      value={
                        monedaData.resumen.count > 0
                          ? fmt(monedaData.resumen.total / monedaData.resumen.count, moneda.codigo)
                          : fmt(0, moneda.codigo)
                      }
                      sub="Por orden"
                      icon={CreditCard}
                    />
                  </div>
                  {monedaData.comprasMensuales && monedaData.comprasMensuales.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Compras por Mes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <MonthlyBarChart
                          data={monedaData.comprasMensuales.map((d: any) => ({
                            mes: d.mes,
                            compras: parseFloat(d.total),
                          }))}
                          dataKey="compras"
                          name="Compras"
                          color={CHART_COLORS[2]}
                        />
                      </CardContent>
                    </Card>
                  )}
                  {monedaData.comprasPorProveedor && monedaData.comprasPorProveedor.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Compras por Proveedor</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {monedaData.comprasPorProveedor.map((p: any, i: number) => (
                          <div
                            key={p.nombre}
                            className="flex items-center justify-between border-b border-border py-2 last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="h-3 w-3 rounded-full"
                                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                              />
                              <span className="text-sm font-medium">{p.nombre}</span>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-sm font-semibold">{fmt(p.total, moneda.codigo)}</div>
                              <div className="text-xs text-muted-foreground">{p.count} órdenes</div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* ── SECCIÓN INVENTARIO ── */}
              {active === "inventario" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KpiCard
                      label="Total Productos"
                      value={monedaData.productos?.length.toString() || "0"}
                      sub="Códigos activos"
                      icon={Package}
                    />
                    <KpiCard
                      label={`Valor en Existencias (${moneda.codigo})`}
                      value={fmt(monedaData.valorInventario?.base || 0, moneda.codigo)}
                      sub="A costo en su moneda"
                      icon={DollarSign}
                    />
                    <KpiCard
                      label="Productos Bajo Existencias"
                      value={monedaData.stockBajo?.length.toString() || "0"}
                      sub="Requieren reposición"
                      icon={RefreshCw}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(() => {
                      const stockBajoList = monedaData.stockBajo || [];
                      const totalStockBajo = stockBajoList.length;
                      const totalPagesStockBajo = Math.ceil(totalStockBajo / STOCK_BAJO_PAGE_SIZE);
                      const paginatedStockBajo = stockBajoList.slice(
                        (stockBajoPage - 1) * STOCK_BAJO_PAGE_SIZE,
                        stockBajoPage * STOCK_BAJO_PAGE_SIZE
                      );

                      return (
                        <Card>
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                            <div>
                              <CardTitle>Productos con Bajo Existencias</CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {totalStockBajo} {totalStockBajo === 1 ? "producto" : "productos"} con inventario crítico
                              </p>
                            </div>
                            {totalPagesStockBajo > 1 && (
                              <div className="text-xs font-semibold text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md border border-border">
                                Pág. {stockBajoPage} de {totalPagesStockBajo}
                              </div>
                            )}
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {paginatedStockBajo.length > 0 ? (
                              paginatedStockBajo.map((p: any) => {
                                const estado = p.stock === 0 ? "Sin Existencias" : "Bajo Existencias";
                                return (
                                  <div
                                    key={p.id}
                                    className="flex items-center justify-between border-b border-border py-1.5 last:border-0"
                                  >
                                    <div>
                                      <div className="text-sm font-medium">{p.nombre}</div>
                                      <div className="font-mono text-xs text-muted-foreground">{p.codigo}</div>
                                    </div>
                                    <div className="text-right">
                                      <div
                                        className={cn(
                                          "font-mono text-sm font-bold",
                                          p.stock === 0 ? "text-danger" : "text-warning"
                                        )}
                                      >
                                        {p.stock} uds.
                                      </div>
                                      <StatusBadge status={estado} />
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="py-4 text-center text-sm text-muted-foreground">
                                Sin alertas de existencias
                              </div>
                            )}

                            {totalPagesStockBajo > 1 && (
                              <div className="pt-3 border-t border-border flex justify-center">
                                <Pagination
                                  currentPage={stockBajoPage}
                                  totalPages={totalPagesStockBajo}
                                  totalItems={totalStockBajo}
                                  pageSize={STOCK_BAJO_PAGE_SIZE}
                                  noun="productos"
                                  onPageChange={setStockBajoPage}
                                />
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })()}
                    <Card>
                      <CardHeader>
                        <CardTitle>Últimos Movimientos</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {monedaData.movimientosKardex && monedaData.movimientosKardex.length > 0 ? (
                          monedaData.movimientosKardex.slice(0, 5).map((k: any) => (
                            <div
                              key={k.id}
                              className="flex items-center justify-between border-b border-border py-1.5 last:border-0"
                            >
                              <div>
                                <div className="text-sm font-medium">{k.producto_nombre}</div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {k.motivo || k.tipo}
                                </div>
                              </div>
                              <div className="text-right">
                                <div
                                  className={cn(
                                    "font-mono text-sm font-bold",
                                    k.cantidad > 0 ? "text-success" : "text-danger"
                                  )}
                                >
                                  {k.cantidad > 0 ? "+" : ""}
                                  {k.cantidad}
                                </div>
                                <div className="text-xs text-muted-foreground">Saldo: {k.saldo_actual}</div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-4 text-center text-sm text-muted-foreground">
                            Sin movimientos recientes
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {/* ── SECCIÓN LOS 10 ── */}
              {active === "tops" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ShoppingCart size={18} /> Productos más vendidos ({moneda.codigo})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {monedaData.topProductos && monedaData.topProductos.length > 0 ? (
                        monedaData.topProductos.map((p: any, i: number) => (
                          <div
                            key={p.codigo}
                            className="flex items-center justify-between border-b border-border py-2 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-strong">
                                {i + 1}
                              </div>
                              <div>
                                <div className="text-sm font-medium">{p.nombre}</div>
                                <div className="text-xs text-muted-foreground">{p.codigo}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold">{p.cantidad_vendida} uds.</div>
                              <div className="text-xs text-success">{fmt(p.total_ingresos, moneda.codigo)}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          No hay datos suficientes
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Award size={18} /> Productos más rentables ({moneda.codigo})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {monedaData.topProductosRentables && monedaData.topProductosRentables.length > 0 ? (
                        monedaData.topProductosRentables.map((p: any, i: number) => (
                          <div
                            key={p.nombre}
                            className="flex items-center justify-between border-b border-border py-2 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-xs font-bold text-success-strong">
                                {i + 1}
                              </div>
                              <div className="text-sm font-medium">{p.nombre}</div>
                            </div>
                            <div className="font-mono text-sm font-bold text-success">
                              {fmt(p.ganancia, moneda.codigo)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          No hay datos suficientes
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users size={18} /> Mejores Clientes ({moneda.codigo})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {monedaData.mejoresClientes && monedaData.mejoresClientes.length > 0 ? (
                        monedaData.mejoresClientes.map((c: any, i: number) => (
                          <div
                            key={c.cliente_nombre + i}
                            className="flex items-center justify-between border-b border-border py-2 last:border-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                                {i + 1}
                              </div>
                              <div>
                                <div className="text-sm font-medium">{c.cliente_nombre}</div>
                                <div className="text-xs text-muted-foreground">{c.transacciones} compras</div>
                              </div>
                            </div>
                            <div className="text-right font-mono text-sm font-bold">
                              {fmt(c.total_comprado, moneda.codigo)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4 col-span-2">
                          No hay datos suficientes
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
