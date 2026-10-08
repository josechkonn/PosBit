"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Hash,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
  FileText,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { aBase, convertir, redondear, tasaUsd, tasaUsdDocumento } from "@/lib/money";
import { ProductoModal } from "@/components/producto/producto-modal";
import { MetodoPagoSelect } from "@/components/ui/metodo-pago-select";

/* ───── Types ───── */

interface Proveedor {
  id: number;
  nombre: string;
  contacto: string | null;
  rif: string | null;
  activo: boolean;
}

interface MonedaInfo {
  id: number;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: number | null;
  decimales?: number;
  es_base: boolean;
  activo?: boolean;
}

interface MetodoPago {
  id: number;
  nombre: string;
  tipo: string;
  caja_id: number | null;
  caja_nombre: string | null;
  moneda_codigo: string | null;
  moneda_simbolo: string | null;
  activo: boolean;
}

interface ProductoPrecio {
  moneda_id: number;
  moneda_codigo: string;
  moneda_simbolo: string;
  tasa: number;
  costo: number;
  precio: number;
  es_base: boolean;
}

interface ProductoSearch {
  id: number;
  codigo: string;
  nombre: string;
  stock: number;
  costo_base: number | string;
  moneda_base_id: number | null;
  categoria_nombre: string | null;
  precios: ProductoPrecio[] | null;
}

interface LineItem {
  id: string; // temp id for UI
  producto_id: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  costo_unit: number;
  subtotal: number;
  // Base para recalcular al cambiar la tasa: `costo_base` está en la moneda
  // del producto; `costoManual` solo se llena si el usuario lo edita a mano
  costo_base: number;
  moneda_base_id: number | null;
  costoManual: number | null;
}

/* ───── Helpers ───── */

function fmtMoney(n: number, simbolo: string, codigo: string): string {
  try {
    const formatted = new Intl.NumberFormat("es-BO", {
      style: "currency",
      currency: codigo,
      minimumFractionDigits: 2,
    }).format(n);
    return formatted;
  } catch {
    return `${simbolo} ${n.toFixed(2)}`;
  }
}

function getCostoInMoneda(
  producto: ProductoSearch,
  moneda: MonedaInfo | null,
  monedas: MonedaInfo[],
  tasaCustom: number | null = null
): number {
  const costoBase = parseFloat(String(producto.costo_base)) || 0;

  // Con tasa personalizada siempre se recalcula desde la base del producto
  // (los precios guardados usan la tasa por defecto de la moneda)
  if (!tasaCustom && producto.precios && producto.precios.length > 0) {
    const match = producto.precios.find((p) => p.moneda_codigo === moneda?.codigo);
    if (match) return parseFloat(String(match.costo)) || 0;
  }

  if (!moneda) return costoBase;

  // Moneda propia del producto (sin moneda propia = moneda base del sistema)
  const prodMoneda =
    monedas.find((m) => m.id === producto.moneda_base_id) || monedas.find((m) => m.es_base) || moneda;

  const tasaProdUsd = tasaUsd(prodMoneda, monedas);
  const tasaDocUsd = tasaUsdDocumento(moneda, tasaCustom, monedas);
  const dec = Number(moneda.decimales ?? 2);
  if (tasaProdUsd <= 0) return costoBase;
  return redondear((costoBase / tasaProdUsd) * tasaDocUsd, dec);
}

/* ───── Component ───── */

