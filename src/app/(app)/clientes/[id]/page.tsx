"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Eye,
  HandCoins,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
  User,
  Wallet,
} from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Tr, HeaderConfig } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { VentaDetailModal } from "@/components/venta/venta-detail-modal";
import { VentaPagoModal } from "@/components/venta/venta-pago-modal";
import { RetornoDirectoModal } from "@/components/retorno/retorno-directo-modal";
import { RetornoDetailModal } from "@/components/retorno/retorno-detail-modal";
import { AbonoModal } from "@/components/credito/abono-modal";
import { ClienteModal } from "@/components/cliente/cliente-modal";
import {
  CreditoLimiteModal,
  type MonedaCredito,
} from "@/components/cliente/credito-limite-modal";
import { PagarDeudaModal } from "@/components/cliente/pagar-deuda-modal";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn, userInitials } from "@/lib/utils";
import { fmt, fmtDate, fmtHora } from "@/lib/format";

/* ─── Tipos ────────────────────────────────────────────────────────── */

interface ClienteDetalle {
  id: string;
  nombre: string;
  tipo: string;
  documento: string | null;
  email: string | null;
  telefono: string | null;
  ciudad: string | null;
  direccion: string | null;
  recibe_credito: boolean;
  limite_credito: number | string;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
  ventas_count: number | string;
  retornos_count: number | string;
  monedas: MonedaCredito[];
}

interface Stats {
  ventas_count: number;
  retornos_count: number;
  total_comprado_base: number;
  ticket_promedio_base: number;
  ultima_compra: string | null;
}

interface TopProducto {
  producto_id: number;
  codigo: string;
  nombre: string;
  cantidad_total: number;
  veces: number;
  monto_base: number;
}

interface DetalleResponse {
  cliente: ClienteDetalle;
  stats: Stats;
  top_productos: TopProducto[];
}

interface Venta {
  id: string;
  numero: string;
  cliente: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_pago: string | null;
  fecha: string;
  creado_en: string;
  moneda_id: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  metodo_pago_nombre: string | null;
  caja_nombre: string | null;
  subtotal: number | string;
  impuesto: number | string;
  total: number | string;
  total_base: number | string;
  estado: string;
  observaciones: string | null;
  items_count: number | string;
  credito_id?: string | null;
  credito_numero?: string | null;
  credito_monto_total?: number | string | null;
  credito_saldo?: number | string | null;
  credito_estado?: string | null;
}

interface VentaItem {
  id: string;
  venta_id: string;
  producto_id: number;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  precio_unit: number | string;
  precio_unit_base: number | string;
  subtotal: number | string;
  subtotal_base: number | string;
  presentacion_nombre?: string | null;
  presentacion_unidades?: number | null;
  cantidad_presentaciones?: number | string | null;
  precio_presentacion?: number | string | null;
}

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
  items_count: number | string;
  total_base: number | string;
  total_moneda?: number | string;
  moneda_codigo?: string | null;
  moneda_simbolo?: string | null;
}

interface RetornoItem {
  id: string;
  retorno_id: string;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  subtotal_base: number | string;
  subtotal_moneda?: number | string;
}

/* ─── Gradientes para el avatar por defecto (clientes sin foto) ─────── */

const GRADIENTES = [
  "from-sky-500 to-indigo-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-fuchsia-500 to-purple-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
];

function gradienteDe(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTES[h % GRADIENTES.length];
}

/* ─── Página ───────────────────────────────────────────────────────── */

