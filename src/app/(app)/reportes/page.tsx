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
} from "lucide-react";
import { CategoryPieChart, MonthlyBarChart } from "@/components/charts/charts";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/ui/date-range";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { CHART_COLORS } from "@/lib/chart-colors";
import { exportarReporteExcel, exportarReportePDF } from "@/lib/export-reportes";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "ventas", label: "Ventas" },
  { id: "compras", label: "Compras" },
  { id: "inventario", label: "Inventario" },
  { id: "finanzas", label: "Finanzas" },
  { id: "tops", label: "Los 10" },
];

export default function ReportesPage() {
  const [active, setActive] = useState("ventas");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

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

  if (loading) {
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
    <div>
      <PageHeader
        title="Reportes"
        subtitle="Análisis y estadísticas del negocio"
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Tabs items={tabs} value={active} onChange={setActive} />
        <DateRangeFilter
          desde={fechaInicio}
          hasta={fechaFin}
          onChange={(desde, hasta) => {
            setFechaInicio(desde);
            setFechaFin(hasta);
          }}
        />
      </div>

      {data && Object.entries(data).map(([codigoMoneda, monedaData]: [string, any]) => {
        const moneda = monedaData.moneda;
        return (
          <div key={codigoMoneda} className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="rounded bg-muted px-2 py-1 font-mono text-xs font-bold">
                {moneda.simbolo} {moneda.codigo}
              </span>
              {moneda.es_base && (
                <span className="rounded bg-purple-soft px-2 py-0.5 text-xs font-medium text-purple-strong">
                  Base
                </span>
              )}
            </div>

            {active === "ventas" && monedaData.resumen && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <KpiCard 
                    label="Total Ventas" 
                    value={fmt(monedaData.resumen.total, moneda.codigo)} 
                    sub={`${monedaData.resumen.count} transacciones`} 
                    icon={TrendingUp} 
                  />
                  <KpiCard 
                    label="Ticket Promedio" 
                    value={monedaData.resumen.count > 0 ? fmt(monedaData.resumen.total / monedaData.resumen.count, moneda.codigo) : fmt(0, moneda.codigo)} 
                    sub="Por transacción" 
                    icon={CreditCard} 
                  />
                  <KpiCard 
                    label="Impuestos" 
                    value={fmt(monedaData.resumen.impuesto || 0, moneda.codigo)} 
                    sub="IVA 16%" 
                    icon={FileText} 
                  />
                </div>
                {monedaData.ventasDiarias && monedaData.ventasDiarias.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Ventas por Día</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <MonthlyBarChart 
                        data={monedaData.ventasDiarias.map((d: any) => ({
                          mes: d.fecha,
                          ventas: parseFloat(d.total),
                        }))} 
                        dataKey="ventas" 
                        name="Ventas" 
                        color={CHART_COLORS[0]} 
                      />
                    </CardContent>
                  </Card>
                )}
                {monedaData.ventasPorMetodo && monedaData.ventasPorMetodo.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Ventas por Método de Pago</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {monedaData.ventasPorMetodo.map((m: any, i: number) => (
                        <div key={m.nombre || i} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            <span className="text-sm font-medium">{m.nombre || "Sin método"}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm font-semibold">{fmt(m.total, moneda.codigo)}</div>
                            <div className="text-xs text-muted-foreground">{m.count} ventas</div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {active === "compras" && monedaData.resumen && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <KpiCard 
                    label="Total Compras" 
                    value={fmt(monedaData.resumen.total, moneda.codigo)} 
                    sub={`${monedaData.resumen.count} órdenes`} 
                    icon={ShoppingCart} 
                  />
                  <KpiCard 
                    label="Órdenes" 
                    value={monedaData.resumen.count.toString()} 
                    sub="Órdenes de compra" 
                    icon={FileText} 
                  />
                  <KpiCard 
                    label="Promedio por Orden" 
                    value={monedaData.resumen.count > 0 ? fmt(monedaData.resumen.total / monedaData.resumen.count, moneda.codigo) : fmt(0, moneda.codigo)} 
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
                        <div key={p.nombre} className="flex items-center justify-between border-b border-border py-2 last:border-0">
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

            {active === "inventario" && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
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
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Productos con Bajo Existencias</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {monedaData.stockBajo && monedaData.stockBajo.length > 0 ? (
                        monedaData.stockBajo.map((p: any) => {
                          const estado = p.stock === 0 ? "Sin Existencias" : "Bajo Existencias";
                          return (
                            <div
                              key={p.id}
                              className="flex items-center justify-between border-b border-border py-1.5 last:border-0"
                            >
                              <div>
                                <div className="text-sm font-medium">{p.nombre}</div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {p.codigo}
                                </div>
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
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Últimos Movimientos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {monedaData.movimientosKardex && monedaData.movimientosKardex.length > 0 ? (
                        monedaData.movimientosKardex.slice(0, 5).map((k: any) => (
                          <div key={k.id} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
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
                                {k.cantidad > 0 ? "+" : ""}{k.cantidad}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Saldo: {k.saldo_actual}
                              </div>
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

            {active === "finanzas" && monedaData.rentabilidad && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <KpiCard 
                    label="Ingresos por Ventas" 
                    value={fmt(monedaData.rentabilidad.ingresos, moneda.codigo)} 
                    sub="Total cobrado" 
                    icon={DollarSign} 
                  />
                  <KpiCard 
                    label="Ganancia Bruta" 
                    value={fmt(monedaData.rentabilidad.gananciaBruta, moneda.codigo)} 
                    sub="Ingresos menos costo de mercancía" 
                    icon={Activity} 
                  />
                  <KpiCard 
                    label="Cuentas por Cobrar" 
                    value={fmt(monedaData.cuentasPorCobrar || 0, moneda.codigo)} 
                    sub="Deuda acumulada de clientes" 
                    icon={FileText} 
                  />
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Resumen Financiero ({moneda.codigo})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between items-center border-b border-border py-2">
                        <span className="font-medium">Total Ingresos Netos</span>
                        <span className="font-mono text-lg text-success font-semibold">+{fmt(monedaData.rentabilidad.ingresos, moneda.codigo)}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-border py-2">
                        <span className="font-medium">Costo de Mercancía Vendida</span>
                        <span className="font-mono text-lg text-danger font-semibold">-{fmt(monedaData.rentabilidad.costos, moneda.codigo)}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-border py-2 bg-muted/30 px-3 rounded-lg">
                        <span className="font-bold text-lg">Ganancia Bruta</span>
                        <span className="font-mono text-xl font-bold text-primary">{fmt(monedaData.rentabilidad.gananciaBruta, moneda.codigo)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-4">
                        * Nota: El costo se calcula en base al costo base actual del producto equivalente a la fecha de la venta.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {active === "tops" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ShoppingCart size={18} /> Productos más vendidos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {monedaData.topProductos && monedaData.topProductos.length > 0 ? (
                      monedaData.topProductos.map((p: any, i: number) => (
                        <div key={p.codigo} className="flex items-center justify-between border-b border-border py-2 last:border-0">
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
                      <div className="text-sm text-muted-foreground text-center py-4">No hay datos suficientes</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Award size={18} /> Productos más rentables</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {monedaData.topProductosRentables && monedaData.topProductosRentables.length > 0 ? (
                      monedaData.topProductosRentables.map((p: any, i: number) => (
                        <div key={p.nombre} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-xs font-bold text-success-strong">
                              {i + 1}
                            </div>
                            <div className="text-sm font-medium">{p.nombre}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Ganancia:</div>
                            <div className="font-mono font-bold text-primary">{fmt(p.ganancia, moneda.codigo)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-4">No hay datos suficientes</div>
                    )}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Users size={18} /> Mejores Clientes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {monedaData.mejoresClientes && monedaData.mejoresClientes.length > 0 ? (
                      monedaData.mejoresClientes.map((c: any, i: number) => (
                        <div key={c.cliente_nombre + i} className="flex items-center justify-between border-b border-border py-2 last:border-0">
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
                      <div className="text-sm text-muted-foreground text-center py-4 col-span-2">No hay datos suficientes</div>
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
