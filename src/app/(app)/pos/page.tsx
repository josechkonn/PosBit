"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Minus, Package, Plus, ShoppingCart, X, Check, Pause, Printer, FolderOpen, UserPlus, CheckCircle2, Zap, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchBar } from "@/components/ui/search-bar";
import { MetodoPagoSelect, ordenarMetodosPorMoneda } from "@/components/ui/metodo-pago-select";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDateTime, fmtNumber } from "@/lib/format";
import { redondear, tasaUsd, tasaUsdDocumento, tasaMostrada, esConversionDirectaUsd, tasaPar } from "@/lib/money";
import { ReceiptPrinter } from "@/components/pos/receipt-printer";
import { ClienteModal } from "@/components/cliente/cliente-modal";

interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  imagen: string | null;
  stock: number;
  iva_incluido: boolean;
  precio_base: number;
  costo_base: number;
  moneda_base_id?: string | null;
  categoria_nombre: string;
  marca_nombre: string;
  precios: Array<{
    moneda_id: string;
    moneda_codigo: string;
    moneda_simbolo: string;
    precio: number;
    costo: number;
    es_base: boolean;
  }>;
}

interface Moneda {
  id: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: string | null;
  decimales: number;
  es_base: boolean;
  usa_tasa_usd_directa?: boolean;
  tasa_usd_directa?: number | string | null;
}

interface MetodoPago {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: string;
  moneda_codigo: string;
  activo?: boolean;
}

interface Caja {
  id: string;
  nombre: string;
  moneda_id: string;
  moneda_codigo: string;
  saldo_actual: number;
}

interface CartItem {
  product: Producto;
  qty: number;
}

// Línea de pago mixto: una o varias, cada una en la moneda de SU método
interface LineaPago {
  key: number;
  metodoId: string | null; // null = usa el método de la venta (select del header)
  montoStr: string; // vacío = paga el resto que queda; "0" = no aporta
}

interface PorCobrarItem {
  codigo: string;
  simbolo: string;
  monto: number;
}

interface LimiteCredito {
  moneda_id: string;
  codigo: string;
  simbolo?: string;
  es_base?: boolean;
  limite: number | string;
}

interface Cliente {
  id: string;
  nombre: string;
  tipo?: string;
  documento: string | null;
  email?: string | null;
  telefono?: string | null;
  ciudad?: string | null;
  direccion?: string | null;
  recibe_credito: boolean;
  limite_credito: number | string;
  activo?: boolean;
  deuda_total?: PorCobrarItem[];
  limites_credito?: LimiteCredito[];
}

interface HeldCart {
  id: string;
  name: string;
  cart: CartItem[];
  timestamp: string;
}

// Tamaño de página del catálogo del POS (paginación por offset + scroll infinito)
const PAGE_SIZE = 24;

function deduplicateById<T extends { id: any }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const idStr = String(item.id);
    if (seen.has(idStr)) return false;
    seen.add(idStr);
    return true;
  });
}