export default function NuevaCompraPage() {
  const router = useRouter();
  const { toast } = useToast();

  // ── Data sources ──
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [monedas, setMonedas] = useState<MonedaInfo[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ── Form state ──
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [metodoPagoId, setMetodoPagoId] = useState<number | null>(null);
  const [referencia, setReferencia] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Tasa personalizada de la compra (opcional; vacío = tasa por defecto de la moneda)
  const [tasaCustomStr, setTasaCustomStr] = useState("");

  // ── Product search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductoSearch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Proveedor search ──
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [proveedorDropdownOpen, setProveedorDropdownOpen] = useState(false);
  const proveedorRef = useRef<HTMLDivElement>(null);

  // ── Derived state ──
  const selectedMetodo = metodosPago.find((m) => m.id === metodoPagoId);
  const selectedMoneda = useMemo(() => {
    if (!selectedMetodo || !selectedMetodo.moneda_codigo) return monedas.find((m) => m.es_base) || null;
    return monedas.find((m) => m.codigo === selectedMetodo.moneda_codigo) || null;
  }, [selectedMetodo, monedas]);

  const monedaBase = useMemo(() => monedas.find((m) => m.es_base) || null, [monedas]);

  const selectedProveedor = proveedores.find((p) => p.id === proveedorId);

  // Tasa personalizada (si es válida) y tasa efectiva de la compra
  const tasaCustomNum = useMemo(() => {
    const n = parseFloat(tasaCustomStr);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [tasaCustomStr]);

  const tasaEfectiva = useMemo(() => {
    if (!selectedMoneda) return 0;
    return tasaCustomNum ?? Number(selectedMoneda.tasa);
  }, [selectedMoneda, tasaCustomNum]);

  // Costo unitario de un ítem en la moneda de la compra; si el usuario lo
  // editó a mano se respeta, si no se deriva de la tasa efectiva
  const costoDeItem = (item: LineItem): number => {
    if (item.costoManual !== null) return item.costoManual;
    if (!selectedMoneda) return item.costo_base;
    const prodMoneda =
      monedas.find((m) => m.id === item.moneda_base_id) || monedas.find((m) => m.es_base) || selectedMoneda;
    const tasaProdUsd = tasaUsd(prodMoneda, monedas);
    const tasaDocUsd = tasaUsdDocumento(selectedMoneda, tasaCustomNum, monedas);
    if (tasaProdUsd <= 0) return item.costo_base;
    return redondear((item.costo_base / tasaProdUsd) * tasaDocUsd, Number(selectedMoneda.decimales ?? 2));
  };

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + costoDeItem(item) * item.cantidad, 0),
    [items, selectedMoneda, monedas, tasaCustomNum]
  );

  const totalBase = useMemo(() => {
    if (!selectedMoneda) return subtotal;
    return aBase(subtotal, tasaUsdDocumento(selectedMoneda, tasaCustomNum, monedas));
  }, [subtotal, selectedMoneda, monedas, tasaCustomNum]);

  // ── Load initial data ──
  useEffect(() => {
    async function load() {
      setLoadingData(true);
      try {
        const [resProv, resMet, resMon] = await Promise.all([
          fetch("/api/proveedores?page=1&limit=500"),
          fetch("/api/metodos-pago"),
          fetch("/api/monedas"),
        ]);

        if (resProv.ok) {
          const d = await resProv.json();
          setProveedores((d.data || d).filter((p: Proveedor) => p.activo));
        }
        if (resMet.ok) {
          const d = await resMet.json();
          setMetodosPago(d.filter((m: MetodoPago) => m.activo));
        }
        if (resMon.ok) {
          const d = await resMon.json();
          setMonedas(d.filter((m: MonedaInfo) => m.activo !== false));
        }
      } catch (err) {
        console.error("Error loading data:", err);
        toast("Error al cargar datos iniciales", "error");
      } finally {
        setLoadingData(false);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Product search with debounce ──
  useEffect(() => {
    if (searchQuery.trim().length < 1) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    setSearchLoading(true);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/productos/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(Array.isArray(data) ? data : []);
          setSearchOpen(true);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [searchQuery]);

  // ── Click outside handlers ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (proveedorRef.current && !proveedorRef.current.contains(e.target as Node)) {
        setProveedorDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── When moneda changes, recalculate item costs ──
  useEffect(() => {
    // Los costos se recalculan en pantalla con `costoDeItem`; al cambiar de
    // moneda vuelve la tasa por defecto
    setTasaCustomStr("");
  }, [selectedMoneda?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add product to items ──
  const addProduct = (producto: ProductoSearch) => {
    // Check if already in list
    const existing = items.find((i) => i.producto_id === producto.id);
    if (existing) {
      setItems((prev) =>
        prev.map((i) =>
          i.producto_id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i
        )
      );
    } else {
      const costo = getCostoInMoneda(producto, selectedMoneda, monedas, tasaCustomNum);
      const newItem: LineItem = {
        id: `item-${Date.now()}-${Math.random()}`,
        producto_id: producto.id,
        codigo: producto.codigo,
        nombre: producto.nombre,
        cantidad: 1,
        costo_unit: costo,
        subtotal: costo,
        costo_base: parseFloat(String(producto.costo_base)) || 0,
        moneda_base_id: producto.moneda_base_id ?? null,
        costoManual: null,
      };
      setItems((prev) => [...prev, newItem]);
    }

    setSearchQuery("");
    setSearchOpen(false);
    toast(`"${producto.nombre}" agregado`, "info");
  };

  const updateItemQuantity = (id: string, qty: number) => {
    if (qty < 1) return;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, cantidad: qty } : i))
    );
  };

  const updateItemCost = (id: string, cost: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? // El costo editado a mano queda fijo (no se recalcula con la tasa)
            { ...i, costoManual: cost, costo_unit: cost, subtotal: i.cantidad * cost }
          : i
      )
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!proveedorId) {
      toast("Selecciona un proveedor", "warning");
      return;
    }
    if (items.length === 0) {
      toast("Agrega al menos un producto", "warning");
      return;
    }
    if (!metodoPagoId) {
      toast("Selecciona un método de pago", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        proveedor_id: proveedorId,
        fecha,
        moneda_id: selectedMoneda?.id,
        metodo_pago_id: metodoPagoId,
        caja_id: selectedMetodo?.caja_id || null,
        referencia: referencia.trim() || null,
        observaciones: observaciones.trim() || null,
        items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          costo_unit: costoDeItem(i),
        })),
        // Tasa personalizada (opcional); vacío = tasa por defecto de la moneda
        tasa: tasaCustomNum,
      };

      const res = await fetch("/api/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear compra");
      }

      toast("Compra registrada exitosamente", "success");
      router.push("/compras");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Filtered proveedores ──
  const filteredProveedores = useMemo(() => {
    if (!proveedorSearch.trim()) return proveedores;
    const q = proveedorSearch.toLowerCase();
    return proveedores.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) || (p.rif && p.rif.toLowerCase().includes(q))
    );
  }, [proveedores, proveedorSearch]);

  if (loadingData) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/compras")}>
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Nueva Orden de Compra</h1>
          <p className="text-sm text-muted-foreground">Registra una compra a proveedor</p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* ═══════════ LEFT PANEL ═══════════ */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* ── Proveedor + Fecha ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Truck size={15} className="text-primary" /> Proveedor y Fecha
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {/* Proveedor combobox */}
              <div className="col-span-2" ref={proveedorRef}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Proveedor <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProveedorDropdownOpen(!proveedorDropdownOpen)}
                    className={cn(
                      "flex h-10 w-full items-center justify-between rounded border border-border bg-background px-3 text-sm text-left transition-colors",
                      proveedorDropdownOpen && "border-primary ring-1 ring-ring",
                      !selectedProveedor && "text-muted-foreground"
                    )}
                  >
                    <span className="truncate">
                      {selectedProveedor ? selectedProveedor.nombre : "Seleccionar proveedor..."}
                    </span>
                    {selectedProveedor && (
                      <X
                        size={14}
                        className="text-muted-foreground/60 hover:text-foreground ml-2 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProveedorId(null);
                          setProveedorSearch("");
                        }}
                      />
                    )}
                  </button>

                  <AnimatePresence>
                    {proveedorDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
                      >
                        <div className="border-b border-border/60 p-2">
                          <div className="relative">
                            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                            <input
                              type="text"
                              value={proveedorSearch}
                              onChange={(e) => setProveedorSearch(e.target.value)}
                              placeholder="Buscar proveedor..."
                              className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                              autoFocus
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto py-1">
                          {filteredProveedores.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                              Sin resultados
                            </div>
                          ) : (
                            filteredProveedores.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setProveedorId(p.id);
                                  setProveedorDropdownOpen(false);
                                  setProveedorSearch("");
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-muted",
                                  p.id === proveedorId && "bg-muted font-medium"
                                )}
                              >
                                {p.id === proveedorId && <Check size={13} className="text-primary flex-shrink-0" />}
                                <span className="truncate">{p.nombre}</span>
                                {p.rif && (
                                  <span className="ml-auto text-xs text-muted-foreground font-mono">{p.rif}</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Fecha */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  <Calendar size={12} className="inline mr-1" /> Fecha
                </label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-10 w-full rounded border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          {/* ── Product Search ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Search size={15} className="text-primary" /> Buscar Productos
            </h3>
            <div ref={searchRef} className="relative">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                    placeholder="Buscar por código o nombre de producto..."
                    className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {searchLoading && (
                    <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                <Button 
                  onClick={() => setIsProductModalOpen(true)}
                  disabled={!proveedorId}
                  variant="outline"
                  className="h-11 px-3 border-dashed border-primary/50 text-primary hover:bg-primary/10"
                  title={!proveedorId ? "Selecciona un proveedor primero" : "Nuevo producto"}
                >
                  <Plus size={16} />
                </Button>
              </div>

              {/* Search Results Dropdown */}
              <AnimatePresence>
                {searchOpen && searchResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                  >
                    <div className="max-h-72 overflow-y-auto py-1">
                      {searchResults.map((p) => {
                        const costo = getCostoInMoneda(p, selectedMoneda, monedas);
                        const alreadyAdded = items.some((i) => i.producto_id === p.id);

                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addProduct(p)}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted",
                              alreadyAdded && "bg-primary/5"
                            )}
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                              <Package size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span>
                                <span className="text-sm font-medium truncate">{p.nombre}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>Existencias: {p.stock}</span>
                                {p.categoria_nombre && <span>{p.categoria_nombre}</span>}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-mono font-semibold text-foreground">
                                {selectedMoneda ? fmtMoney(costo, selectedMoneda.simbolo, selectedMoneda.codigo) : `$${costo.toFixed(2)}`}
                              </div>
                              {alreadyAdded && (
                                <span className="text-[10px] text-primary font-medium">Ya agregado</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {searchOpen && searchResults.length === 0 && searchQuery.length >= 1 && !searchLoading && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-lg">
                  No se encontraron productos
                </div>
              )}
            </div>
          </div>

          {/* ── Items Table ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShoppingCart size={15} className="text-primary" /> Ítems de Compra
              {items.length > 0 && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {items.length} {items.length === 1 ? "producto" : "productos"}
                </span>
              )}
            </h3>

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
                <Package size={32} className="mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Busca y agrega productos usando el buscador de arriba
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Código</th>
                      <th className="pb-2 pr-3 font-medium">Producto</th>
                      <th className="pb-2 pr-3 font-medium text-center w-28">Cantidad</th>
                      <th className="pb-2 pr-3 font-medium text-right w-36">Costo Unit.</th>
                      <th className="pb-2 pr-3 font-medium text-right w-36">Subtotal</th>
                      <th className="pb-2 font-medium text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const costoUnit = costoDeItem(item);
                      const subtotalItem = costoUnit * item.cantidad;
                      return (
                      <tr key={item.id} className="border-b border-border/30 last:border-0">
                        <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                          {item.codigo}
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{item.nombre}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item.id, item.cantidad - 1)}
                              className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              disabled={item.cantidad <= 1}
                            >
                              <Minus size={12} />
                            </button>
                            <input
                              type="number"
                              value={item.cantidad}
                              onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)}
                              min={1}
                              className="h-7 w-14 rounded border border-border bg-background text-center font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item.id, item.cantidad + 1)}
                              className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={costoUnit}
                            onChange={(e) => updateItemCost(item.id, parseFloat(e.target.value) || 0)}
                            className="h-7 w-28 rounded border border-border bg-background text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring ml-auto block"
                          />
                          {item.costoManual !== null && (
                            <button
                              type="button"
                              onClick={() =>
                                setItems((prev) =>
                                  prev.map((i) => (i.id === item.id ? { ...i, costoManual: null } : i))
                                )
                              }
                              className="mt-1 text-[10px] text-muted-foreground underline hover:text-foreground"
                              title="Volver a la tasa automática"
                            >
                              Usar tasa
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono font-semibold">
                          {selectedMoneda
                            ? fmtMoney(subtotalItem, selectedMoneda.simbolo, selectedMoneda.codigo)
                            : `$${subtotalItem.toFixed(2)}`}
                        </td>
                        <td className="py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════ RIGHT PANEL ═══════════ */}
        <div className="w-[380px] flex-shrink-0 space-y-5">
          {/* ── Método de Pago ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <CreditCard size={15} className="text-primary" /> Método de Pago
            </h3>

            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Método <span className="text-red-400">*</span>
            </label>
            <MetodoPagoSelect
              metodos={metodosPago}
              value={metodoPagoId}
              onChange={setMetodoPagoId}
              allowEmptyLabel="Seleccionar método..."
              placeholder="Seleccionar método..."
              className="w-full"
              ariaLabel="Método de pago"
            />

            {selectedMoneda && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Moneda:</span>
                  <span className="font-semibold text-primary">
                    {selectedMoneda.simbolo} {selectedMoneda.codigo}
                  </span>
                  {!selectedMoneda.es_base && (
                    <span className="text-muted-foreground ml-auto">
                      Tasa: {tasaEfectiva > 0 ? tasaEfectiva.toFixed(4) : "—"}
                    </span>
                  )}
                </div>

                {!selectedMoneda.es_base && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Tasa de cambio (opcional)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={tasaCustomStr}
                      onChange={(e) => setTasaCustomStr(e.target.value)}
                      placeholder={String(selectedMoneda.tasa)}
                      className="h-10 w-full rounded border border-border bg-background px-3 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                      Vacío = tasa por defecto ({String(selectedMoneda.tasa)}). Al cambiarla se
                      recalculan los costos en pantalla.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Referencia ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Hash size={15} className="text-primary" /> Referencia
            </h3>

            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              N° Referencia / Factura
            </label>
            <input
              type="text"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ej: FAC-00123"
              className="h-10 w-full rounded border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* ── Observaciones ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={15} className="text-primary" /> Observaciones
            </h3>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas adicionales sobre la compra..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* ── Summary ── */}
          <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShoppingCart size={15} className="text-primary" /> Resumen
            </h3>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Productos</span>
                <span className="font-mono">{items.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unidades totales</span>
                <span className="font-mono">{items.reduce((s, i) => s + i.cantidad, 0)}</span>
              </div>
              <div className="h-px bg-border/60 my-2" />
              <div className="flex justify-between text-sm font-semibold">
                <span>Subtotal</span>
                <span className="font-mono">
                  {selectedMoneda ? fmtMoney(subtotal, selectedMoneda.simbolo, selectedMoneda.codigo) : `$${subtotal.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-primary">
                <span>Total</span>
                <span className="font-mono">
                  {selectedMoneda ? fmtMoney(subtotal, selectedMoneda.simbolo, selectedMoneda.codigo) : `$${subtotal.toFixed(2)}`}
                </span>
              </div>
              {selectedMoneda && !selectedMoneda.es_base && (
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Tasa aplicada</span>
                  <span className="font-mono">{tasaEfectiva > 0 ? tasaEfectiva.toFixed(4) : "—"} {selectedMoneda.codigo}</span>
                </div>
              )}
              {selectedMoneda && !selectedMoneda.es_base && monedaBase && (
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Total ({monedaBase.codigo})</span>
                  <span className="font-mono">{fmtMoney(totalBase, monedaBase.simbolo, monedaBase.codigo)}</span>
                </div>
              )}
            </div>

            {/* Warnings */}
            {items.length > 0 && !proveedorId && (
              <div className="mt-3 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <AlertTriangle size={13} /> Selecciona un proveedor
              </div>
            )}
            {items.length > 0 && !metodoPagoId && (
              <div className="mt-2 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <AlertTriangle size={13} /> Selecciona un método de pago
              </div>
            )}

            <Button
              className="mt-4 w-full"
              onClick={handleSubmit}
              disabled={submitting || items.length === 0 || !proveedorId || !metodoPagoId}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Procesando...
                </>
              ) : (
                <>
                  <Check size={14} /> Confirmar Compra
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      
      {/* ── Producto Modal ── */}
      <ProductoModal
        open={isProductModalOpen}
        mode="create"
        producto={null}
        // @ts-ignore Moneda vs MonedaInfo are structurally compatible
        monedas={monedas}
        defaultProveedorId={proveedorId}
        onClose={() => setIsProductModalOpen(false)}
        onSuccess={(msg) => {
          toast(msg, "success");
          setSearchQuery(""); // Clear search to let user search it fresh
          if (searchRef.current?.querySelector("input")) {
             (searchRef.current.querySelector("input") as HTMLInputElement).focus();
          }
        }}
      />
    </div>
  );
}