export default function ClientePerfilPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [detalle, setDetalle] = useState<DetalleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noExiste, setNoExiste] = useState(false);

  const [tab, setTab] = useState("ventas");

  // Ventas
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [ventaItems, setVentaItems] = useState<VentaItem[]>([]);
  const [loadingVentas, setLoadingVentas] = useState(true);

  // Créditos
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [loadingCreditos, setLoadingCreditos] = useState(true);

  // Retornos
  const [retornos, setRetornos] = useState<Retorno[]>([]);
  const [retornoItems, setRetornoItems] = useState<RetornoItem[]>([]);
  const [loadingRetornos, setLoadingRetornos] = useState(true);

  // Modales
  const [editOpen, setEditOpen] = useState(false);
  const [creditoOpen, setCreditoOpen] = useState(false);
  const [creditoMoneda, setCreditoMoneda] = useState<string | undefined>(undefined);
  const [creditoOperacion, setCreditoOperacion] = useState<"add" | "remove">("add");

  const [pagoDeudaOpen, setPagoDeudaOpen] = useState(false);
  const [pagoDeudaMoneda, setPagoDeudaMoneda] = useState<string | undefined>(undefined);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedVenta, setSelectedVenta] = useState<Venta | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);
  const [pagoVenta, setPagoVenta] = useState<Venta | null>(null);
  const [retornoDirectoOpen, setRetornoDirectoOpen] = useState(false);
  const [retornoVenta, setRetornoVenta] = useState<Venta | null>(null);

  const [abonoOpen, setAbonoOpen] = useState(false);
  const [selectedCredito, setSelectedCredito] = useState<Credito | null>(null);

  const [retornoDetailOpen, setRetornoDetailOpen] = useState(false);
  const [selectedRetorno, setSelectedRetorno] = useState<Retorno | null>(null);

  const fetchDetalle = useCallback(async () => {
    try {
      const res = await fetch(`/api/clientes/${id}`);
      if (res.status === 404) {
        setNoExiste(true);
        return;
      }
      if (res.ok) setDetalle(await res.json());
    } catch (error) {
      console.error("Error al obtener el cliente:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchVentas = useCallback(async () => {
    setLoadingVentas(true);
    try {
      const res = await fetch(`/api/ventas?cliente_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setVentas(data.ventas || []);
        setVentaItems(data.items || []);
      }
    } catch (error) {
      console.error("Error al obtener ventas:", error);
    } finally {
      setLoadingVentas(false);
    }
  }, [id]);

  const fetchCreditos = useCallback(async () => {
    setLoadingCreditos(true);
    try {
      const res = await fetch(`/api/creditos?cliente_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setCreditos(data.creditos || []);
      }
    } catch (error) {
      console.error("Error al obtener créditos:", error);
    } finally {
      setLoadingCreditos(false);
    }
  }, [id]);

  const fetchRetornos = useCallback(async () => {
    setLoadingRetornos(true);
    try {
      const res = await fetch(`/api/retornos?cliente_id=${id}`);
      if (res.ok) {
        const data = await res.json();
        setRetornos(data.retornos || []);
        setRetornoItems(data.items || []);
      }
    } catch (error) {
      console.error("Error al obtener retornos:", error);
    } finally {
      setLoadingRetornos(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchDetalle();
    fetchVentas();
    fetchCreditos();
    fetchRetornos();

    const refreshAll = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchDetalle();
      fetchVentas();
      fetchCreditos();
      fetchRetornos();
    };

    const interval = setInterval(refreshAll, 8000);
    window.addEventListener("focus", refreshAll);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshAll);
    };
  }, [id, fetchDetalle, fetchVentas, fetchCreditos, fetchRetornos]);

  /* ─── Derivados ─────────────────────────────────────────────────── */

  const cliente = detalle?.cliente ?? null;
  const stats = detalle?.stats ?? null;

  const clienteParaModal = useMemo(() => {
    if (!cliente) return null;
    return {
      ...cliente,
      limites_credito: cliente.monedas.map((m) => ({
        moneda_id: m.moneda_id,
        codigo: m.codigo,
        simbolo: m.simbolo,
        es_base: m.es_base,
        limite: m.limite,
      })),
    };
  }, [cliente]);

  const selectedVentaItems = useMemo(
    () => (selectedVenta ? ventaItems.filter((i) => i.venta_id === selectedVenta.id) : []),
    [selectedVenta, ventaItems]
  );

  const retornoVentaItems = useMemo(
    () =>
      retornoVenta
        ? ventaItems
            .filter((i) => i.venta_id === retornoVenta.id)
            .map((i) => ({
              producto_id: i.producto_id ?? 0,
              producto_nombre: i.producto_nombre,
              producto_codigo: i.producto_codigo,
              cantidad: i.cantidad,
              precio_unit: i.precio_unit,
              precio_unit_base: i.precio_unit_base,
            }))
        : [],
    [retornoVenta, ventaItems]
  );

  const selectedRetornoItems = useMemo(
    () => (selectedRetorno ? retornoItems.filter((i) => i.retorno_id === selectedRetorno.id) : []),
    [selectedRetorno, retornoItems]
  );

  /* ─── Acciones ──────────────────────────────────────────────────── */

  const openCredito = (monedaId?: string, operacion: "add" | "remove" = "add") => {
    setCreditoMoneda(monedaId);
    setCreditoOperacion(operacion);
    setCreditoOpen(true);
  };

  const openPagoDeuda = (monedaId?: string) => {
    setPagoDeudaMoneda(monedaId);
    setPagoDeudaOpen(true);
  };

  const handleDeleteVenta = async (ventaId: string, numero: string) => {
    if (
      !(await confirm({
        title: "Eliminar Venta",
        message: `¿Eliminar/anular venta ${numero}? Esto repondrá las existencias.`,
        variant: "destructive",
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/ventas?id=${ventaId}`, { method: "DELETE" });
      if (res.ok) {
        toast("Venta eliminada/anulada exitosamente", "success");
        setDetailOpen(false);
        setSelectedVenta(null);
        fetchVentas();
        fetchDetalle();
      } else {
        const data = await res.json();
        toast(data.error || "Error al eliminar", "error");
      }
    } catch {
      toast("Error al eliminar venta", "error");
    }
  };

  const handleDeleteRetorno = async (retornoId: string, numero: string) => {
    if (
      !(await confirm({
        title: "Eliminar Retorno",
        message: `¿Eliminar el retorno ${numero}?`,
        variant: "destructive",
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/retornos?id=${retornoId}`, { method: "DELETE" });
      if (res.ok) {
        toast("Retorno eliminado correctamente", "success");
        setRetornoDetailOpen(false);
        setSelectedRetorno(null);
        fetchRetornos();
        fetchDetalle();
      } else {
        const data = await res.json();
        toast(data.error || "Error al eliminar retorno", "error");
      }
    } catch {
      toast("Error al eliminar retorno", "error");
    }
  };

  /* ─── Estados de carga / error ──────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        Cargando perfil...
      </div>
    );
  }

  if (noExiste || !cliente) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-lg font-medium text-foreground">Cliente no encontrado</p>
        <p className="mt-1 text-sm text-muted-foreground">
          El cliente que buscas no existe o fue eliminado.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/clientes")}>
          <ArrowLeft size={14} /> Volver a clientes
        </Button>
      </div>
    );
  }

  const gradiente = gradienteDe(cliente.id);

  const tieneDeuda = cliente.monedas.some((m) => m.deuda > 0.005);

  const tabs = [
    { id: "ventas", label: `Ventas (${ventas.length})` },
    { id: "creditos", label: `Créditos y abonos (${creditos.length})` },
    { id: "retornos", label: `Retornos (${retornos.length})` },
    { id: "productos", label: "Productos más comprados" },
  ];

  /* ─── Cabeceras de cada tabla ───────────────────────────────────── */

  const ventaHeaders: HeaderConfig[] = [
    { key: "numero", label: "N° Venta" },
    { key: "tipo_pago", label: "Tipo" },
    { key: "fecha", label: "Fecha" },
    { key: "items_count", label: "Ítems" },
    { key: "total", label: "Total" },
    { key: "metodo_pago_nombre", label: "Método Pago" },
    { key: "estado", label: "Estado" },
    "Retorno",
    "Acciones",
  ];

  const creditoHeaders: HeaderConfig[] = [
    { key: "numero", label: "N° Crédito" },
    { key: "fecha", label: "Fecha" },
    { key: "venta_numero", label: "Venta" },
    { key: "monto_total", label: "Total" },
    { key: "abonado", label: "Abonado" },
    { key: "saldo", label: "Saldo" },
    { key: "estado", label: "Estado" },
    "Acción",
  ];

  const retornoHeaders: HeaderConfig[] = [
    { key: "numero", label: "N°" },
    { key: "venta_numero", label: "Referencia" },
    { key: "fecha", label: "Fecha" },
    { key: "items_count", label: "Ítems" },
    { key: "total_moneda", label: "Total" },
    { key: "estado", label: "Estado" },
    "Acciones",
  ];

  const productoHeaders: HeaderConfig[] = [
    { key: "codigo", label: "Código" },
    { key: "nombre", label: "Producto" },
    { key: "cantidad_total", label: "Unidades" },
    { key: "veces", label: "N° Compras" },
    { key: "monto_base", label: "Monto (USD)" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Encabezado ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/clientes")}
            aria-label="Volver a clientes"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black tracking-tight text-foreground">
              {cliente.nombre}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={cliente.tipo || "Persona Natural"} />
              <StatusBadge status={cliente.activo ? "Activo" : "Inactivo"} />
              {cliente.recibe_credito ? (
                <Badge variant="info" label="Recibe crédito" icon={<CreditCard size={11} />} />
              ) : (
                <Badge variant="neutral" label="Sin crédito" />
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil size={13} /> Editar
          </Button>
        </div>
      </div>

      {/* ─── Fila superior: 3 tarjetas ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Foto / fondo */}
        <Card className="overflow-hidden lg:col-span-3">
          <div className={cn("relative h-14 bg-gradient-to-br", gradiente)}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.35),transparent_45%)]" />
            <div
              className={cn(
                "absolute bottom-0 left-4 flex h-14 w-14 translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-black text-white shadow-lg ring-4 ring-card",
                gradiente
              )}
            >
              {userInitials(cliente.nombre)}
            </div>
          </div>
          <div className="px-4 pt-12 pb-3">
            <div className="truncate font-mono text-[13px] font-semibold text-foreground">
              {cliente.documento || "Sin documento"}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Cliente desde {fmtDate(cliente.creado_en)}
            </div>
            <div className="mt-3 grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 pt-2.5 text-center">
              <div className="min-w-0 px-1">
                <div className="font-mono text-sm font-bold text-foreground">
                  {cliente.ventas_count ?? 0}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ventas</div>
              </div>
              <div className="min-w-0 px-1">
                <div className="font-mono text-sm font-bold text-foreground">
                  {cliente.retornos_count ?? 0}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Retornos</div>
              </div>
              <div className="min-w-0 px-1">
                <div className="truncate font-mono text-sm font-bold text-foreground">
                  {stats ? fmt(stats.ticket_promedio_base, "USD") : "—"}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ticket</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Datos del cliente */}
        <Card className="lg:col-span-4">
          <CardHeader className="px-4 py-2.5">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <User size={13} /> Datos del cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <FieldCompact label="Documento" value={cliente.documento || "—"} />
              <FieldCompact label="Teléfono" value={cliente.telefono || "—"} />
              <FieldCompact label="Email" value={cliente.email || "—"} />
              <FieldCompact label="Ciudad" value={cliente.ciudad || "—"} />
              <FieldCompact
                label="Última compra"
                value={stats?.ultima_compra ? fmtDate(stats.ultima_compra) : "Sin compras"}
              />
              <FieldCompact
                label="Total comprado"
                value={stats ? fmt(stats.total_comprado_base, "USD") : "—"}
              />
            </div>
            <div className="mt-3 border-t border-border/40 pt-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Dirección
              </div>
              <div
                className="mt-0.5 truncate text-[13px] font-medium text-foreground"
                title={cliente.direccion || "—"}
              >
                {cliente.direccion || "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deuda y crédito */}
        <Card className="lg:col-span-5">
          <CardHeader className="px-4 py-2.5">
            <CardTitle className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <Wallet size={15} /> Deuda y crédito
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={() => openCredito(undefined, "add")}
                title="Añadir o quitar crédito por moneda"
              >
                <Plus size={13} /> Crédito
              </Button>
              <button
                type="button"
                onClick={() => openPagoDeuda()}
                disabled={!tieneDeuda}
                title={
                  tieneDeuda
                    ? "Pagar la deuda del cliente (elige la moneda en el modal)"
                    : "Sin deuda pendiente"
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-600 px-3.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-red-700 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                <HandCoins size={12} /> Pagar deuda
              </button>
            </div>
          </CardHeader>
          {cliente.monedas.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No hay monedas activas configuradas.
            </p>
          ) : (
            <div className="max-h-[240px] overflow-y-auto">
              <div className="grid grid-cols-[minmax(0,auto)_1fr_1fr] items-center gap-3 border-b border-border/50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <span>Moneda</span>
                <span className="text-right">Crédito</span>
                <span className="text-right">Deuda</span>
              </div>
              <div className="divide-y divide-border/40">
                {cliente.monedas.map((m) => {
                  const excedido = m.limite > 0 && m.deuda > m.limite;
                  return (
                    <div
                      key={m.moneda_id}
                      className="grid grid-cols-[minmax(0,auto)_1fr_1fr] items-center gap-3 px-4 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="whitespace-nowrap font-mono text-sm font-bold text-foreground">
                          {m.codigo}
                        </span>
                        {m.es_base && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            base
                          </span>
                        )}
                        {excedido && (
                          <span
                            title="La deuda supera el límite de crédito"
                            className="shrink-0 text-danger"
                          >
                            <AlertTriangle size={13} />
                          </span>
                        )}
                      </div>
                      <span className="truncate text-right font-mono text-sm font-semibold text-foreground">
                        {fmt(m.limite, m.codigo)}
                      </span>
                      <span
                        className={cn(
                          "truncate text-right font-mono text-sm font-semibold",
                          m.deuda > 0 ? "text-danger" : "text-muted-foreground"
                        )}
                      >
                        {fmt(m.deuda, m.codigo)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ─── Fila inferior: pestañas ────────────────────────────── */}
      <div>
        <div className="mb-4">
          <Tabs
            items={tabs}
            value={tab}
            onChange={setTab}
            className="w-full flex-wrap sm:w-fit"
          />
        </div>

        {/* Ventas */}
        {tab === "ventas" && (
          <>
            {loadingVentas ? (
              <TabLoading />
            ) : ventas.length === 0 ? (
              <TabEmpty
                icon={ShoppingCart}
                title="Sin ventas registradas"
                hint="Este cliente aún no tiene facturas en el sistema."
              />
            ) : (
              <Table headers={ventaHeaders}>
                {ventas.map((v) => (
                  <Tr key={v.id}>
                    <Td mono>{v.numero}</Td>
                    <Td>
                      <StatusBadge
                        status={v.tipo_pago === "Credito" ? "Crédito" : "Contado"}
                        size="pill"
                      />
                    </Td>
                    <Td>
                      <div className="leading-tight">
                        <div className="whitespace-nowrap">{fmtDate(v.fecha)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtHora(v.creado_en)}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono">{v.items_count}</span>
                    </Td>
                    <Td>
                      <span className="font-mono font-semibold">
                        {fmt(v.total, v.moneda_codigo)}
                      </span>
                    </Td>
                    <Td>{v.metodo_pago_nombre || "—"}</Td>
                    <Td>
                      {v.estado === "Anulada" ? (
                        <StatusBadge status={v.estado} size="pill" />
                      ) : v.tipo_pago === "Credito" &&
                        parseFloat(String(v.credito_saldo ?? 0)) > 0.009 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPagoVenta(v);
                            setPagoOpen(true);
                          }}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-red-700 active:scale-95"
                          title={`Abonar a la venta (Saldo: ${fmt(
                            parseFloat(String(v.credito_saldo ?? 0)),
                            v.moneda_codigo
                          )})`}
                        >
                          <DollarSign size={13} />
                          Pagar
                        </button>
                      ) : (
                        <StatusBadge status="Pagada" size="pill" icon={<Check size={13} />} />
                      )}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => {
                          setRetornoVenta(v);
                          setRetornoDirectoOpen(true);
                        }}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                        title="Retornar productos"
                        aria-label="Retornar productos"
                      >
                        <RotateCcw size={13} />
                        Retornar
                      </button>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedVenta(v);
                            setDetailOpen(true);
                          }}
                          aria-label="Ver"
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleDeleteVenta(v.id, v.numero)}
                          aria-label="Eliminar"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </>
        )}

        {/* Créditos y abonos */}
        {tab === "creditos" && (
          <>
            {loadingCreditos ? (
              <TabLoading />
            ) : creditos.length === 0 ? (
              <TabEmpty
                icon={HandCoins}
                title="Sin créditos"
                hint="Este cliente no tiene créditos registrados."
              />
            ) : (
              <Table headers={creditoHeaders}>
                {creditos.map((c) => {
                  const saldo = parseFloat(String(c.saldo));
                  return (
                    <Tr key={c.id}>
                      <Td mono>{c.numero}</Td>
                      <Td>{fmtDate(c.fecha)}</Td>
                      <Td mono>{c.venta_numero || "—"}</Td>
                      <Td>
                        <span className="font-mono">{fmt(c.monto_total, c.moneda_codigo)}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-success-strong">
                          {fmt(c.abonado, c.moneda_codigo)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            "font-mono font-semibold",
                            saldo > 0 ? "text-danger" : "text-success-strong"
                          )}
                        >
                          {fmt(c.saldo, c.moneda_codigo)}
                        </span>
                      </Td>
                      <Td>
                        <StatusBadge status={c.estado} />
                      </Td>
                      <Td>
                        {c.estado !== "Pagado" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCredito(c);
                              setAbonoOpen(true);
                            }}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-600 active:scale-95"
                          >
                            <DollarSign size={13} />
                            Registrar Abono
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CheckCircle2 size={13} /> Saldado
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </>
        )}

        {/* Retornos */}
        {tab === "retornos" && (
          <>
            {loadingRetornos ? (
              <TabLoading />
            ) : retornos.length === 0 ? (
              <TabEmpty
                icon={RotateCcw}
                title="Sin retornos"
                hint="Este cliente no ha devuelto productos."
              />
            ) : (
              <Table headers={retornoHeaders}>
                {retornos.map((r) => (
                  <Tr key={r.id}>
                    <Td mono>{r.numero}</Td>
                    <Td mono>{r.venta_numero || "—"}</Td>
                    <Td>{fmtDate(r.fecha)}</Td>
                    <Td>
                      <span className="font-mono">{r.items_count}</span>
                    </Td>
                    <Td>
                      <span
                        className="font-mono font-semibold"
                        title={`Base: ${fmt(r.total_base, "USD")}`}
                      >
                        {fmt(r.total_moneda ?? r.total_base, r.moneda_codigo || "USD")}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={r.estado} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedRetorno(r);
                            setRetornoDetailOpen(true);
                          }}
                          aria-label="Ver"
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleDeleteRetorno(r.id, r.numero)}
                          aria-label="Eliminar"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </>
        )}

        {/* Productos más comprados */}
        {tab === "productos" && (
          <>
            {!detalle || detalle.top_productos.length === 0 ? (
              <TabEmpty
                icon={Package}
                title="Sin datos de productos"
                hint="Cuando el cliente compre, aquí verás lo que más lleva."
              />
            ) : (
              <Table headers={productoHeaders}>
                {detalle.top_productos.map((p) => (
                  <Tr key={p.producto_id}>
                    <Td mono>{p.codigo}</Td>
                    <Td>
                      <span className="font-medium">{p.nombre}</span>
                    </Td>
                    <Td>
                      <span className="font-mono font-semibold">{p.cantidad_total}</span>
                    </Td>
                    <Td>
                      <span className="font-mono">{p.veces}</span>
                    </Td>
                    <Td>
                      <span className="font-mono font-semibold">{fmt(p.monto_base, "USD")}</span>
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </>
        )}
      </div>

      {/* ─── Modales ────────────────────────────────────────────── */}

      <ClienteModal
        open={editOpen}
        mode="edit"
        cliente={clienteParaModal as any}
        onClose={() => setEditOpen(false)}
        onSuccess={(msg) => {
          toast(msg, "success");
          fetchDetalle();
        }}
      />

      <CreditoLimiteModal
        open={creditoOpen}
        clienteId={cliente.id}
        clienteNombre={cliente.nombre}
        monedas={cliente.monedas}
        monedaInicial={creditoMoneda}
        operacionInicial={creditoOperacion}
        onClose={() => setCreditoOpen(false)}
        onSuccess={(msg) => {
          toast(msg, "success");
          fetchDetalle();
        }}
      />

      <VentaDetailModal
        open={detailOpen}
        venta={selectedVenta}
        items={selectedVentaItems}
        onClose={() => {
          setDetailOpen(false);
          setSelectedVenta(null);
        }}
        onDelete={(vid) => handleDeleteVenta(vid, selectedVenta?.numero ?? "")}
      />

      <VentaPagoModal
        open={pagoOpen}
        venta={pagoVenta}
        onClose={() => {
          setPagoOpen(false);
          setPagoVenta(null);
        }}
        onSuccess={() => {
          fetchVentas();
          fetchCreditos();
          fetchDetalle();
        }}
      />

      <RetornoDirectoModal
        open={retornoDirectoOpen}
        tipo="Cliente"
        referenciaId={retornoVenta?.id ?? null}
        referenciaNumero={retornoVenta?.numero ?? ""}
        clienteId={retornoVenta?.cliente_id ?? null}
        tipoPago={retornoVenta?.tipo_pago}
        items={retornoVentaItems}
        monedaCodigo={retornoVenta?.moneda_codigo}
        onClose={() => {
          setRetornoDirectoOpen(false);
          setRetornoVenta(null);
        }}
        onSuccess={(msg) => {
          setRetornoDirectoOpen(false);
          setRetornoVenta(null);
          fetchVentas();
          fetchRetornos();
          fetchDetalle();
          toast(msg, "success");
        }}
      />

      <AbonoModal
        open={abonoOpen}
        credito={selectedCredito}
        onClose={() => {
          setAbonoOpen(false);
          setSelectedCredito(null);
        }}
        onSuccess={(msg) => {
          toast(msg, "success");
          fetchCreditos();
          fetchVentas();
          fetchDetalle();
        }}
      />

      <PagarDeudaModal
        open={pagoDeudaOpen}
        clienteId={cliente.id}
        clienteNombre={cliente.nombre}
        deudas={cliente.monedas.map((m) => ({
          moneda_id: m.moneda_id,
          codigo: m.codigo,
          deuda: m.deuda,
        }))}
        creditos={creditos
          .filter((cr) => parseFloat(String(cr.saldo)) > 0.009)
          .map((cr) => ({
            id: cr.id,
            numero: cr.numero,
            fecha: cr.fecha,
            saldo: cr.saldo,
            moneda_id: cr.moneda_id,
            moneda_codigo: cr.moneda_codigo,
          }))}
        monedaInicial={pagoDeudaMoneda}
        onClose={() => setPagoDeudaOpen(false)}
        onSuccess={(msg) => {
          setPagoDeudaOpen(false);
          toast(msg, "success");
          fetchCreditos();
          fetchVentas();
          fetchDetalle();
        }}
      />

      <RetornoDetailModal
        open={retornoDetailOpen}
        retorno={selectedRetorno}
        items={selectedRetornoItems}
        onClose={() => {
          setRetornoDetailOpen(false);
          setSelectedRetorno(null);
        }}
        onDelete={(rid) => handleDeleteRetorno(rid, selectedRetorno?.numero ?? "")}
      />
    </div>
  );
}

/* ─── Auxiliares ───────────────────────────────────────────────────── */

function FieldCompact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function TabLoading() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-card py-16 text-sm text-muted-foreground">
      Cargando...
    </div>
  );
}

function TabEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <Icon size={28} className="mb-3 text-muted-foreground/40" />
      <p className="text-lg font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