export default function PuntoDeVentaPage() {
  const { toast } = useToast();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [monedas, setMonedas] = useState<Moneda[]>([]);
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  // Catálogo paginado con carga diferida (scroll infinito por offset)
  const [searchDebounced, setSearchDebounced] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const productPageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const prevSearchRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Selection state
  const [monedaSeleccionada, setMonedaSeleccionada] = useState<string>("");
  const [metodoPagoSeleccionado, setMetodoPagoSeleccionado] = useState<string | null>(null);
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string | null>(null);

  // Pago mixto: líneas de pago; cada una en la moneda de su método de pago.
  // montoStr vacío = paga el resto que queda; "0" = no aporta nada.
  const [lineasPago, setLineasPago] = useState<LineaPago[]>([{ key: 1, metodoId: null, montoStr: "" }]);
  const lineaSeq = useRef(2);
  const nuevaLineaPago = (montoStr = ""): LineaPago => ({
    key: lineaSeq.current++,
    metodoId: null,
    montoStr,
  });
  const [clienteId, setClienteId] = useState("");
  const [ajusteLimite, setAjusteLimite] = useState("");
  const [ajustandoLimite, setAjustandoLimite] = useState(false);
  const [showAjusteCredito, setShowAjusteCredito] = useState(false);
  const [modoAjuste, setModoAjuste] = useState<"suma" | "fijo">("suma");
  const [showCheckout, setShowCheckout] = useState(false);
  // El usuario pidió explícitamente registrar la venta a crédito: fuerza a
  // mostrar el panel de crédito aunque aún no haya monto cargado (deuda 0).
  const [creditoSolicitado, setCreditoSolicitado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [grantingCredit, setGrantingCredit] = useState(false);

  // Descuentos
  const [descuento, setDescuento] = useState<number>(0);
  const [descuentoStr, setDescuentoStr] = useState<string>("");
  const [observaciones, setObservaciones] = useState<string>("");
  const [isPagoMixto, setIsPagoMixto] = useState<boolean>(false);

  // Tasa personalizada de la venta (opcional; vacío = tasa por defecto de la moneda)
  const [tasaCustomStr, setTasaCustomStr] = useState<string>("");

  // Cliente creation
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [showHoldSaveModal, setShowHoldSaveModal] = useState(false);
  const [showHoldListModal, setShowHoldListModal] = useState(false);
  const [holdName, setHoldName] = useState("");

  // Receipt Modal
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [lastSaleData, setLastSaleData] = useState<any>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // Barcode Scanner Logic
  const barcodeBuffer = useRef("");
  const lastKeyTime = useRef(0);

  useEffect(() => {
    // Load held carts from local storage on mount
    const saved = localStorage.getItem("bodega_held_carts");
    if (saved) {
      try {
        setHeldCarts(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const saveHeldCarts = (carts: HeldCart[]) => {
    setHeldCarts(carts);
    localStorage.setItem("bodega_held_carts", JSON.stringify(carts));
  };

  const fetchClientes = async () => {
    try {
      const res = await fetch("/api/clientes?limit=500&activos=true");
      if (res.ok) {
        const data = await res.json();
        setClientes(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching clientes:", error);
    }
  };

  // Carga el catálogo con paginación por offset. `append` acumula la siguiente
  // página (scroll infinito); si no, reemplaza la lista (primera página/búsqueda).
  const cargarProductos = useCallback(
    async (page: number, opts: { append?: boolean; query?: string } = {}) => {
      const append = opts.append ?? false;
      const q = (opts.query ?? "").trim();
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (q) params.set("search", q);

      try {
        const res = await fetch(`/api/productos?${params.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        const lista: Producto[] = data.productos || [];
        setMonedas(data.monedas || []);

        const pag = data.pagination || { page, limit: PAGE_SIZE, total: lista.length, totalPages: 1 };
        productPageRef.current = page;
        setHasMore(page < (pag.totalPages || 1));
        setProductos((prev) =>
          append ? deduplicateById([...prev, ...lista]) : deduplicateById(lista)
        );
        return data;
      } catch (error) {
        console.error("Error al obtener productos:", error);
        return null;
      } finally {
        setLoadingProducts(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [metodosRes, cajasRes] = await Promise.all([
          fetch("/api/metodos-pago"),
          fetch("/api/cajas"),
        ]);

        await fetchClientes();
        const prodData = await cargarProductos(1);

        const metodosData = await metodosRes.json();
        const activeMetodos = (metodosData || []).filter((m: MetodoPago) => m.activo !== false && m.caja_id);
        setMetodosPago(activeMetodos);

        const cajasData = await cajasRes.json();
        setCajas(cajasData);

        if (activeMetodos.length > 0) {
          const defaultMetodo = activeMetodos[0];
          setMetodoPagoSeleccionado(defaultMetodo.id);
          setCajaSeleccionada(defaultMetodo.caja_id);
          if (defaultMetodo.moneda_codigo) {
            setMonedaSeleccionada(defaultMetodo.moneda_codigo);
          }
        } else {
          const monedaBase = prodData?.monedas?.find((m: Moneda) => m.es_base);
          if (monedaBase) setMonedaSeleccionada(monedaBase.codigo);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [cargarProductos]);

  // Búsqueda del catálogo contra el servidor (con retardo) y reinicio de la paginación
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    // La primera carga la hace el efecto de montaje (página 1 sin búsqueda)
    if (prevSearchRef.current === searchDebounced) return;
    prevSearchRef.current = searchDebounced;
    setLoadingProducts(true);
    setProductos([]);
    productPageRef.current = 1;
    cargarProductos(1, { query: searchDebounced });
  }, [searchDebounced, cargarProductos]);

  // Scroll infinito: al acercarse al final del catálogo, carga la siguiente página
  const cargarMas = useCallback(() => {
    if (!hasMore || loadingMoreRef.current || loadingProducts) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    cargarProductos(productPageRef.current + 1, { append: true, query: searchDebounced });
  }, [hasMore, loadingProducts, searchDebounced, cargarProductos]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) cargarMas();
      },
      { root, rootMargin: "400px 0px", threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cargarMas, hasMore, loading]);

  // Búsqueda exacta de un producto (por código o texto) con respaldo en el
  // servidor, para que el escáner funcione aunque el producto aún no se haya
  // cargado con el scroll infinito.
  const buscarProducto = async (q: string): Promise<Producto | null> => {
    const lower = q.trim().toLowerCase();
    if (!lower) return null;

    const local = productos.find((p) => p.codigo.trim().toLowerCase() === lower);
    if (local) return local;

    try {
      const res = await fetch(`/api/productos?page=1&limit=20&search=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return null;
      const data = await res.json();
      const lista: Producto[] = data.productos || [];
      return (
        lista.find((p) => p.codigo.trim().toLowerCase() === lower) ??
        (lista.length === 1 ? lista[0] : null)
      );
    } catch {
      return null;
    }
  };

  const agregarPorTexto = async (q: string, limpiar = false) => {
    const match = await buscarProducto(q);
    if (!match) {
      toast(`Producto no encontrado: ${q}`, "error");
      return;
    }
    if (match.stock <= 0) {
      toast(`Sin existencias: ${match.nombre}`, "warning");
      return;
    }
    addToCart(match);
    toast(`Producto agregado: ${match.nombre}`, "success");
    if (limpiar) setSearch("");
  };

  // Ref con la versión más reciente para el listener global (sin re-suscribir en cada render)
  const agregarPorTextoRef = useRef(agregarPorTexto);
  useEffect(() => {
    agregarPorTextoRef.current = agregarPorTexto;
  });

  // Barcode Scanner Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return; // Ignore if user is typing in an input
      }
      const now = Date.now();
      if (now - lastKeyTime.current > 50) {
        barcodeBuffer.current = ""; // Reset if too slow (human typing)
      }
      lastKeyTime.current = now;

      if (e.key === "Enter") {
        const code = barcodeBuffer.current.trim();
        if (code) {
          void agregarPorTextoRef.current(code);
        }
        barcodeBuffer.current = "";
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const queryStr = search.trim();
      if (!queryStr) return;
      void agregarPorTexto(queryStr, true);
    }
  };

  const handleSelectMetodo = (metodoId: string) => {
    const metodo = metodosPago.find((m) => m.id === metodoId);
    if (metodo) {
      setMetodoPagoSeleccionado(metodo.id);
      setCajaSeleccionada(metodo.caja_id);
      if (metodo.moneda_codigo) {
        setMonedaSeleccionada(metodo.moneda_codigo);
      }
      // Al cambiar de moneda vuelve la tasa por defecto
      setTasaCustomStr("");
    } else {
      setMetodoPagoSeleccionado(null);
      setCajaSeleccionada(null);
    }
  };

  // El filtrado por texto lo hace el servidor (paginación + búsqueda); aquí
  // solo se ocultan los productos sin existencias.
  const filtered = useMemo(() => productos.filter((p) => p.stock > 0), [productos]);

  // Precio de un producto en una moneda concreta. Replica exactamente la misma
  // regla que usa el selector de fuera: si hay un precio guardado para esa
  // moneda se devuelve tal cual (sin conversiones ni redondeos extra), de modo
  // que el total en el modal coincida con el que muestra el POS.
  const getPrecioEnMoneda = (producto: Producto, codMoneda: string): number => {
    if (!codMoneda) return parseFloat(String(producto.precio_base)) || 0;

    // La tasa personalizada solo aplica a la moneda del documento; el resto de
    // monedas usa su tasa por defecto.
    const tasaCustomNum = parseFloat(tasaCustomStr);
    const esMonedaDoc = codMoneda === monedaSeleccionada;
    const conTasaCustom = esMonedaDoc && Number.isFinite(tasaCustomNum) && tasaCustomNum > 0;

    if (!conTasaCustom && producto.precios && producto.precios.length > 0) {
      const exact = producto.precios.find((p) => p.moneda_codigo === codMoneda);
      if (exact && parseFloat(String(exact.precio)) > 0) return parseFloat(String(exact.precio));
    }

    const targetMoneda = monedas.find((m) => m.codigo === codMoneda);
    if (!targetMoneda) return parseFloat(String(producto.precio_base)) || 0;
    // Moneda propia del producto (sin moneda propia = moneda base del sistema)
    const prodMoneda =
      monedas.find((m) => m.id === producto.moneda_base_id) || monedas.find((m) => m.es_base) || targetMoneda;

    const precioBaseNum = parseFloat(String(producto.precio_base)) || 0;
    const tasaProdUsd = tasaUsd(prodMoneda, monedas);
    const tasaDocUsd = tasaUsdDocumento(targetMoneda, conTasaCustom ? tasaCustomNum : null, monedas);
    const dec = Number(targetMoneda.decimales ?? 2);
    if (tasaProdUsd <= 0) return precioBaseNum;
    // Factor par a par: respeta la tasa personalizada para USD pero mantiene el
    // par con la referencia (COP ↔ BS = 3.2) aunque COP use tasa directa a USD.
    const factor = tasaPar(prodMoneda, targetMoneda, monedas, {
      [String(targetMoneda.id)]: tasaDocUsd,
    });
    return redondear(precioBaseNum * factor, dec);
  };

  const getPrecio = (producto: Producto): number => getPrecioEnMoneda(producto, monedaSeleccionada);

  // Tasa efectiva de la venta en "unidades de la moneda por su referencia"
  const tasaEfectiva = useMemo(() => {
    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    if (!targetMoneda) return 0;
    const tasaCustomNum = parseFloat(tasaCustomStr);
    return Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : tasaMostrada(targetMoneda);
  }, [monedas, monedaSeleccionada, tasaCustomStr]);

  // Tasa por defecto de la moneda seleccionada (placeholder del campo)
  const tasaPorDefecto = useMemo(() => {
    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    return targetMoneda ? String(tasaMostrada(targetMoneda)) : "";
  }, [monedas, monedaSeleccionada]);

  // ¿La moneda de la venta usa conversión directa a USD? Cambia la etiqueta del campo.
  const monedaVentaDirecta = useMemo(() => {
    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    return esConversionDirectaUsd(targetMoneda);
  }, [monedas, monedaSeleccionada]);

  const addToCart = (p: Producto) => {
    const targetId = String(p.id);
    setCart((prev) => {
      const existing = prev.find((c) => String(c.product.id) === targetId);
      if (existing) {
        if (existing.qty + 1 > p.stock) {
          toast(`Las existencias máximas para ${p.nombre} son ${p.stock}`, "warning");
          return prev;
        }
        return prev.map((c) =>
          String(c.product.id) === targetId ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { product: p, qty: 1 }];
    });
  };

  const removeFromCart = (id: number | string) =>
    setCart((prev) => prev.filter((c) => String(c.product.id) !== String(id)));

  const updateQty = (id: number | string, delta: number) => {
    const targetId = String(id);
    setCart((prev) => {
      const item = prev.find((c) => String(c.product.id) === targetId);
      if (!item) return prev;
      const nextQty = Math.max(1, item.qty + delta);
      if (nextQty > item.product.stock) {
        toast(`Las existencias máximas para ${item.product.nombre} son ${item.product.stock}`, "warning");
        return prev.map((c) =>
          String(c.product.id) === targetId ? { ...c, qty: item.product.stock } : c
        );
      }
      return prev.map((c) =>
        String(c.product.id) === targetId ? { ...c, qty: nextQty } : c
      );
    });
  };

  const setDirectQty = (id: number | string, val: number) => {
    const targetId = String(id);
    setCart((prev) => {
      const item = prev.find((c) => String(c.product.id) === targetId);
      if (!item) return prev;
      const parsed = isNaN(val) ? 1 : val;
      let targetQty = Math.max(1, parsed);

      if (targetQty > item.product.stock) {
        toast(`Las existencias máximas para ${item.product.nombre} son ${item.product.stock}`, "warning");
        targetQty = item.product.stock;
      }

      return prev.map((c) =>
        String(c.product.id) === targetId ? { ...c, qty: targetQty } : c
      );
    });
  };

  const subtotal = useMemo(() => cart.reduce((s, c) => s + getPrecio(c.product) * c.qty, 0), [cart, monedaSeleccionada, monedas, tasaCustomStr]);
  const tax = useMemo(() => {
    return cart.reduce((s, c) => {
      if (c.product.iva_incluido) return s;
      return s + Math.round(getPrecio(c.product) * 0.16 * c.qty * 100) / 100;
    }, 0);
  }, [cart, monedaSeleccionada, monedas, tasaCustomStr]);
  
  const total = Math.max(0, subtotal - descuento + tax);

  // Total del carrito expresado en una moneda cualquiera, usando la MISMA regla
  // de precios que el POS (precio exacto guardado cuando existe). Así, el total
  // que muestra el modal al elegir un método de pago en otra moneda coincide
  // con el que se obtendría seleccionando esa moneda en el selector de fuera,
  // sin las desviaciones de convertir y redondear hacia arriba.
  const calcularTotalEnMoneda = (codMoneda: string): number => {
    if (!codMoneda || codMoneda === monedaSeleccionada) return total;
    let sub = 0;
    let taxMoneda = 0;
    for (const c of cart) {
      const p = getPrecioEnMoneda(c.product, codMoneda);
      sub += p * c.qty;
      if (!c.product.iva_incluido) taxMoneda += Math.round(p * 0.16 * c.qty * 100) / 100;
    }
    return Math.max(0, sub - descuento + taxMoneda);
  };

  const setPagarCompleto = () => {
    setLineasPago([{ key: 1, metodoId: metodoPagoSeleccionado, montoStr: String(total) }]);
  };

  const setCreditoTotal = () => {
    setLineasPago([{ key: 1, metodoId: metodoPagoSeleccionado, montoStr: "0" }]);
  };

  const addQuickMonto = (monto: number) => {
    setLineasPago((prev) => {
      if (prev.length === 0) return [{ key: 1, metodoId: metodoPagoSeleccionado, montoStr: String(monto) }];
      const currentNum = parseFloat(prev[0].montoStr) || 0;
      const nextNum = Math.round((currentNum + monto) * 100) / 100;
      return [{ ...prev[0], montoStr: String(nextNum) }, ...prev.slice(1)];
    });
  };

  // ═══════════ Pago mixto: líneas en varias monedas ═══════════
  // Cada línea se convierte a la moneda de la venta con la tasa efectiva del
  // documento (vía USD) y se aplica al saldo restante. Lo que sobra de una
  // línea no se pierde: se devuelve como vuelto en LA MONEDA DE ESA LÍNEA.
  const pagosResueltos = useMemo(() => {
    const monedaVenta = monedas.find((m) => m.codigo === monedaSeleccionada);
    const tasaCustomNum = parseFloat(tasaCustomStr);
    const tasaDoc = monedaVenta
      ? tasaUsdDocumento(monedaVenta, Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : null, monedas)
      : 1;

    let restante = redondear(total);
    return lineasPago.map((l) => {
      const metodo = metodosPago.find((m) => m.id === (l.metodoId ?? metodoPagoSeleccionado)) || null;
      const monedaLinea = monedas.find((m) => m.codigo === metodo?.moneda_codigo) || null;
      const esMonedaVenta = !!monedaLinea && !!monedaVenta && monedaLinea.id === monedaVenta.id;
      const decLinea = Number(monedaLinea?.decimales ?? 2);
      const restanteAntes = restante;

      const vacio = l.montoStr.trim() === "";
      const n = parseFloat(l.montoStr);
      // Vacío en modo simple = paga el resto que queda (en la moneda de esta línea).
      // Vacío en modo mixto = 0 (el usuario debe especificar el monto o pulsar pago completo).
      let monto = 0;
      if (vacio) {
        if (!isPagoMixto) {
          // Si la moneda del método es distinta a la de la venta se usa el total
          // exacto en esa moneda (misma regla que el selector de fuera), en vez
          // de convertir el total de la venta y redondear hacia arriba.
          if (esMonedaVenta) {
            monto = restante;
          } else {
            monto = calcularTotalEnMoneda(monedaLinea?.codigo || monedaSeleccionada);
          }
          monto = Number.isFinite(monto) ? redondear(monto, decLinea) : 0;
        } else {
          monto = 0;
        }
      } else if (Number.isFinite(n) && n > 0) {
        monto = redondear(n, decLinea);
      }

      // Entregado → moneda de la venta; lo aplicado se devuelve a la línea.
      // Se usa la arista directa si existe (COP ↔ BS = 3.2 aunque COP use tasa
      // directa a USD); la tasa personalizada solo sobreescribe la de la venta.
      const monedaVentaObj = monedaVenta;
      const factor = monedaLinea && monedaVentaObj
        ? tasaPar(monedaLinea, monedaVentaObj, monedas, { [String(monedaVentaObj.id)]: tasaDoc })
        : 1;
      const montoVenta = esMonedaVenta ? monto : redondear(monto * factor, Number(monedaVentaObj?.decimales ?? 2));
      const aplicado = Math.min(montoVenta, restante);
      const aplicadoLinea = esMonedaVenta ? aplicado : redondear(aplicado / (factor || 1), decLinea);
      const vuelto = redondear(Math.max(0, monto - aplicadoLinea));
      restante = redondear(restante - aplicado);

      return { key: l.key, metodo, monedaLinea, vacio, monto, montoVenta, aplicado, vuelto, restanteAntes };
    });
  }, [lineasPago, total, cart, descuento, monedas, metodosPago, monedaSeleccionada, tasaCustomStr, metodoPagoSeleccionado, isPagoMixto]);

  const pagadoTotal = useMemo(
    () => redondear(pagosResueltos.reduce((s, l) => s + l.aplicado, 0)),
    [pagosResueltos]
  );
  // Lo que no se paga ahora queda como deuda del cliente (crédito parcial o total)
  const deudaVenta = useMemo(() => Math.max(0, redondear(total - pagadoTotal)), [total, pagadoTotal]);
  const esCredito = deudaVenta > 0.009;
  const lineasPagoInvalidas = pagosResueltos.some((l) => !l.metodo);

  // Vuelto a devolver. Cada línea lo produce en SU moneda, así que no se pueden
  // sumar montos de monedas distintas como si fueran la misma: con una sola
  // línea se muestra en la moneda de esa línea y con varias se convierte cada
  // vuelto a la moneda de la venta para poder sumarlo.
  const vueltoResumen = useMemo(() => {
    const conVuelto = pagosResueltos.filter((l) => l.vuelto > 0.009);
    if (conVuelto.length === 0) {
      const extra = Math.max(0, redondear(pagadoTotal - total));
      return extra > 0.009 ? { monto: extra, codigo: monedaSeleccionada } : null;
    }
    if (conVuelto.length === 1) {
      const l = conVuelto[0];
      return { monto: l.vuelto, codigo: l.monedaLinea?.codigo || monedaSeleccionada };
    }
    const monedaVenta = monedas.find((m) => m.codigo === monedaSeleccionada);
    const tasaCustomNum = parseFloat(tasaCustomStr);
    const tasaVenta = monedaVenta
      ? tasaUsdDocumento(
          monedaVenta,
          Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : null,
          monedas
        )
      : 1;
    let suma = 0;
    for (const l of conVuelto) {
      if (l.monedaLinea && monedaVenta) {
        suma += l.vuelto * tasaPar(l.monedaLinea, monedaVenta, monedas, { [String(monedaVenta.id)]: tasaVenta });
      }
    }
    return { monto: redondear(suma), codigo: monedaSeleccionada };
  }, [pagosResueltos, pagadoTotal, total, monedas, monedaSeleccionada, tasaCustomStr]);

  const handleHoldCart = () => {
    if (cart.length === 0) return;
    const newHold: HeldCart = {
      id: Date.now().toString(),
      name: holdName || `Venta ${fmtDateTime(new Date().toISOString())}`,
      cart: [...cart],
      timestamp: new Date().toISOString()
    };
    saveHeldCarts([newHold, ...heldCarts]);
    setCart([]);
    setHoldName("");
    setShowHoldSaveModal(false);
    toast("Venta pausada exitosamente", "success");
  };

  const handleRestoreCart = (heldId: string) => {
    const toRestore = heldCarts.find(h => h.id === heldId);
    if (toRestore) {
      setCart(toRestore.cart);
      const newCarts = heldCarts.filter(h => h.id !== heldId);
      saveHeldCarts(newCarts);
      setShowHoldListModal(false);
      toast("Venta recuperada", "success");
    }
  };

  // Cerrar el checkout también cierra el modal anidado de nuevo cliente
  const cerrarCheckout = () => {
    setShowCheckout(false);
    setShowClienteModal(false);
    setCreditoSolicitado(false);
  };

  // "Pagar Completo" es venta al contado: se limpia cualquier petición de
  // crédito previa para que no quede el aviso de "Venta a crédito" pegado.
  const handlePagarCompleto = () => {
    setCreditoSolicitado(false);
    handleCheckout("completo");
  };

  // "Todo a Crédito": si el cliente todavía no puede comprar a crédito no se
  // intenta registrar (el backend lo rechazaría): se abre el panel con la
  // opción de otorgarle el crédito ahí mismo.
  const handlePedirTodoACredito = () => {
    setCreditoSolicitado(true);

    if (!clienteObj) {
      toast("Selecciona un cliente para registrar la venta a crédito", "error");
      return;
    }
    if (clienteSinCreditoSuficiente) {
      // El panel muestra el botón "Otorgar Crédito Rápido" para ampliar el límite.
      return;
    }
    handleCheckout("credito");
  };

  const handleHabilitarCreditoRapido = async () => {
    if (!clienteObj) return;
    setGrantingCredit(true);
    try {
      const monedaActual = monedas.find((m) => m.codigo === monedaSeleccionada);
      const monedaId = monedaActual?.id;
      // Límite total necesario para que esta venta quepa: la deuda que YA tiene el
      // cliente en esta moneda + lo que falta de esta venta. Se calcula así
      // directo (y no como "límite actual + lo que falta") porque
      // `disponibleCredito` está acotado en 0 cuando el límite es menor que la
      // deuda: en ese caso se ignoraba la deuda y el límite nuevo quedaba
      // corto, obligando a pulsar "Otorgar" varias veces hasta llegar.
      const nuevoLimite = Math.max(10000, Math.ceil(deudaMoneda + montoCreditoNecesario));

      const limitesExistentes = clienteObj.limites_credito || [];
      const limitesActualizados = monedas.map((m) => {
        const exist = limitesExistentes.find((l) => l.moneda_id === m.id || l.codigo === m.codigo);
        const limPrev = parseFloat(String(exist?.limite ?? 0)) || 0;
        if (m.codigo === monedaSeleccionada || (monedaId && m.id === monedaId)) {
          return { moneda_id: m.id, limite: Math.max(limPrev, nuevoLimite) };
        }
        return { moneda_id: m.id, limite: limPrev > 0 ? limPrev : 10000 };
      });

      const res = await fetch("/api/clientes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: clienteObj.id,
          nombre: clienteObj.nombre,
          tipo: clienteObj.tipo || "Persona Natural",
          documento: clienteObj.documento,
          email: clienteObj.email,
          telefono: clienteObj.telefono,
          ciudad: clienteObj.ciudad,
          direccion: clienteObj.direccion,
          recibe_credito: true,
          limites_credito: limitesActualizados,
          activo: clienteObj.activo !== false,
        }),
      });

      if (res.ok) {
        toast(`Crédito de ${fmt(nuevoLimite, monedaSeleccionada)} otorgado a ${clienteObj.nombre}`, "success");
        const resClientes = await fetch("/api/clientes");
        if (resClientes.ok) {
          const dataClientes = await resClientes.json();
          // La API devuelve { data: [...], pagination: {...] }; hay que guardar
          // solo el array. Guardar el objeto entero rompía clientes.find(...)
          // y reventaba la pantalla al otorgar el crédito.
          setClientes(dataClientes.data || []);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || "Error al otorgar crédito", "error");
      }
    } catch (e: any) {
      toast("Error al otorgar crédito", "error");
    } finally {
      setGrantingCredit(false);
    }
  };

  const handleCheckout = async (modeOverride?: "completo" | "credito") => {
    if (cart.length === 0) return;

    const isDirectCredito = modeOverride === "credito";
    const isDirectCompleto = modeOverride === "completo";
    const isCreditoFinal = isDirectCredito || (!modeOverride && esCredito);

    if (isCreditoFinal && !clienteId) {
      toast("Debes seleccionar un cliente para registrar una venta a crédito", "error");
      return;
    }

    const metodoIdFinal = metodoPagoSeleccionado || metodosPago[0]?.id;
    if (!metodoIdFinal && !isDirectCredito) {
      toast("Selecciona un método de pago", "error");
      return;
    }

    // Caja y moneda del método realmente elegido. El selector del modal no
    // pasa por handleSelectMetodo, así que se resuelven aquí en vez de usar
    // valores desactualizados de la selección de fuera.
    const metodoFinalObj = metodosPago.find((m) => m.id === metodoIdFinal) || null;
    const codMonedaMetodo = metodoFinalObj?.moneda_codigo || monedaSeleccionada;
    const cajaDelMetodo = metodoFinalObj?.caja_id ?? cajaSeleccionada;

    setSubmitting(true);
    try {
      const moneda = monedas.find((m) => m.codigo === monedaSeleccionada);
      const tasaCustomNum = parseFloat(tasaCustomStr);
      const items = cart.map((c) => ({
        producto_id: c.product.id,
        producto_nombre: c.product.nombre,
        cantidad: c.qty,
        precio_unit: getPrecio(c.product),
        subtotal: getPrecio(c.product) * c.qty,
      }));

      let pagosToSend: Array<{ metodo_pago_id: string; monto: number }> = [];
      let montoPagadoFinal = pagadoTotal;
      let deudaFinal = deudaVenta;

      if (isDirectCompleto) {
        // El backend interpreta pagos[].monto en la MONEDA DEL MÉTODO. Si el
        // método está en otra moneda hay que enviar el total exacto del carrito
        // en esa moneda (igual que muestra el modal y el selector de fuera);
        // mandar el total de la venta sin convertir dejaba deuda y terminaba
        // rejecting la venta como crédito.
        pagosToSend = [
          { metodo_pago_id: metodoIdFinal!, monto: calcularTotalEnMoneda(codMonedaMetodo) },
        ];
        montoPagadoFinal = total;
        deudaFinal = 0;
      } else if (isDirectCredito) {
        pagosToSend = [];
        montoPagadoFinal = 0;
        deudaFinal = total;
      } else {
        pagosToSend = pagosResueltos
          .filter((l) => l.metodo && l.monto > 0)
          .map((l) => ({
            metodo_pago_id: l.metodo!.id,
            monto: l.monto,
          }));
      }

      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          tipo_pago: isCreditoFinal ? "Credito" : "Contado",
          moneda_id: moneda?.id,
          metodo_pago_id: metodoIdFinal,
          caja_id: montoPagadoFinal > 0 ? cajaDelMetodo : null,
          descuento,
          pagos: pagosToSend,
          tasa: Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : null,
          observaciones: observaciones.trim() || null,
          items,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const clienteObj = clientes.find((c) => c.id === clienteId);
        const metodoObj = metodosPago.find((m) => m.id === metodoIdFinal);

        setLastSaleData({
          ventaNumero: data.venta?.numero || data.numero || "N/A",
          fecha: data.venta?.fecha || new Date().toISOString(),
          clienteNombre: clienteObj?.nombre || "Consumidor Final",
          tipoPago: isCreditoFinal ? "Crédito" : "Contado",
          monedaCodigo: monedaSeleccionada,
          monedaSimbolo: moneda?.simbolo || "$",
          tasaAplicada: tasaEfectiva,
          items: items,
          subtotal,
          impuesto: tax,
          descuento,
          total,
          montoPagado: montoPagadoFinal,
          deuda: deudaFinal,
          pagos: isDirectCompleto
            ? [{ metodo: metodoObj?.nombre || "Efectivo", moneda: monedaSeleccionada, monto: total, vuelto: 0 }]
            : isDirectCredito
              ? []
              : pagosResueltos
                  .filter((l) => l.metodo && l.monto > 0)
                  .map((l) => ({
                    metodo: l.metodo!.nombre,
                    moneda: l.monedaLinea?.codigo || monedaSeleccionada,
                    monto: l.monto,
                    vuelto: l.vuelto,
                  })),
        });

        setCart([]);
        setClienteId("");
        setLineasPago([nuevaLineaPago()]);
        setDescuento(0);
        setDescuentoStr("");
        setObservaciones("");
        setIsPagoMixto(false);
        setTasaCustomStr("");
        setCreditoSolicitado(false);
        setShowCheckout(false);
        setShowClienteModal(false);
        setShowReceiptModal(true);
        
        // Refresh products stock
        const prodRes = await fetch("/api/productos?limit=1000");
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProductos(deduplicateById(prodData.productos || []));
        }

        // Refrescar deudas y límites de crédito de los clientes
        const cliRes = await fetch("/api/clientes?limit=500&activos=true");
        if (cliRes.ok) {
          const cliData = await cliRes.json();
          setClientes(cliData.data || []);
        }
      } else {
        const error = await res.json();
        const msg = error.error || "Error al registrar la venta";
        // Si el backend rechaza por crédito, se abre el panel de crédito para
        // ampliar el límite ahí mismo, en vez de dejar solo un toast. Cubre los
        // casos en que la validación de la pantalla quedó desactualizada
        // (límite/deuda viejos) y el POST llegó igual a la API.
        if (/l[ií]mite de cr[eé]dito|Supera el l[ií]mite|no tiene cr[eé]dito/i.test(msg)) {
          setCreditoSolicitado(true);
        }
        toast(msg, "error");
      }
    } catch {
      toast("Error al registrar la venta", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="print:hidden flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Cargando productos...</p>
      </div>
    );
  }

  const clienteObj = clientes.find((c) => c.id === clienteId);

  // Deuda total del cliente en cada moneda
  const clienteTieneDeuda = !!clienteObj && Array.isArray(clienteObj.deuda_total) && clienteObj.deuda_total.some((d) => Number(d.monto) > 0);
  const deudasPendientes = clienteObj?.deuda_total?.filter((d) => Number(d.monto) > 0) || [];

  // Límite de crédito y deuda del cliente en la moneda de esta venta
  const deudaMoneda =
    parseFloat(String(clienteObj?.deuda_total?.find((d) => d.codigo === monedaSeleccionada)?.monto ?? 0)) || 0;
  const limiteMoneda =
    parseFloat(String(clienteObj?.limites_credito?.find((l) => l.codigo === monedaSeleccionada)?.limite ?? 0)) || 0;
  const disponibleCredito = Math.max(0, limiteMoneda - deudaMoneda);

  // Monto que el cliente necesita tener disponible en crédito para esta venta:
  // con pago parcial solo el saldo; si la venta va completa, el total. Lo usan
  // TANTO el botón "Todo a Crédito" como el panel, para que no se contradigan
  // (antes uno comparaba contra `total` y el otro contra `deudaVenta`, y el
  // botón se quedaba sin hacer nada).
  const montoCreditoNecesario = esCredito ? deudaVenta : total;
  const clienteSinCreditoSuficiente =
    !!clienteObj && (!clienteObj.recibe_credito || disponibleCredito < montoCreditoNecesario);

  // Deuda del cliente: una línea por cada moneda en la que debe + la moneda de esta venta
  const deudasCliente = clienteObj?.deuda_total ?? [];
  const lineasDeuda: Array<{ codigo: string; monto: number }> =
    deudasCliente.length > 0
      ? [
          ...deudasCliente
            .filter((d) => d.codigo !== monedaSeleccionada)
            .map((d) => ({ codigo: d.codigo, monto: d.monto })),
          ...(monedaSeleccionada ? [{ codigo: monedaSeleccionada, monto: deudaMoneda }] : []),
        ]
      : [];

  // Guarda un valor absoluto de límite para la moneda de la venta.
  const guardarLimite = async (nuevo: number) => {
    if (!clienteObj || !monedaSeleccionada) return;
    const moneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    if (!moneda) return;

    setAjustandoLimite(true);
    try {
      const res = await fetch("/api/clientes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: clienteObj.id, moneda_id: moneda.id, limite: nuevo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo ajustar el límite de crédito");

      setClientes((prev) =>
        prev.map((c) => {
          if (c.id !== clienteObj.id) return c;
          const actuales = c.limites_credito || [];
          const existe = actuales.some((l) => l.moneda_id === moneda.id);
          const actualizado = existe
            ? actuales.map((l) => (l.moneda_id === moneda.id ? { ...l, limite: data.limite } : l))
            : [
                ...actuales,
                { moneda_id: moneda.id, codigo: moneda.codigo, es_base: moneda.es_base, limite: data.limite },
              ];
          return { ...c, limites_credito: actualizado };
        })
      );

      toast(`Límite en ${monedaSeleccionada}: ${fmt(data.limite, monedaSeleccionada)}`, "success");
      setAjusteLimite("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo ajustar el límite de crédito", "error");
    } finally {
      setAjustandoLimite(false);
    }
  };

  // Suma o resta un monto al límite actual.
  const ajustarLimite = async (signo: 1 | -1) => {
    const paso = parseFloat(ajusteLimite);
    if (isNaN(paso) || paso <= 0) {
      toast("Indica un monto para subir o bajar el límite", "error");
      return;
    }
    await guardarLimite(Math.max(0, Math.round((limiteMoneda + signo * paso) * 100) / 100));
  };

  // Fija el límite al valor exacto que escriba el usuario.
  const fijarLimite = async () => {
    const valor = parseFloat(ajusteLimite);
    if (!Number.isFinite(valor) || valor < 0) {
      toast("Indica un límite válido", "error");
      return;
    }
    await guardarLimite(Math.round(valor * 100) / 100);
  };

  return (
    <>
      <div className="print:hidden flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden">
        {/* Sin page header y sin scroll de página: la cuadrícula toma el alto
            restante del viewport vía flex */}
        {/* El POS es una pantalla de escritorio: catálogo y carrito van SIEMPRE
            lado a lado (productos izquierda, carrito derecha), sin depender de
            un breakpoint que los apile en ventanas angostas. */}
        <div className="grid flex-1 min-h-0 grid-cols-12 gap-3 sm:gap-4 overflow-hidden">
          {/* ═══════════ PRODUCT CATALOG (8 COLS) ═══════════ */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 min-w-0 overflow-hidden col-span-8">
            <div className="flex shrink-0 gap-3">
              <SearchBar
                placeholder="Escanear código de barras o buscar producto..."
                containerClassName="w-full flex-1"
                className="w-full bg-card py-2.5"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <MetodoPagoSelect
                  metodos={metodosPago}
                  value={metodoPagoSeleccionado}
                  onChange={(id) => id !== null && handleSelectMetodo(id)}
                  placeholder="Método de pago"
                  triggerClassName="bg-card font-medium"
                  ariaLabel="Método de pago"
                />
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
            >
              <div className="grid content-start grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-4 pb-4">
                {filtered.map((p) => (
                  <button
                    key={`catalog-${p.id}`}
                    onClick={() => addToCart(p)}
                    className="group flex flex-col justify-between rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-primary hover:shadow-md w-full"
                  >
                    <div className="w-full">
                      <div className="mb-2.5 flex h-32 w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40 group-hover:bg-primary/5 relative">
                        {p.imagen && !failedImages[p.id] ? (
                          <img
                            src={p.imagen}
                            alt={p.nombre}
                            className="h-32 w-full object-contain p-2 transition-transform duration-200 group-hover:scale-105"
                            onError={() => setFailedImages((prev) => ({ ...prev, [p.id]: true }))}
                          />
                        ) : (
                          <Package size={36} className="text-muted-foreground/40" />
                        )}
                        {!p.iva_incluido && (
                          <span className="absolute top-1.5 right-1.5 rounded-sm bg-warning/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-warning-foreground shadow-sm">
                            +IVA
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-semibold leading-tight text-foreground line-clamp-2">
                        {p.nombre}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {p.codigo}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-border/40 pt-2.5 w-full">
                      <span className="font-mono text-sm sm:text-base font-bold text-primary truncate min-w-0">
                        {fmt(getPrecio(p), monedaSeleccionada)}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground bg-muted/80 px-2 py-0.5 rounded-md shrink-0">
                        Stock: {p.stock}
                      </span>
                    </div>
                  </button>
                ))}

                {/* Centinela para la carga diferida: al entrar en vista carga la siguiente página */}
                <div ref={sentinelRef} className="col-span-full flex items-center justify-center py-2">
                  {loadingMore && (
                    <span className="text-xs font-medium text-muted-foreground">Cargando más productos…</span>
                  )}
                </div>

                {loadingProducts && filtered.length === 0 && (
                  <div className="col-span-full py-10 text-center text-sm text-muted-foreground">
                    Cargando productos…
                  </div>
                )}

                {!loadingProducts && filtered.length === 0 && (
                  <div className="col-span-full py-10 text-center text-sm text-muted-foreground">
                    {search.trim() ? "No se encontraron productos." : "No hay productos con existencias."}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══════════ CART PANEL (4 COLS) ═══════════ */}
          <Card className="flex flex-1 min-h-0 flex-col min-w-0 overflow-hidden col-span-4">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Carrito de Venta</h3>
                {monedaSeleccionada && (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {monedaSeleccionada}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowHoldListModal(true)} className="text-xs text-primary hover:underline font-medium flex items-center gap-1">
                  <FolderOpen size={12} /> Recuperar {heldCarts.length > 0 && `(${heldCarts.length})`}
                </button>
                {cart.length > 0 && (
                  <button onClick={() => setShowHoldSaveModal(true)} className="text-xs text-amber-500 hover:underline font-medium flex items-center gap-1">
                    <Pause size={12} /> Pausar
                  </button>
                )}
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-xs text-red-400 hover:underline font-medium">
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Selector de Cliente en Carrito de Venta (Consumidor Final por defecto) */}
            <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Combobox
                    value={String(clienteId)}
                    onChange={setClienteId}
                    placeholder="Consumidor Final"
                    options={[
                      { value: "", label: "Consumidor Final" },
                      ...clientes.map((c) => {
                        const tieneD = Array.isArray(c.deuda_total) && c.deuda_total.some((d) => Number(d.monto) > 0);
                        return {
                          value: String(c.id),
                          label: `${c.nombre} ${c.documento ? `— ${c.documento}` : ""}${tieneD ? " ⚠️ (Tiene deuda)" : ""}`,
                        };
                      }),
                    ]}
                    className="w-full"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 border-border bg-card hover:bg-muted"
                  onClick={() => setShowClienteModal(true)}
                  title="Registrar Nuevo Cliente"
                >
                  <UserPlus size={16} className="text-primary" />
                </Button>
              </div>

              {/* Alerta de Deuda Pendiente del Cliente (Por Fuera - Destacado y Legible) */}
              {clienteObj && clienteTieneDeuda && (
                <div className="mt-2.5 flex flex-col gap-2 rounded-xl border-2 border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-100 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-black text-xs text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                      <AlertTriangle size={16} className="shrink-0 text-amber-500 animate-pulse" />
                      <span>Deuda Registrada</span>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-md border border-amber-500/30">
                      En Cobro
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {deudasPendientes.map((d) => (
                      <div key={`deuda-cart-${d.codigo}`} className="bg-card/90 dark:bg-muted/90 border border-amber-500/40 px-3 py-1.5 rounded-lg text-sm font-mono font-black shadow-2xs text-rose-600 dark:text-rose-400">
                        {fmt(d.monto, d.codigo)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 divide-y divide-border overflow-y-auto">
              {cart.length === 0 ? (
                <EmptyState icon={ShoppingCart} message="Sin productos en el carrito" />
              ) : (
                cart.map(({ product: p, qty }) => (
                  <div key={`cart-${p.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {p.nombre}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {fmt(getPrecio(p), monedaSeleccionada)} c/u
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-6 w-6 p-0" onClick={() => updateQty(p.id, -1)}>
                        <Minus size={11} />
                      </Button>
                      <input
                        type="number"
                        min="1"
                        max={p.stock}
                        className="w-10 text-center font-mono text-sm bg-transparent border border-transparent hover:border-border focus:border-primary focus:bg-background rounded focus:outline-none p-0 h-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={qty}
                        onChange={(e) => setDirectQty(p.id, parseInt(e.target.value, 10))}
                      />
                      <Button variant="outline" size="icon" className="h-6 w-6 p-0" onClick={() => updateQty(p.id, 1)}>
                        <Plus size={11} />
                      </Button>
                    </div>
                    <div className="text-right font-mono text-sm font-semibold shrink-0 min-w-[4rem]">
                      {fmt(getPrecio(p) * qty, monedaSeleccionada)}
                    </div>
                    <Button variant="ghost" size="icon" className="hover:bg-transparent hover:text-red-400" onClick={() => removeFromCart(p.id)}>
                      <X size={13} />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer: resumen + botón Finalizar */}
            <div className="shrink-0 space-y-2 border-t border-border px-4 py-3 bg-card">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{fmt(subtotal, monedaSeleccionada)}</span>
                </div>
                {tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>IVA (16%)</span>
                    <span className="font-mono">{fmt(tax, monedaSeleccionada)}</span>
                  </div>
                )}
                {descuento > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Descuento</span>
                    <span className="font-mono">−{fmt(descuento, monedaSeleccionada)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
                  <span>Total ({monedaSeleccionada || "—"})</span>
                  <span className="font-mono text-primary text-lg">{fmt(total, monedaSeleccionada)}</span>
                </div>
              </div>
              <Button
                className="w-full py-2.5 font-semibold text-sm cursor-pointer"
                disabled={cart.length === 0}
                onClick={() => {
                    setShowCheckout(true);
                    // Límite y deuda del cliente se releen al abrir: si estaban
                    // desactualizados, la validación de la pantalla dejaba pasar
                    // ventas que el backend luego rechazaba.
                    void fetchClientes();
                  }}
              >
                <Check size={16} className="mr-1.5" />
                Finalizar
              </Button>
            </div>
          </Card>
        </div>
      </div>

        {/* Checkout Modal */}
        {(() => {
          const metodoSimpleObj = metodosPago.find((m) => m.id === (metodoPagoSeleccionado ?? metodosPago[0]?.id)) || null;
          const monedaSimpleObj = monedas.find((m) => m.codigo === metodoSimpleObj?.moneda_codigo) || null;
          const codMonedaSimple = monedaSimpleObj?.codigo || monedaSeleccionada;

          return (
            <Modal
              open={showCheckout}
              onClose={cerrarCheckout}
              title="Finalizar Venta"
              className="max-w-none w-[90vw] h-[88vh] overflow-y-auto"
            >
              {/* Fila única acotada al alto disponible (minmax(0,1fr)): así, cuando la
                  columna derecha crece (p. ej. al mostrar el panel de crédito) NO
                  estira la fila ni empuja hacia abajo los botones de la columna
                  central; solo esa columna derecha hace scroll. */}
              <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[minmax(0,1fr)] gap-6">
                {/* COLUMNA 1: FORMAS DE PAGO (col-span-3) - Lista Vertical a la Izquierda Extrema */}
                <div className="col-span-3 min-h-0 space-y-3 border-r border-border pr-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-border/50 pb-2">
                      <Label className="text-xs font-extrabold text-foreground uppercase tracking-wider">Forma de Pago</Label>
                      <button
                        type="button"
                        onClick={() => setIsPagoMixto(!isPagoMixto)}
                        className="text-[11px] font-bold text-primary hover:underline cursor-pointer flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded-md transition-colors"
                      >
                        {isPagoMixto ? "⬅️ Simple" : "🔀 Mixto"}
                      </button>
                    </div>

                    {!isPagoMixto ? (
                      /* Lista Vertical de Métodos de Pago en 1 Columna Hacia Abajo */
                      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                      {ordenarMetodosPorMoneda(metodosPago).map((m) => {
                        const isSelected = (metodoPagoSeleccionado ?? metodosPago[0]?.id) === m.id;
                        return (
                          <button
                            key={`metodo-card-${m.id}`}
                            type="button"
                            onClick={() => {
                              // Igual que el selector de fuera: cambia método,
                              // caja y moneda del documento (por eso el resumen
                              // de la derecha se actualiza al elegir).
                              handleSelectMetodo(m.id);
                              setLineasPago([{ key: 1, metodoId: m.id, montoStr: "" }]);
                            }}
                            className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                              isSelected
                                ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30 shadow-xs font-bold"
                                : "border-border/80 bg-card hover:bg-muted/40 text-foreground hover:border-primary/50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm ${
                                isSelected ? "bg-primary text-primary-foreground font-bold" : "bg-muted text-muted-foreground"
                              }`}>
                                {m.nombre.toLowerCase().includes("efectivo") ? "💵" :
                                 m.nombre.toLowerCase().includes("punto") || m.nombre.toLowerCase().includes("tarjeta") ? "💳" :
                                 m.nombre.toLowerCase().includes("zelle") ? "⚡" :
                                 m.nombre.toLowerCase().includes("móvil") || m.nombre.toLowerCase().includes("movil") ? "📱" :
                                 m.nombre.toLowerCase().includes("transf") ? "🏦" : "💰"}
                              </div>
                              <div className="truncate">
                                <p className="text-xs font-extrabold truncate leading-tight">{m.nombre}</p>
                                {m.moneda_codigo && (
                                  <p className="text-[10px] font-mono opacity-70 leading-tight mt-0.5">{m.moneda_codigo}</p>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    /* Modo Mixto: Múltiples Líneas de Pago */
                    <div className="space-y-3 pt-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] text-muted-foreground font-semibold">Desglose de montos:</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] font-semibold"
                          onClick={() => setLineasPago((prev) => [...prev, nuevaLineaPago()])}
                        >
                          <Plus size={12} /> Añadir
                        </Button>
                      </div>

                      <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                        {pagosResueltos.map((l) => {
                          const lineaInput = lineasPago.find((p) => p.key === l.key);
                          const codLinea = l.monedaLinea?.codigo || monedaSeleccionada;
                          return (
                            <div key={l.key} className="rounded-xl border border-border/70 bg-muted/30 p-2.5 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <MetodoPagoSelect
                                  metodos={metodosPago}
                                  value={l.metodo?.id ?? null}
                                  onChange={(id) =>
                                    setLineasPago((prev) =>
                                      prev.map((p) => (p.key === l.key ? { ...p, metodoId: id } : p))
                                    )
                                  }
                                  className="h-9 min-w-0 flex-1 text-xs"
                                  triggerClassName="bg-card"
                                  placeholder="Método"
                                  ariaLabel="Método de pago de la línea"
                                />
                                <Input
                                  className="h-9 w-24 text-right font-mono text-xs font-bold"
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={lineaInput?.montoStr ?? ""}
                                  placeholder="Monto"
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLineasPago((prev) => prev.map((p) => (p.key === l.key ? { ...p, montoStr: v } : p)));
                                  }}
                                />
                                {pagosResueltos.length > 1 && (
                                  <button
                                    onClick={() => setLineasPago((prev) => prev.filter((p) => p.key !== l.key))}
                                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger cursor-pointer transition-colors"
                                    title="Quitar línea"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center justify-between text-[11px] pt-0.5 px-0.5">
                                <span className="font-mono text-muted-foreground">
                                  Entra: <strong className="text-foreground">{fmt(l.monto, codLinea)}</strong>
                                </span>
                                {l.vuelto > 0.009 && (
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                    Vuelto: {fmt(l.vuelto, codLinea)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  </div>
                </div>

                {/* COLUMNA 2: DETALLES DE PAGO Y ACCIONES (col-span-4) */}
                <div className="col-span-4 min-h-0 space-y-4 border-r border-border pr-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    {/* Monto Ingresado Input */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <Label className="text-xs font-extrabold text-foreground uppercase tracking-wider">
                          Monto Ingresado ({codMonedaSimple})
                        </Label>
                        <span className="text-[11px] text-muted-foreground italic">(opcional)</span>
                      </div>
                      <Input
                        className="h-14 text-right font-mono text-xl font-black border-2 border-primary/40 focus:border-primary shadow-xs"
                        type="number"
                        step="any"
                        min="0"
                        value={lineasPago[0]?.montoStr ?? ""}
                        placeholder="Vacío = total"
                        onChange={(e) => {
                          const v = e.target.value;
                          setLineasPago([{ key: 1, metodoId: metodoSimpleObj?.id ?? metodoPagoSeleccionado, montoStr: v }]);
                        }}
                      />
                    </div>

                {/* Nota / Observación */}
                <div>
                  <Label className="text-xs font-bold text-foreground">Nota / Observación (opcional)</Label>
                  <Input
                    className="mt-1 h-10 text-sm"
                    placeholder="Ej: Cliente retira por la tarde..."
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                  />
                </div>

                {/* Tasa de Cambio Personalizada */}
                {monedaSeleccionada && (
                  <div>
                    <Label className="text-xs font-bold text-foreground">
                      Tasa {monedaSeleccionada}
                      {monedaVentaDirecta ? " por 1 USD" : ""} (opcional)
                    </Label>
                    <Input
                      className="mt-1 h-10 text-right font-mono text-sm font-semibold"
                      type="number"
                      step="any"
                      min="0"
                      value={tasaCustomStr}
                      placeholder={tasaPorDefecto}
                      onChange={(e) => setTasaCustomStr(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* BOTONES PRINCIPALES DE ACCIÓN DIRECTA EN 2 COLUMNAS LADO A LADO */}
              <div className="pt-2 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={submitting || cart.length === 0}
                    onClick={handlePagarCompleto}
                    className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center tracking-wide"
                  >
                    {submitting ? "Procesando..." : "Pagar Completo"}
                  </button>

                  <button
                    type="button"
                    disabled={submitting || cart.length === 0}
                    onClick={handlePedirTodoACredito}
                    className="w-full h-14 bg-rose-500 hover:bg-rose-600 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center tracking-wide"
                  >
                    {submitting ? "Procesando..." : "Todo a Crédito"}
                  </button>
                </div>

                {lineasPago.some((p) => p.montoStr !== "") && (
                  <button
                    type="button"
                    disabled={
                      submitting ||
                      cart.length === 0 ||
                      lineasPagoInvalidas ||
                      (esCredito && (!clienteObj || !clienteObj.recibe_credito || disponibleCredito < deudaVenta))
                    }
                    onClick={() => handleCheckout()}
                    className="w-full h-14 bg-sky-500 hover:bg-sky-600 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center tracking-wide"
                  >
                    {submitting
                      ? "Procesando..."
                      : esCredito
                        ? "Registrar Pago Parcial"
                        : "Registrar Pago Personalizado"}
                  </button>
                )}

                <Button variant="outline" className="w-full h-10 text-sm font-medium" onClick={cerrarCheckout} disabled={submitting}>
                  Cancelar
                </Button>
              </div>
            </div>

            {/* COLUMNA 3: CLIENTE, RESUMEN Y TOTALES (col-span-5) */}
            {/* Esta es la única columna que scrollea: cliente, resumen de crédito y totales */}
            <div className="col-span-5 min-h-0 overflow-y-auto pr-1 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                {/* Cliente Selector (ENCIMA DEL RESUMEN DEL PEDIDO) */}
                <Field label="Cliente de la Venta">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Combobox
                        value={String(clienteId)}
                        onChange={setClienteId}
                        placeholder="Consumidor Final"
                        options={[
                          { value: "", label: "Consumidor Final" },
                          ...clientes.map((c) => {
                            const tieneD = Array.isArray(c.deuda_total) && c.deuda_total.some((d) => Number(d.monto) > 0);
                            return {
                              value: String(c.id),
                              label: `${c.nombre} ${c.documento ? `— ${c.documento}` : ""}${tieneD ? " ⚠️ (Tiene deuda)" : ""}`,
                            };
                          }),
                        ]}
                      />
                    </div>
                    <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setShowClienteModal(true)} title="Nuevo Cliente">
                      <UserPlus size={18} className="text-primary" />
                    </Button>
                  </div>

                  {/* Alerta de Deuda Pendiente del Cliente (Por Dentro del Modal) */}
                  {clienteObj && clienteTieneDeuda && (
                    <div className="mt-3 flex flex-col gap-2.5 rounded-2xl border-2 border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent p-3.5 text-amber-900 dark:text-amber-100 shadow-sm">
                      <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-300">
                            <AlertTriangle size={16} className="animate-pulse" />
                          </div>
                          <div>
                            <h4 className="font-extrabold text-xs uppercase tracking-wide text-amber-900 dark:text-amber-200">
                              Deuda Pendiente de {clienteObj.nombre}
                            </h4>
                          </div>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-700 dark:text-rose-300 px-2.5 py-0.5 rounded-full border border-rose-500/30">
                          Deuda Activa
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {deudasPendientes.map((d) => (
                          <div key={`deuda-modal-${d.codigo}`} className="bg-card border-2 border-amber-500/40 px-3.5 py-1.5 rounded-xl shadow-xs text-sm font-black font-mono text-rose-600 dark:text-rose-400">
                            {fmt(d.monto, d.codigo)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Field>

                {/* Informaciones de Crédito si la venta incluye Crédito / Pago Parcial.
                    También se muestran cuando el usuario pulsa "Todo a Crédito",
                    aunque la venta todavía no tenga saldo (deuda 0). */}
                {(esCredito || creditoSolicitado) && !clienteObj && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-200 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-bold text-sm">
                          {esCredito ? "Venta con Pago Parcial / Crédito" : "Venta a crédito"}
                        </p>
                        <p className="mt-1 text-sm opacity-90 leading-snug">
                          {esCredito ? (
                            <>
                              Se ingresó un pago de <strong>{fmt(pagadoTotal, monedaSeleccionada)}</strong>. El saldo
                              restante de <strong>{fmt(deudaVenta, monedaSeleccionada)}</strong> quedará registrado como
                              deuda.
                            </>
                          ) : (
                            <>
                              Los <strong>{fmt(total, monedaSeleccionada)}</strong> de esta venta quedarán a cargo del
                              cliente como deuda.
                            </>
                          )}
                        </p>
                        <p className="mt-1.5 text-sm font-semibold text-amber-900 dark:text-amber-100">
                          ⚠️ Debes seleccionar o crear un cliente arriba para continuar.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {(esCredito || creditoSolicitado) && clienteObj && (
                  <div className="space-y-2">
                    {clienteSinCreditoSuficiente ? (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100 space-y-3">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          <div className="min-w-0">
                            <p className="font-bold text-base leading-tight">
                              {!clienteObj.recibe_credito
                                ? `Crédito no habilitado`
                                : `Crédito insuficiente en ${monedaSeleccionada}`}
                            </p>
                            <p className="mt-1 text-sm opacity-90 leading-snug">
                              {!clienteObj.recibe_credito
                                ? `${clienteObj.nombre} no tiene permiso para comprar a crédito. Puedes otorgárselo con un clic.`
                                : `Necesita un límite de ${fmt(deudaMoneda + montoCreditoNecesario, monedaSeleccionada)} para esta compra.`}
                            </p>
                          </div>
                        </div>

                        {/* Límite / Deuda / Disponible */}
                        <div className="grid grid-cols-3 gap-2 rounded-lg bg-amber-500/10 p-3 text-center">
                          <div>
                            <div className="text-[11px] uppercase tracking-wide opacity-75">Límite</div>
                            <div className="font-mono text-base font-extrabold">{fmt(limiteMoneda, monedaSeleccionada)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-wide opacity-75">Deuda</div>
                            <div className="font-mono text-base font-extrabold">{fmt(deudaMoneda, monedaSeleccionada)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-wide opacity-75">Disponible</div>
                            <div className="font-mono text-base font-extrabold text-danger">{fmt(disponibleCredito, monedaSeleccionada)}</div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={grantingCredit}
                            onClick={handleHabilitarCreditoRapido}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm h-11 shadow-sm cursor-pointer"
                          >
                            <Zap size={16} className="mr-1.5 fill-current" />
                            {grantingCredit ? "Otorgando Crédito..." : `Otorgar Crédito Rápido a ${clienteObj.nombre}`}
                          </Button>
                          {/* Ajuste manual del límite en un modal aparte, sin
                              cerrar el de venta */}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={ajustandoLimite}
                            onClick={() => setShowAjusteCredito(true)}
                            title="Ajustar límite de crédito manualmente"
                            aria-label="Ajustar límite de crédito"
                            className="shrink-0 w-11 h-11 border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                          >
                            <Plus size={18} />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider opacity-70">Crédito del Cliente:</span>
                            <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">✓ Habilitado</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider opacity-70">Deuda actual:</span>
                            <span className="font-mono font-bold">{fmt(deudaMoneda, monedaSeleccionada)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider opacity-70">Crédito disponible:</span>
                            <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                              {fmt(disponibleCredito, monedaSeleccionada)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Header Resumen de Pedido */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                    Resumen del Pedido
                  </span>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-primary/10 text-primary">
                    {cart.reduce((s, c) => s + c.qty, 0)} producto(s)
                  </span>
                </div>

                {/* Desglose de Productos */}
                <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1 divide-y divide-border/30 rounded-xl border border-border/60 bg-muted/20 p-3">
                  {cart.map((c) => (
                    <div key={`checkout-item-${c.product.id}`} className="pt-2 first:pt-0">
                      <div className="flex justify-between items-start text-sm">
                        <span className="font-semibold text-foreground line-clamp-1 flex-1 pr-2">
                          {c.product.nombre}
                        </span>
                        <span className="font-mono font-bold shrink-0">
                          {fmt(getPrecio(c.product) * c.qty, monedaSeleccionada)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                        <span className="font-mono">{c.product.codigo}</span>
                        <span>{c.qty} × {fmt(getPrecio(c.product), monedaSeleccionada)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tarjeta de Totales, Descuento, Ingresado, Resta por Pagar y Vuelto */}
              <div className="bg-card border border-border/80 rounded-2xl p-4 space-y-3 shadow-xs">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span className="font-medium">Subtotal</span>
                    <span className="font-mono font-bold text-foreground">{fmt(subtotal, monedaSeleccionada)}</span>
                  </div>
                  {tax > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span className="font-medium">IVA (16%)</span>
                      <span className="font-mono font-bold text-foreground">{fmt(tax, monedaSeleccionada)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="font-medium">Descuento ({monedaSeleccionada})</span>
                    <Input
                      className="w-28 h-8 text-right font-mono text-xs p-1.5 font-bold"
                      value={descuentoStr}
                      placeholder="0.00"
                      onChange={(e) => {
                        setDescuentoStr(e.target.value);
                        const val = parseFloat(e.target.value);
                        setDescuento(isNaN(val) ? 0 : val);
                      }}
                    />
                  </div>

                  {/* Total Original de la Venta */}
                  <div className="flex justify-between items-center pt-2 border-t border-border/40 text-muted-foreground">
                    <span className="font-semibold text-base text-foreground">Total Venta</span>
                    <span className="font-mono text-2xl font-black text-primary">
                      {fmt(total, monedaSeleccionada)}
                    </span>
                  </div>

                  {/* Monto Ingresado */}
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span className="font-semibold text-foreground">Monto Ingresado</span>
                    <span className="font-mono text-lg font-bold text-primary">
                      {fmt(pagadoTotal, monedaSeleccionada)}
                    </span>
                  </div>
                </div>

                {/* SECCIÓN DINÁMICA DE SALDO PENDIENTE / RESTA POR PAGAR */}
                {deudaVenta > 0.009 ? (
                  <div className="pt-3 border-t border-border space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="font-black text-sm text-foreground uppercase tracking-wider">
                        {lineasPago[0]?.montoStr !== "" ? "Falta por Pagar:" : "TOTAL A PAGAR:"}
                      </span>
                      <span className="text-3xl font-black font-mono text-primary">
                        {fmt(deudaVenta, monedaSeleccionada)}
                      </span>
                    </div>
                    {lineasPago[0]?.montoStr !== "" && (
                      <p className="text-[11px] text-muted-foreground text-right italic font-medium">
                        Se reduce dinámicamente al ingresar pago
                      </p>
                    )}
                  </div>
                ) : vueltoResumen ? (
                  <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-500/15 p-4 flex items-center justify-between mt-2">
                    <span className="text-sm font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Vuelto / Cambio:
                    </span>
                    <span className="text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                      {fmt(vueltoResumen.monto, vueltoResumen.codigo)}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-center text-base font-extrabold text-emerald-700 dark:text-emerald-300 mt-2">
                    ✓ Pago Completo Exacto
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      );
    })()}

        {/* Modal de ajuste manual del límite de crédito. Se anida sobre el de venta
            (se renderiza después) y al cerrarlo NO se cierra el checkout. */}
        <Modal
          open={showAjusteCredito}
          onClose={() => setShowAjusteCredito(false)}
          title={`Ajustar crédito de ${clienteObj?.nombre || "cliente"}`}
          className="max-w-md w-[92vw]"
          zIndex={300}
          overlayClassName="bg-background/90 backdrop-blur-md"
        >
          <div className="space-y-4">
            {/* Estado actual: la moneda va UNA sola vez en el encabezado y los importes
                en columna, para no repetirla ni mezclar etiqueta y valor */}
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Crédito en {monedaSeleccionada}
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Límite</span>
                  <span className="font-mono text-sm font-bold text-foreground">
                    {fmtNumber(limiteMoneda)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Deuda actual</span>
                  <span className="font-mono text-sm font-bold text-danger">
                    {fmtNumber(deudaMoneda)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-semibold text-foreground">Disponible</span>
                  <span className="font-mono text-xl font-black text-primary">
                    {fmtNumber(disponibleCredito)}
                  </span>
                </div>
              </div>
            </div>

            {/* Selector de modo: sumar/restar un monto, o fijar el valor exacto */}
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setModoAjuste("suma")}
                className={`h-9 rounded-md text-sm font-bold transition-colors cursor-pointer ${
                  modoAjuste === "suma"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sumar / Restar
              </button>
              <button
                type="button"
                onClick={() => setModoAjuste("fijo")}
                className={`h-9 rounded-md text-sm font-bold transition-colors cursor-pointer ${
                  modoAjuste === "fijo"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Fijar valor
              </button>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">
                {modoAjuste === "suma"
                  ? `Monto a sumar o restar (${monedaSeleccionada})`
                  : `Nuevo límite (${monedaSeleccionada})`}
              </Label>
              <Input
                type="number"
                step="any"
                min="0"
                autoFocus
                value={ajusteLimite}
                placeholder={modoAjuste === "suma" ? "Ej: 5000" : fmtNumber(limiteMoneda)}
                onChange={(e) => setAjusteLimite(e.target.value)}
                className="mt-1 h-12 text-right font-mono text-lg font-bold"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (modoAjuste === "suma") ajustarLimite(1);
                  else fijarLimite();
                }}
              />
            </div>

            {/* Vista previa del resultado */}
            <div className="rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Quedaría en: </span>
              <span className="font-mono font-bold text-primary">
                {(() => {
                  const v = parseFloat(ajusteLimite);
                  if (!Number.isFinite(v)) return fmtNumber(limiteMoneda);
                  const nuevo =
                    modoAjuste === "suma"
                      ? Math.max(0, limiteMoneda + v)
                      : Math.max(0, v);
                  return fmtNumber(nuevo);
                })()}
              </span>
            </div>

            {modoAjuste === "suma" ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={ajustandoLimite}
                  onClick={() => ajustarLimite(-1)}
                  className="h-11 font-bold cursor-pointer"
                >
                  <Minus size={16} className="mr-1.5" /> Restar
                </Button>
                <Button
                  type="button"
                  disabled={ajustandoLimite}
                  onClick={() => ajustarLimite(1)}
                  className="h-11 font-bold cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Plus size={16} className="mr-1.5" />
                  {ajustandoLimite ? "Guardando..." : "Sumar"}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                disabled={ajustandoLimite}
                onClick={fijarLimite}
                className="w-full h-11 font-bold cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Check size={16} className="mr-1.5" />
                {ajustandoLimite ? "Guardando..." : "Guardar límite"}
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ajustandoLimite}
                onClick={() => {
                  // En modo "suma" se propone el faltante; en modo "fijo" se
                  // propone el límite exacto que haría falta para esta venta.
                  const falta = Math.max(0, Math.ceil(montoCreditoNecesario - disponibleCredito));
                  setModoAjuste("fijo");
                  setAjusteLimite(String(limiteMoneda + falta));
                }}
                className="flex-1 text-xs cursor-pointer"
              >
                Usar lo justo para esta venta
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAjusteCredito(false)}
                className="cursor-pointer"
              >
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal de creación de cliente (disponible desde Carrito de Venta y Checkout) */}
        <ClienteModal
          open={showClienteModal}
          mode="create"
          cliente={null}
          zIndex={300}
          onClose={() => setShowClienteModal(false)}
          onSuccess={(msg, newClienteData) => {
            toast(msg, "success");
            fetchClientes().then(() => {
              if (newClienteData && newClienteData.id) {
                setClienteId(String(newClienteData.id));
              }
            });
          }}
        />

        {/* Hold Save Modal */}
        <Modal
          open={showHoldSaveModal}
          onClose={() => setShowHoldSaveModal(false)}
          title="Pausar Venta"
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={() => setShowHoldSaveModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={handleHoldCart}>Guardar Venta</Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">La venta actual quedará guardada y el carrito se limpiará para que puedas atender a otra persona.</p>
            <Field label="Identificador de la venta (Opcional)">
              <Input
                placeholder="Ej. Cliente camisa roja"
                value={holdName}
                onChange={(e) => setHoldName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleHoldCart()}
              />
            </Field>
          </div>
        </Modal>

        {/* Hold List Modal */}
        <Modal
          open={showHoldListModal}
          onClose={() => setShowHoldListModal(false)}
          title="Ventas en Espera"
          className="max-w-2xl w-[90vw]"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            {heldCarts.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No hay ventas pausadas.</p>
            ) : (
              <div className="divide-y divide-border border rounded-lg bg-card overflow-hidden">
                {heldCarts.map(h => (
                  <div key={h.id} className="p-4 flex items-center justify-between hover:bg-muted/40 transition-colors">
                    <div>
                      <h4 className="font-medium text-sm">{h.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{h.cart.length} producto(s) · {fmtDateTime(h.timestamp)}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => {
                        saveHeldCarts(heldCarts.filter(x => x.id !== h.id));
                      }} className="text-danger hover:text-danger hover:bg-danger-soft">Descartar</Button>
                      <Button size="sm" onClick={() => handleRestoreCart(h.id)}>
                        Recuperar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        {/* Receipt Success Modal */}
        <Modal
          open={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          title="Venta Exitosa"
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={() => setShowReceiptModal(false)}>Cerrar</Button>
              <Button className="flex-1" onClick={handlePrint}>
                <Printer size={16} className="mr-2" />
                Imprimir Ticket
              </Button>
            </>
          }
        >
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="h-16 w-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-4">
              <Check size={32} />
            </div>
            <h3 className="text-xl font-bold mb-1">¡Venta completada!</h3>
            <p className="text-sm text-muted-foreground mb-6">
              La venta {lastSaleData?.ventaNumero} ha sido registrada en el sistema.
            </p>
            <div className="w-full border rounded-lg p-4 bg-muted/30 text-left text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-bold text-base">{lastSaleData?.monedaSimbolo}{fmt(lastSaleData?.total ?? 0, lastSaleData?.monedaCodigo)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pagado:</span>
                <span className="font-mono font-semibold">{fmt(lastSaleData?.montoPagado ?? 0, lastSaleData?.monedaCodigo)}</span>
              </div>
              {(lastSaleData?.deuda ?? 0) > 0.009 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deuda restante:</span>
                  <span className="font-mono font-semibold text-warning-strong">{fmt(lastSaleData?.deuda ?? 0, lastSaleData?.monedaCodigo)}</span>
                </div>
              )}
              {/* Pago mixto: qué entregó el cliente y qué vuelto queda por moneda */}
              {(lastSaleData?.pagos ?? []).length > 1 &&
                (lastSaleData?.pagos ?? []).map((p: any, i: number) => (
                  <div key={`pago-${i}`} className="flex justify-between">
                    <span className="text-muted-foreground">{p.metodo} ({p.moneda}):</span>
                    <span className="font-mono font-semibold">{fmt(p.monto, p.moneda)}</span>
                  </div>
                ))}
              {(lastSaleData?.pagos ?? [])
                .filter((p: any) => (p.vuelto ?? 0) > 0.009)
                .map((p: any, i: number) => (
                  <div key={`vuelto-${i}`} className="flex justify-between">
                    <span className="text-muted-foreground">Vuelto {p.metodo}:</span>
                    <span className="font-mono font-semibold text-success-strong">
                      {fmt(p.vuelto, p.moneda)} {p.moneda}
                    </span>
                  </div>
                ))}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span>{lastSaleData?.clienteNombre}</span>
              </div>
            </div>
          </div>
        </Modal>

      {/* Hidden Receipt Component (Visible only when printing) */}
      {lastSaleData && (
        <ReceiptPrinter
          ref={receiptRef}
          ventaNumero={lastSaleData.ventaNumero}
          fecha={lastSaleData.fecha}
          clienteNombre={lastSaleData.clienteNombre}
          tipoPago={lastSaleData.tipoPago}
          monedaCodigo={lastSaleData.monedaCodigo}
          monedaSimbolo={lastSaleData.monedaSimbolo}
          items={lastSaleData.items}
          subtotal={lastSaleData.subtotal}
          impuesto={lastSaleData.impuesto}
          descuento={lastSaleData.descuento}
          total={lastSaleData.total}
          deuda={lastSaleData.deuda}
          pagos={lastSaleData.pagos}
        />
      )}
    </>
  );
}
