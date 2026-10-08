"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertCircle, Package, ShoppingCart, TrendingUp, Truck } from "lucide-react";
import { CategoryPieChart, RevenueAreaChart } from "@/components/charts/charts";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/ui/date-range";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { chartColor } from "@/lib/chart-colors";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Moneda {
  id: number;
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  decimales: number;
  es_base: boolean;
  activo: boolean;
}

export default function DashboardPage() {
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [selectedCodigo, setSelectedCodigo] = useState<string>("");
  const [dashboardData, setDashboardData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  const hasRango = Boolean(fechaInicio && fechaFin);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fechaInicio) params.set("fecha_inicio", fechaInicio);
      if (fechaFin) params.set("fecha_fin", fechaFin);
      const qs = params.toString();

      const [monedasRes, dataRes] = await Promise.all([
        fetch("/api/monedas"),
        fetch(`/api/dashboard${qs ? `?${qs}` : ""}`),
      ]);

      if (monedasRes.ok) {
        const data = await monedasRes.json();
        setMonedas(data);
        if (data.length > 0 && !selectedCodigo) {
          setSelectedCodigo(data[0].codigo);
        }
      }

      if (dataRes.ok) {
        const data = await dataRes.json();
        setDashboardData(data);
      }
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const moneda = monedas.find((m) => m.codigo === selectedCodigo);
  const data = selectedCodigo ? dashboardData[selectedCodigo] : null;

  if (!moneda || !data) {
    return (
      <div>
        <PageHeader title="Panel de control" subtitle="Resumen general" />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          No hay monedas activas configuradas
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Panel de control"
        subtitle="Resumen general"
        action={
          <div className="flex items-center gap-1">
            {monedas.map((m) => (
              <button
                key={m.codigo}
                onClick={() => setSelectedCodigo(m.codigo)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  m.codigo === selectedCodigo
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                {m.simbolo} {m.codigo}
                {m.es_base && <span className="ml-1 opacity-60">Base</span>}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge label={`${moneda.simbolo} ${moneda.codigo}`} variant={moneda.es_base ? "purple" : "info"} />
          <span className="text-xs text-muted-foreground">
            {moneda.es_base ? "Moneda base" : `Tasa: ${parseFloat(String(moneda.tasa)).toFixed(4)}`}
          </span>
        </div>
        <DateRangeFilter
          desde={fechaInicio}
          hasta={fechaFin}
          onChange={(desde, hasta) => {
            setFechaInicio(desde);
            setFechaFin(hasta);
          }}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label={hasRango ? "Ventas del Período" : "Ventas del Mes"}
          value={fmt(data.ventasMes.total, moneda.codigo)}
          sub={hasRango ? `${data.ventasMes.count} transacciones en el período` : `${data.ventasMes.count} transacciones`}
          icon="TrendingUp"
          delay={0.05}
        />
        <KpiCard
          label={hasRango ? "Compras del Período" : "Compras del Mes"}
          value={fmt(data.comprasMes.total, moneda.codigo)}
          sub={hasRango ? `${data.comprasMes.count} órdenes en el período` : `${data.comprasMes.count} órdenes`}
          icon="ShoppingCart"
          delay={0.1}
        />
        <KpiCard
          label="Productos con Existencias"
          value={data.productosStock.toString()}
          sub="Códigos activos"
          icon="Package"
          delay={0.15}
        />
        <KpiCard
          label="Proveedores Activos"
          value={data.proveedoresActivos.toString()}
          sub="registrados"
          icon="Truck"
          delay={0.2}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 hover-lift" accent>
          <CardHeader>
            <CardTitle>Ventas Mensuales</CardTitle>
            <Badge label={moneda.codigo} variant="neutral" className="font-mono" />
          </CardHeader>
          <CardContent>
            {data.ventasMensuales.length > 0 ? (
              <div className="h-[220px]">
                <RevenueAreaChart
                  data={data.ventasMensuales.map((v: any) => ({
                    mes: v.mes,
                    ventas: parseFloat(v.ventas),
                    compras: 0,
                  }))}
                />
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                Sin datos de ventas
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover-lift" accent>
          <CardHeader>
            <CardTitle>Existencias por Categoría</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const stockData = data.stockPorCategoria.map((d: any) => ({
                name: d.nombre,
                value: Number(d.value),
              }));
              return stockData.length > 0 ? (
                <>
                  <div className="h-[220px]">
                    <CategoryPieChart data={stockData} />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {stockData.slice(0, 4).map((d: { name: string; value: number }, i: number) => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: chartColor(i) }}
                          />
                          <span className="text-muted-foreground">{d.name}</span>
                        </div>
                        <span className="font-mono font-medium text-foreground">
                          {d.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-48 items-center justify-center text-muted-foreground">
                  Sin datos de existencias
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="hover-lift" accent>
          <CardHeader>
            <CardTitle>Últimas Ventas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {data.ventasRecientes.length > 0 ? (
              data.ventasRecientes.map((v: any) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between border-b border-border/60 py-2.5 last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {v.cliente || "Consumidor Final"}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{v.numero}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold text-foreground">
                      {fmt(v.total, v.moneda_codigo)}
                    </div>
                    <StatusBadge status={v.estado} />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Sin ventas registradas
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover-lift" accent>
          <CardHeader>
            <CardTitle>Alertas de Existencias</CardTitle>
            <span className="text-xs font-semibold text-danger">
              {data.alertasStock.length}{" "}
              {data.alertasStock.length === 1 ? "crítico" : "críticos"}
            </span>
          </CardHeader>
          <CardContent className="space-y-0">
            {data.alertasStock.length > 0 ? (
              data.alertasStock.map((p: any) => {
                const estado = p.stock === 0 ? "Sin Existencias" : "Bajo Existencias";
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0"
                  >
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-sm",
                        p.stock === 0 ? "bg-danger-soft" : "bg-warning-soft"
                      )}
                    >
                      <AlertCircle
                        size={13}
                        className={p.stock === 0 ? "text-danger" : "text-warning"}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {p.nombre}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.codigo}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold text-foreground">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
