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
  Percent,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  aBase,
  convertirConMetodo,
  redondear,
  tasaUsd,
  tasaUsdDocumento,
  tasaMostrada,
  esConversionDirectaUsd,
  tasaPar,
  aplicarDescuentosLinea,
  calcularTotalConDescuentos,
} from "@/lib/money";
import { ProductoModal } from "@/components/producto/producto-modal";

/* ───── Types ───── */

interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  rif: string | null;
  activo: boolean;
}

interface MonedaInfo {
  id: string;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: string | null;
  decimales?: number;
  es_base: boolean;
  activo?: boolean;
  usa_tasa_usd_directa?: boolean;
  tasa_usd_directa?: number | string | null;
}

/** Reglas globales que afectan la conversión de la compra (Set & Forget). */
interface ConfigGlobalMotor {
  metodo_conversion_compras: string;
  moneda_transito_compras_id: string | null;
  /**
   * Método de costeo (Configuración → Inventario). Solo 'Promedio' aplica el
   * CPP al comprar; con FIFO/LIFO el CPP no se calcula ni actualiza el precio.
   */
  metodo_costeo?: string;
}

interface MetodoPago {
  id: string;
  nombre: string;
  tipo: string;
  caja_id: string | null;
  caja_nombre: string | null;
  moneda_codigo: string | null;
  moneda_simbolo: string | null;
  activo: boolean;
}

interface ProductoPrecio {
  moneda_id: string;
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
  moneda_base_id: string | null;
  moneda_costo_id: string | null;
  categoria_nombre: string | null;
  /** Margen de ganancia % configurado en el producto (para precargarlo). */
  margen_ganancia?: number | string | null;
  /** CPP actual en moneda base (para estimar el nuevo precio tras la compra). */
  costo_promedio_base?: number | string | null;
  precios: ProductoPrecio[] | null;
  presentaciones?: PresentacionProducto[] | null;
}

/** Presentación del producto (Caja, Bolsa...) devuelta por el buscador. */
interface PresentacionProducto {
  id: string;
  nombre: string;
  unidades: number;
  activo: boolean;
  precio: number;
  costo: number;
}

/** Presentación seleccionada en un ítem de la compra (null = Unidad). */
interface PresentacionItem {
  id: string;
  nombre: string;
  unidades: number;
}

interface LineItem {
  id: string; // temp id for UI
  producto_id: number;
  codigo: string;
  nombre: string;
  cantidad: number; // SIEMPRE en unidades (pivota stock/kardex)
  costo_unit: number;
  subtotal: number;
  // Base para recalcular al cambiar la tasa: `costo_base` está en la moneda de
  // COMPRA del producto; `costoManual` solo se llena si el usuario lo edita a mano
  costo_base: number;
  moneda_base_id: string | null;
  moneda_costo_id: string | null;
  costoManual: number | null;
  /**
   * Último precio pagado autocompletado (producto_costos_historicos). Se guarda
   * junto a la MONEDA en que se obtuvo: si la compra cambia de moneda, la
   * sugerencia deja de aplicar y se deriva del costo estático. Editar el costo a
   * mano la reemplaza por `costoManual`.
   */
  costoSugerido?: { valor: number; monedaId: string | null } | null;
  // Presentación mayor (si se compra al mayor; null = por Unidad). La cantidad
  // sigue en unidades y `cantidad_presentaciones` es cuántas cajas/bolsas.
  presentacion: PresentacionItem | null;
  cantidad_presentaciones: number;
  // Opciones de presentación disponibles del producto (para el selector)
  presentaciones: PresentacionProducto[];
  // Margen de ganancia % de ESTA línea (el operador puede ajustarlo en la
  // compra: recalcula el precio de venta y se persiste en el producto).
  margen: number;
  /**
   * Descuentos POR LÍNEA encadenados (%). El 2º se aplica sobre el resultado del
   * 1º: `neto = bruto × (1−d1/100) × (1−d2/100)`. El costo NETO es lo que entra
   * al CPP (lo que realmente se pagó).
   */
  descuento1: number;
  descuento2: number;
  // Contexto del producto para estimar el nuevo CPP/precio tras la compra.
  stock: number;
  costo_previo_base: number;
}

/* ───── Helpers ───── */

import { fmtMonedaConSimbolo } from "@/lib/format";

function fmtMoney(n: number, moneda: { simbolo: string; decimales?: number }): string {
  return fmtMonedaConSimbolo(n, moneda.simbolo, moneda.decimales ?? 2);
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

  // Moneda del COSTO del producto (moneda_costo_id; sin ella = la de venta)
  const prodMoneda =
    monedas.find((m) => m.id === (producto.moneda_costo_id ?? producto.moneda_base_id)) ||
    monedas.find((m) => m.es_base) ||
    moneda;

  const tasaProdUsd = tasaUsd(prodMoneda, monedas);
  const tasaDocUsd = tasaUsdDocumento(moneda, tasaCustom, monedas);
  const dec = Number(moneda.decimales ?? 2);
  if (tasaProdUsd <= 0) return costoBase;
  // Factor par a par: respeta la tasa personalizada para USD pero mantiene el
  // par con la referencia (COP ↔ BS = 3.2) aunque COP use tasa directa a USD.
  const factor = tasaPar(prodMoneda, moneda, monedas, { [String(moneda.id)]: tasaDocUsd });
  return redondear(costoBase * factor, dec);
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
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [metodoPagoId, setMetodoPagoId] = useState<string | null>(null);
  const [referencia, setReferencia] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Tipo de pago: 'contado' | 'parcial' | 'credito'
  const [tipoPago, setTipoPago] = useState<'contado' | 'parcial' | 'credito'>('contado');
  const [abonoInicial, setAbonoInicial] = useState("");
  const [abonoMonedaId, setAbonoMonedaId] = useState<string | null>(null);

  // Modal de confirmación final (estilo POS): resumen antes de crear la compra
  const [showConfirm, setShowConfirm] = useState(false);

  // Descuento GENERAL de la factura (%) - se aplica sobre el neto de las líneas
  const [descuentoGeneral, setDescuentoGeneral] = useState(0);

  // La tasa personalizada se usa rara vez: se oculta tras un chip "⚙ Ajustar"
  const [showTasa, setShowTasa] = useState(false);

  // Tasa personalizada de la compra (opcional; vacío = tasa por defecto de la moneda)
  const [tasaCustomStr, setTasaCustomStr] = useState("");

  // Reglas globales del motor (método de conversión de compras + tránsito).
  const [cfgGlobal, setCfgGlobal] = useState<ConfigGlobalMotor | null>(null);

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

  // Contexto de conversión del lado compras (directa | triangulación vía tránsito).
  const ctxCompra = useMemo(() => {
    const idTransito = cfgGlobal?.moneda_transito_compras_id ?? null;
    return {
      metodo: (cfgGlobal?.metodo_conversion_compras === "triangulacion"
        ? "triangulacion"
        : "directa") as "directa" | "triangulacion",
      monedaTransito: idTransito
        ? monedas.find((m) => String(m.id) === String(idTransito)) ?? null
        : null,
    };
  }, [cfgGlobal, monedas]);

  // ¿El método de costeo activo aplica el CPP? Solo 'Promedio'. Si no, la
  // compra no altera el costo promedio y no tiene sentido estimar el PV por CPP.
  const aplicarCppEnCompra = (cfgGlobal?.metodo_costeo ?? "Promedio") === "Promedio";

  const selectedProveedor = proveedores.find((p) => p.id === proveedorId);

  // Tasa personalizada (si es válida) y tasa efectiva de la compra
  // Tasa personalizada que se envía al servidor (siempre en USD/COP).
  // Si hay triangulación, el input del usuario es VES/COP → lo convertimos a USD/COP implícito.
  const tasaCustomNum = useMemo(() => {
    const n = parseFloat(tasaCustomStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Triangulación activa: el input es VES/COP → calculamos USD/COP implícito
    if (
      ctxCompra.metodo === "triangulacion" &&
      ctxCompra.monedaTransito &&
      selectedMoneda
    ) {
      const usdVes = tasaUsd(ctxCompra.monedaTransito, monedas);
      return usdVes * n; // USD/COP = USD/VES * VES/COP
    }
    return n; // Modo directo: el input ya es USD/COP
  }, [tasaCustomStr, ctxCompra.metodo, ctxCompra.monedaTransito, selectedMoneda, monedas]);

  const tasaEfectiva = useMemo(() => {
    if (!selectedMoneda) return 0;
    return tasaCustomNum ?? tasaMostrada(selectedMoneda);
  }, [selectedMoneda, tasaCustomNum]);

  // ¿La moneda de la compra usa conversión directa a USD? Cambia la etiqueta.
  const compraDirecta = esConversionDirectaUsd(selectedMoneda);

  // Costo UNITARIO de un ítem en la moneda de la compra; si el usuario lo
  // editó a mano se respeta, si no se deriva de la tasa efectiva.
  // Para presentaciones, `costoManual` guarda el costo unitario (consistente).
  // Usa EL MISMO MÉTODO GLOBAL (directa | triangulación vía tránsito) que la
  // cascada del servidor para coherencia total.
  const costoDeItem = (item: LineItem): number => {
    if (item.costoManual !== null) {
      if (item.presentacion && item.presentacion.unidades > 1) {
        return item.costoManual / item.presentacion.unidades;
      }
      return item.costoManual;
    }
    // Último precio pagado, solo si fue registrado en la MONEDA actual de la compra.
    if (
      item.costoSugerido &&
      (item.costoSugerido.monedaId ?? null) === (selectedMoneda?.id ?? null)
    ) {
      return item.costoSugerido.valor;
    }
    if (!selectedMoneda) return item.costo_base;
    const prodMoneda =
      monedas.find((m) => m.id === (item.moneda_costo_id ?? item.moneda_base_id)) ||
      monedas.find((m) => m.es_base) ||
      selectedMoneda;
    // Conversión usando el método global de COMPRAS (directa / triangulación)
    const tasaDocItem = tasaUsdDocumento(selectedMoneda, tasaCustomNum, monedas);
    const costoEnMonedaCompra = convertirConMetodo(
      item.costo_base,
      prodMoneda,
      selectedMoneda,
      {
        metodo: ctxCompra.metodo,
        monedaTransito: ctxCompra.monedaTransito,
        catalogo: monedas,
        efectivas: { [String(selectedMoneda.id)]: tasaDocItem },
      },
      Number(selectedMoneda.decimales ?? 2)
    );
    return costoEnMonedaCompra;
  };

  /** Descuentos de UNA línea: dos % encadenados sobre el subtotal de lista. */
  const descuentosDe = (item: LineItem) =>
    aplicarDescuentosLinea(
      costoDeItem(item),
      item.cantidad,
      item.descuento1,
      item.descuento2,
      Number(selectedMoneda?.decimales ?? 2)
    );

  /** Suma de los subtotales de lista (antes de descuentos) de todas las líneas. */
  const brutoTotal = useMemo(
    () => items.reduce((sum, item) => sum + costoDeItem(item) * item.cantidad, 0),
    [items, selectedMoneda, monedas, tasaCustomNum]
  );

  /** Total de dinero descontado en las líneas (ambos %). */
  const descuentoLineasTotal = useMemo(
    () => items.reduce((sum, item) => sum + descuentosDe(item).descuentoTotalMonto, 0),
    [items, selectedMoneda, monedas, tasaCustomNum]
  );

  /** Subtotal NETO de las líneas (ya con sus dos descuentos, sin el general). */
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + descuentosDe(item).subtotalNeto, 0),
    [items, selectedMoneda, monedas, tasaCustomNum]
  );

  /** TOTAL final: neto de líneas − descuento general de la factura. */
  const total = useMemo(
    () => calcularTotalConDescuentos([subtotal], descuentoGeneral, Number(selectedMoneda?.decimales ?? 2)).total,
    [subtotal, descuentoGeneral, selectedMoneda]
  );

  /** Descuento general de la factura ya en dinero. */
  const descuentoGeneralMonto = useMemo(
    () => calcularTotalConDescuentos([subtotal], descuentoGeneral, Number(selectedMoneda?.decimales ?? 2)).descuentoGeneralMonto,
    [subtotal, descuentoGeneral, selectedMoneda]
  );

  const totalBase = useMemo(() => {
    if (!selectedMoneda) return total;
    return aBase(total, tasaUsdDocumento(selectedMoneda, tasaCustomNum, monedas));
  }, [total, selectedMoneda, monedas, tasaCustomNum]);

  // ── Pago: abono inicial en USD y saldo pendiente ──────────────────────────
  const abonoMoneda = useMemo(() => {
    const id = abonoMonedaId || selectedMoneda?.id;
    return monedas.find((m) => String(m.id) === String(id)) || selectedMoneda;
  }, [abonoMonedaId, selectedMoneda, monedas]);

  const abonoNum = parseFloat(abonoInicial) || 0;
  /** Abono inicial convertido a moneda base (USD) con la tasa de SU moneda. */
  const abonoBase = useMemo(() => {
    if (tipoPago !== 'parcial' || abonoNum <= 0 || !abonoMoneda) return 0;
    return aBase(abonoNum, tasaUsd(abonoMoneda, monedas));
  }, [tipoPago, abonoNum, abonoMoneda, monedas]);

  /** Deuda que queda tras el abono inicial (USD). */
  const saldoPendienteBase = useMemo(() => {
    if (tipoPago === 'contado') return 0;
    return Math.max(totalBase - abonoBase, 0);
  }, [tipoPago, totalBase, abonoBase]);

  /** Renglones para el modal de confirmación (con presentación desglosada). */
  const resumenItems = useMemo(
    () =>
      items.map((i) => {
        const unit = costoDeItem(i);
        return {
          id: i.id,
          nombre: i.nombre,
          codigo: i.codigo,
          cantidad: i.cantidad,
          cantidadMostrada: i.presentacion ? i.cantidad_presentaciones : i.cantidad,
          presentacionNombre: i.presentacion?.nombre ?? null,
          unidades: i.presentacion?.unidades ?? 1,
          costoUnit: unit,
          subtotal: unit * i.cantidad,
        };
      }),
    [items, selectedMoneda, monedas, tasaCustomNum, ctxCompra] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Load initial data ──
  useEffect(() => {
    async function load() {
      setLoadingData(true);
      try {
        const [resProv, resMet, resMon, resCfg] = await Promise.all([
          fetch("/api/proveedores?page=1&limit=500"),
          fetch("/api/metodos-pago"),
          fetch("/api/monedas"),
          fetch("/api/configuracion-global"),
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
        if (resCfg.ok) {
          setCfgGlobal(await resCfg.json());
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
    // moneda vuelve la tasa por defecto y la sugerencia de "último pago" en la
    // moneda anterior deja de ser válida → se limpia.
    setTasaCustomStr("");
    setItems((prev) =>
      prev.map((i) =>
        i.costoSugerido && (i.costoSugerido.monedaId ?? null) !== (selectedMoneda?.id ?? null)
          ? { ...i, costoSugerido: null, costoManual: null, costo_unit: costoDeItem(i) }
          : i
      )
    );
  }, [selectedMoneda?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add product to items ──
  const addProduct = (producto: ProductoSearch) => {
    // Check if already in list
    const existing = items.find((i) => i.producto_id === producto.id);
    if (existing) {
      setItems((prev) =>
        prev.map((i) =>
          i.producto_id === producto.id
            ? i.presentacion
              ? {
                  ...i,
                  cantidad_presentaciones: i.cantidad_presentaciones + 1,
                  cantidad: i.cantidad + i.presentacion.unidades,
                }
              : { ...i, cantidad: i.cantidad + 1 }
            : i
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
        moneda_costo_id: producto.moneda_costo_id ?? null,
        costoManual: null,
        costoSugerido: null,
        presentacion: null,
        cantidad_presentaciones: 0,
        presentaciones: (producto.presentaciones || []).filter((p) => p.activo !== false),
        margen: producto.margen_ganancia != null ? Number(producto.margen_ganancia) || 0 : 0,
        descuento1: 0,
        descuento2: 0,
        stock: Number(producto.stock) || 0,
        costo_previo_base:
          parseFloat(String(producto.costo_promedio_base ?? producto.costo_base)) || 0,
      };
      setItems((prev) => [...prev, newItem]);
      // Autocompletado: último costo conocido (por Unidad) en la moneda de la compra
      sugerirUltimoCosto(newItem.id, producto.id, null);
    }

    setSearchQuery("");
    setSearchOpen(false);
    toast(`"${producto.nombre}" agregado`, "info");
  };

  // ── Presentación de un ítem (null = Unidad) ──
  const setItemPresentacion = (id: string, pres: PresentacionProducto | null) => {
    const it = items.find((i) => i.id === id);
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        if (!pres) {
          // Volver a Unidad manteniendo las unidades actuales
          return { ...i, presentacion: null, cantidad_presentaciones: 0 };
        }
        const unidadesAntes = i.cantidad;
        const cantidadPres = Math.max(1, Math.round(unidadesAntes / pres.unidades));
        // El costo unitario no cambia; la cantidad se re-expresa en presentaciones
        return {
          ...i,
          presentacion: { id: pres.id, nombre: pres.nombre, unidades: pres.unidades },
          cantidad_presentaciones: cantidadPres,
        };
      })
    );
    // Autocompletado con el último costo de ESA presentación (si existe)
    if (it) sugerirUltimoCosto(id, it.producto_id, pres?.id ?? null);
  };

  const updateItemQuantity = (id: string, qty: number) => {
    if (qty < 1) return;
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? i.presentacion
            ? { ...i, cantidad_presentaciones: qty, cantidad: qty * i.presentacion.unidades }
            : { ...i, cantidad: qty }
          : i
      )
    );
  };

  /** Costo en moneda del documento de UNA presentación (caja/bolsa). */
  const costoPresentacionDe = (item: LineItem): number => {
    if (!item.presentacion) return 0;
    const dec = Number(selectedMoneda?.decimales ?? 2);
    return redondear(costoDeItem(item) * item.presentacion.unidades, dec);
  };

  /** Al editar el costo (presentación o unidad) → guarda costo UNITARIO. */
  const updateItemCost = (id: string, cost: number, isPresentacion: boolean) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const dec = Number(selectedMoneda?.decimales ?? 2);
        if (i.presentacion && i.presentacion.unidades > 1 && isPresentacion) {
          // Usuario ingresa costo de PRESENTACIÓN → convertimos a unitario para guardar.
          const presCost = redondear(cost, dec);
          const unit = redondear(presCost / i.presentacion.unidades, 6);
          return {
            ...i,
            costoManual: unit,           // <-- guarda unitario
            costoSugerido: null,
            costo_unit: unit,
            subtotal: i.cantidad_presentaciones * presCost,
          };
        }
        return {
          ...i,
          costoManual: redondear(cost, dec), // unitario directo
          costoSugerido: null,
          costo_unit: redondear(cost, dec),
          subtotal: i.cantidad * redondear(cost, dec),
        };
      })
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  /** Ajusta el margen % de una línea (0 = sin margen; recalcula el PV estimado). */
  const updateItemMargen = (id: string, v: string) => {
    const n = parseFloat(v);
    const margen = v.trim() === "" || !Number.isFinite(n) ? 0 : Math.max(0, n);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, margen } : i)));
  };

  /**
   * Ajusta el descuento % de una línea (1º o 2º). El 2º se aplica SOBRE el
   * resultado del 1º. Se acota a [0, 100] para que un valor corrupto nunca
   * produzca un subtotal negativo.
   */
  const updateItemDescuento = (id: string, campo: "descuento1" | "descuento2", v: string) => {
    const n = parseFloat(v);
    const d = v.trim() === "" || !Number.isFinite(n) ? 0 : Math.min(100, Math.max(0, n));
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [campo]: d } : i)));
  };

  /**
   * AUTOCUMPLETADO DE COSTO: sugiere el último costo registrado para el
   * producto/moneda/presentación vía producto_costos_historicos (compra
   * transparente). Se pre-rellena con `costoManual` para que el operador lo
   * vea y pueda editarlo; si no hay historial, no toca nada.
   */
  const sugerirUltimoCosto = async (
    itemId: string,
    productoId: number,
    presId: string | null
  ) => {
    try {
      const params = new URLSearchParams({ producto_id: String(productoId) });
      if (selectedMoneda?.id) params.set("moneda_id", selectedMoneda.id);
      if (presId) params.set("presentacion_id", presId);
      const res = await fetch(`/api/compras/ultimos-costos?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return;
      const top = data[0];
      const costo = top?.costo_unit != null ? parseFloat(String(top.costo_unit)) : NaN;
      if (!Number.isFinite(costo) || costo <= 0) return;
      const dec = Number(selectedMoneda?.decimales ?? 2);
      const monedaId = selectedMoneda?.id ?? null;
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId && i.costoManual === null
            ? {
                ...i,
                costoManual: redondear(costo, dec),
                costoSugerido: { valor: redondear(costo, dec), monedaId },
                costo_unit: redondear(costo, dec),
                subtotal: redondear(i.cantidad * costo, dec),
              }
            : i
        )
      );
    } catch {
      // Sin historial o error: se mantiene el costo derivado por defecto.
    }
  };

  // ── Validación previa (antes de abrir el modal de confirmación) ──
  const validarFormulario = (): boolean => {
    if (!proveedorId) {
      toast("Selecciona un proveedor", "warning");
      return false;
    }
    if (items.length === 0) {
      toast("Agrega al menos un producto", "warning");
      return false;
    }
    if (!metodoPagoId) {
      toast("Selecciona un método de pago", "warning");
      return false;
    }
    if (tipoPago === 'parcial') {
      if (!abonoInicial || parseFloat(abonoInicial) <= 0) {
        toast("Ingresa el monto del abono inicial", "warning");
        return false;
      }
      if (parseFloat(abonoInicial) > total) {
        toast("El abono inicial no puede superar el total de la compra", "warning");
        return false;
      }
    }
    return true;
  };

  /** Botón "Finalizar compra": valida y abre el modal de resumen (estilo POS). */
  const abrirConfirmacion = () => {
    if (!validarFormulario()) return;
    setShowConfirm(true);
  };

  // ── Submit (desde el modal de confirmación) ──
  const handleSubmit = async () => {
    if (!validarFormulario()) {
      setShowConfirm(false);
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
        items: items.map((i) => {
          const unit = costoDeItem(i);
          const dsc = descuentosDe(i);
          const base: Record<string, unknown> = {
            producto_id: i.producto_id,
            cantidad: i.cantidad, // SIEMPRE en unidades
            costo_unit: unit,
            margen: i.margen, // override de margen de ganancia para la cascada
            // Dos descuentos % encadenados por línea (el 2º sobre el 1º)
            descuento1_pct: i.descuento1,
            descuento2_pct: i.descuento2,
          };
          if (i.presentacion && i.cantidad_presentaciones > 0) {
            const dec = Number(selectedMoneda?.decimales ?? 2);
            base.presentacion_id = i.presentacion.id;
            base.cantidad_presentaciones = i.cantidad_presentaciones;
            // Costo NETO negociado de la presentación (lo que se paga); el
            // servidor lo desglosa a unitario para el kardex y el CPP
            base.costo_presentacion = redondear(dsc.costoUnitNeto * i.presentacion.unidades, dec);
          }
          return base;
        }),
        // Tasa personalizada (opcional); vacío = tasa por defecto de la moneda
        tasa: tasaCustomNum,
        // Descuento general de la factura (%) - se aplica sobre el neto de líneas
        descuento_general_pct: descuentoGeneral,
        // Nuevos campos de pago
        tipo_pago: tipoPago,
        abono_inicial: tipoPago === 'parcial' ? parseFloat(abonoInicial) : undefined,
        abono_moneda_id: tipoPago === 'parcial' ? (abonoMonedaId || selectedMoneda?.id) : undefined,
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
    <div className="mx-auto max-w-[1900px] px-8">
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

      {/* ═══════════ COLUMNA ÚNICA ═══════════ */}
      <div className="space-y-4">
        {/* ── Datos de la compra ── */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText size={15} className="text-primary" /> Datos de la Compra
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Referencia */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <Hash size={12} className="inline mr-1" /> Referencia
              </label>
              <input
                type="text"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Ej: FAC-00123"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
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
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Observaciones */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <FileText size={12} className="inline mr-1" /> Observaciones
              </label>
              <input
                type="text"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Notas adicionales..."
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* ── Proveedor (barra única, igual que el buscador de productos) ── */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Truck size={15} className="text-primary" /> Proveedor
            <span className="text-red-400">*</span>
          </h3>
          <div className="relative" ref={proveedorRef}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Truck
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <button
                  type="button"
                  onClick={() => setProveedorDropdownOpen(!proveedorDropdownOpen)}
                  className={cn(
                    "flex h-11 w-full items-center justify-between rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-left transition-colors",
                    proveedorDropdownOpen && "border-primary ring-1 ring-ring",
                    !selectedProveedor && "text-muted-foreground"
                  )}
                >
                  <span className="truncate">
                    {selectedProveedor ? selectedProveedor.nombre : "Buscar o seleccionar proveedor..."}
                  </span>
                  {selectedProveedor && (
                    <X
                      size={14}
                      className="ml-2 flex-shrink-0 text-muted-foreground/60 hover:text-foreground"
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
                      className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl"
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
                      <div className="max-h-56 overflow-y-auto py-1">
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
                              {p.id === proveedorId && <Check size={13} className="flex-shrink-0 text-primary" />}
                              <span className="truncate">{p.nombre}</span>
                              {p.rif && (
                                <span className="ml-auto font-mono text-xs text-muted-foreground">{p.rif}</span>
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

            {/* Aviso a nivel de campo */}
            {!proveedorId && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-strong">
                <AlertTriangle size={12} />
                Selecciona un proveedor para poder agregar productos.
              </p>
            )}
          </div>
        </div>

          {/* ── Product Search ── */}
          <div className="rounded-xl border border-border/60 bg-card p-5">
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
                              {p.presentaciones && p.presentaciones.length > 0 && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-foreground/70">
                                  {p.presentaciones.slice(0, 3).map((pr) => (
                                    <span key={pr.id} className="rounded bg-muted px-1.5 py-0.5">
                                      {pr.nombre} ×{pr.unidades}
                                    </span>
                                  ))}
                                  {p.presentaciones.length > 3 && (
                                    <span className="text-muted-foreground/60">+{p.presentaciones.length - 3}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-mono font-semibold text-foreground">
                                {selectedMoneda ? fmtMoney(costo, selectedMoneda) : `$${costo.toFixed(2)}`}
                              </div>
                              {alreadyAdded && (
                                <span className="text-xs text-primary font-medium">Ya agregado</span>
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
          <div className="rounded-xl border border-border/60 bg-card p-5">
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
              <div className="space-y-3">
                {items.map((item) => {
                  const costoUnit = costoDeItem(item);
                  const esPresentacion = !!item.presentacion;
                  // Descuentos encadenados de la línea (bruto → neto)
                  const descuentosLinea = descuentosDe(item);
                  const subtotalBrutoItem = costoUnit * item.cantidad;
                  const subtotalItem = descuentosLinea.subtotalNeto;
                  const cantidadMostrada = esPresentacion
                    ? item.cantidad_presentaciones
                    : item.cantidad;
                  const costoNumero = esPresentacion
                    ? costoPresentacionDe(item)
                    : costoUnit;
                  const dec = Number(selectedMoneda?.decimales ?? 2);
                  const costoMostrado = costoNumero.toFixed(dec);
                  // ── Estimado del precio de venta tras la compra ──
                  // Refleja EXACTAMENTE la cascada del servidor: mismo método
                  // global de conversión (directa | triangulación vía tránsito).
                  const tasaDocItem = selectedMoneda ? tasaUsdDocumento(selectedMoneda, tasaCustomNum, monedas) : 0;
                  const costoUnitBaseItem =
                    selectedMoneda && monedaBase
                      ? convertirConMetodo(
                          costoUnit,
                          selectedMoneda,
                          monedaBase,
                          {
                            metodo: ctxCompra.metodo,
                            monedaTransito: ctxCompra.monedaTransito,
                            catalogo: monedas,
                            efectivas: { [String(selectedMoneda.id)]: tasaDocItem },
                          },
                          6
                        )
                      : 0;
                  const stockPrev = item.stock || 0;
                  const prevBase = Number(item.costo_previo_base) || 0;
                  const cppEstBase =
                    stockPrev + item.cantidad > 0
                      ? (stockPrev * prevBase + item.cantidad * costoUnitBaseItem) / (stockPrev + item.cantidad)
                      : costoUnitBaseItem;
                  const monedaVentaItem =
                    monedas.find((m) => m.id === item.moneda_base_id) || monedaBase;
                  const pvEstimado = monedaVentaItem && monedaBase
                    ? redondear(
                        convertirConMetodo(
                          cppEstBase,
                          monedaBase,
                          monedaVentaItem,
                          {
                            metodo: ctxCompra.metodo,
                            monedaTransito: ctxCompra.monedaTransito,
                            catalogo: monedas,
                          },
                          6
                        ) *
                          (1 + (item.margen || 0) / 100),
                        Number(monedaVentaItem.decimales ?? 2)
                      )
                    : 0;
                  const equivUnidad = esPresentacion
                    ? selectedMoneda
                      ? `= ${fmtMoney(costoUnit, selectedMoneda!)} / unid.`
                      : `= $${costoUnit.toFixed(2)} / unid.`
                    : "";
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-border bg-background/40 p-3.5"
                    >
                      {/* Cabecera: producto + subtotal + quitar */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium leading-tight">{item.nombre}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{item.codigo}</div>
                          {item.presentaciones.length > 0 && (
                            <select
                              value={item.presentacion?.id ?? ""}
                              onChange={(e) => {
                                const pres =
                                  item.presentaciones.find((p) => p.id === e.target.value) || null;
                                setItemPresentacion(item.id, pres);
                              }}
                              className="mt-2 h-8 rounded border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="">Unidad</option>
                              {item.presentaciones.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre} ({p.unidades} unid.)
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-start gap-2">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Subtotal</div>
                            <div className="font-mono font-semibold text-foreground">
                              {selectedMoneda
                                ? fmtMoney(subtotalItem, selectedMoneda!)
                                : `$${subtotalItem.toFixed(2)}`}
                            </div>
                            {descuentosLinea.descuentoTotalMonto > 0 && (
                              <div className="text-[11px] text-muted-foreground line-through">
                                {selectedMoneda
                                  ? fmtMoney(subtotalBrutoItem, selectedMoneda!)
                                  : `$${subtotalBrutoItem.toFixed(2)}`}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            title="Quitar"
                            aria-label="Quitar"
                            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Controles: cantidad, costo, descuento y margen */}
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                        {/* Cantidad */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">
                            Cantidad
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item.id, cantidadMostrada - 1)}
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              disabled={cantidadMostrada <= 1}
                            >
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              value={cantidadMostrada}
                              onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value) || 1)}
                              min={1}
                              className="h-8 w-full min-w-0 rounded border border-border bg-background text-center font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item.id, cantidadMostrada + 1)}
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                          <div className="mt-1 text-xs text-foreground/70">
                            {esPresentacion
                              ? `${item.cantidad} unid. (×${item.presentacion!.unidades})`
                              : "unidades"}
                          </div>
                        </div>

                        {/* Costo */}
                        <div>
                          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <span>{esPresentacion ? `Costo por ${item.presentacion!.nombre}` : "Costo unitario"}</span>
                            {item.costoSugerido && (item.costoSugerido.monedaId ?? null) === (selectedMoneda?.id ?? null) && (
                              <span
                                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                                title="Autocompletado con el último precio pagado a este proveedor/moneda"
                              >
                                último pago
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            key={`${item.id}-${esPresentacion ? "pres" : "unit"}-${selectedMoneda?.id ?? "base"}`}
                            defaultValue={costoMostrado}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isFinite(v) && v >= 0) updateItemCost(item.id, v, esPresentacion);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            className="h-8 w-full rounded border border-border bg-background text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                            <span className="text-foreground/80">{equivUnidad}</span>
                            {item.costoManual !== null && (
                              <button
                                type="button"
                                onClick={() =>
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id
                                        ? { ...i, costoManual: null, costoSugerido: null }
                                        : i
                                    )
                                  )
                                }
                                className="flex-shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                                title="Volver a la tasa automática"
                              >
                                Usar tasa
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Descuentos: dos % encadenados (2º sobre el resultado del 1º) */}
                        <div>
                          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <span title="Primer descuento de la línea">Dcto. 1</span>
                            <span className="text-muted-foreground/60">→</span>
                            <span title="Segundo descuento, aplicado sobre el resultado del primero">Dcto. 2</span>
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              inputMode="decimal"
                              defaultValue={item.descuento1}
                              onBlur={(e) => updateItemDescuento(item.id, "descuento1", e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                              title="Primer descuento (%)"
                              className="h-8 w-full min-w-0 rounded border border-border bg-background text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              inputMode="decimal"
                              defaultValue={item.descuento2}
                              onBlur={(e) => updateItemDescuento(item.id, "descuento2", e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                              title="Segundo descuento (%), aplicado sobre el resultado del primero"
                              className="h-8 w-full min-w-0 rounded border border-border bg-background text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                          <div className="mt-1 text-xs text-foreground/70">
                            {descuentosLinea && descuentosLinea.descuentoTotalMonto > 0 ? (
                              <span className="text-primary">
                                − {selectedMoneda ? fmtMoney(descuentosLinea.descuentoTotalMonto, selectedMoneda) : ""}
                              </span>
                            ) : (
                              "sin descuento"
                            )}
                          </div>
                        </div>

                        {/* Margen + precio de venta estimado */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-muted-foreground">
                            Margen
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              inputMode="decimal"
                              defaultValue={item.margen}
                              onBlur={(e) => {
                                const v = parseFloat(e.target.value);
                                if (Number.isFinite(v) && v >= 0) updateItemMargen(item.id, String(v));
                              }}
                              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                              title="Margen de ganancia (%)"
                              className="h-8 w-full min-w-0 rounded border border-border bg-background text-right font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                          <div
                            className="mt-1 text-xs font-medium text-foreground/80"
                            title={
                              aplicarCppEnCompra
                                ? "Precio de venta estimado tras la compra (CPP × margen)"
                                : "El método de costeo no es 'Promedio': la compra no recalcula el CPP ni el precio de venta"
                            }
                          >
                            {!aplicarCppEnCompra
                              ? "PV: —"
                              : monedaVentaItem && pvEstimado > 0
                                ? `PV: ${fmtMoney(pvEstimado, monedaVentaItem)}`
                                : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        {/* ── Descuento general de la factura ── */}
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Percent size={15} className="text-primary" />
              <label className="text-sm font-semibold text-foreground">Descuento general</label>
              <span className="text-xs text-muted-foreground">de la factura</span>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={descuentoGeneral}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setDescuentoGeneral(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
                }}
                placeholder="0.00"
                className="h-9 w-24 rounded-lg border border-border bg-background px-2.5 text-right font-mono text-sm font-bold focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>

            {/* Resumen del efecto */}
            {items.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div className="text-right">
                  <div className="text-xs leading-tight text-muted-foreground">Subtotal (lista)</div>
                  <div className="font-mono font-semibold tabular-nums text-foreground">
                    {selectedMoneda ? fmtMoney(brutoTotal, selectedMoneda) : brutoTotal.toFixed(2)}
                  </div>
                </div>

                {descuentoLineasTotal > 0 && (
                  <div className="text-right">
                    <div className="text-xs leading-tight text-muted-foreground">Dctos. por línea</div>
                    <div className="font-mono font-semibold tabular-nums text-primary">
                      −
                      {selectedMoneda
                        ? fmtMoney(descuentoLineasTotal, selectedMoneda)
                        : descuentoLineasTotal.toFixed(2)}
                    </div>
                  </div>
                )}

                {descuentoGeneralMonto > 0 && (
                  <div className="text-right">
                    <div className="text-xs leading-tight text-muted-foreground">
                      Dcto. general ({descuentoGeneral}%)
                    </div>
                    <div className="font-mono font-semibold tabular-nums text-primary">
                      −
                      {selectedMoneda
                        ? fmtMoney(descuentoGeneralMonto, selectedMoneda)
                        : descuentoGeneralMonto.toFixed(2)}
                    </div>
                  </div>
                )}

                <div className="text-right">
                  <div className="text-xs leading-tight text-muted-foreground">Total</div>
                  <div className="font-mono text-xl font-extrabold tabular-nums text-primary">
                    {selectedMoneda ? fmtMoney(total, selectedMoneda) : total.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ BARRA STICKY: DECISIÓN + RESULTADO ═══════════ */}
      <div className="sticky bottom-0 z-30 -mx-5 mt-5 rounded-2xl border border-border/60 bg-card/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
        <div className="px-8 py-3">
          {/* ══ NIVEL 1 · LA DECISIÓN: cómo se paga ══ */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Forma de pago
            </span>

            {/* Píldoras de método: 1 clic, cada una con su moneda */}
            <div className="flex flex-wrap items-center gap-1.5">
              {metodosPago.map((m) => {
                const activo = m.id === metodoPagoId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMetodoPagoId(m.id)}
                    title={m.caja_nombre ? `Caja: ${m.caja_nombre}` : m.nombre}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all",
                      activo
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {m.nombre}
                    {activo && <Check size={12} className="shrink-0" />}
                  </button>
                );
              })}
            </div>

            {!metodoPagoId && (
              <span className="flex items-center gap-1 text-xs font-medium text-warning-strong">
                <AlertTriangle size={12} /> Elige cómo pagar
              </span>
            )}

            {/* Tasa: lectura compacta, input colapsable */}
            {selectedMoneda && !selectedMoneda.es_base && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTasa((v) => !v)}
                  title={
                    ctxCompra.metodo === "triangulacion" && ctxCompra.monedaTransito
                      ? `Tasa ${ctxCompra.monedaTransito.codigo}→${selectedMoneda.codigo}`
                      : "Tasa de cambio"
                  }
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-semibold tabular-nums transition-colors",
                    tasaCustomNum
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  <Settings size={12} />
                  {ctxCompra.metodo === "triangulacion" && ctxCompra.monedaTransito
                    ? tasaPar(ctxCompra.monedaTransito, selectedMoneda, monedas).toFixed(4)
                    : tasaEfectiva > 0
                      ? tasaEfectiva.toFixed(4)
                      : "—"}
                  {tasaCustomNum && <span className="text-[10px] font-bold uppercase">custom</span>}
                </button>

                {showTasa && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      autoFocus
                      value={tasaCustomStr}
                      onChange={(e) => setTasaCustomStr(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && setShowTasa(false)}
                      placeholder={ctxCompra.metodo === "triangulacion" && ctxCompra.monedaTransito
                        ? String(tasaPar(ctxCompra.monedaTransito, selectedMoneda, monedas))
                        : String(tasaMostrada(selectedMoneda))}
                      className="h-8 w-28 rounded-lg border border-primary bg-background px-2 text-right font-mono text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {ctxCompra.metodo === "triangulacion" && ctxCompra.monedaTransito
                        ? `${ctxCompra.monedaTransito.codigo}↔${selectedMoneda.codigo}`
                        : `${selectedMoneda.codigo}`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ══ NIVEL 2 · EL RESULTADO: descuentos + total + acción ══ */}
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-t border-border/60 pt-3">
            {/* Descuentos: solo si existen */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              {descuentoLineasTotal > 0 && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Dctos. por línea</span>
                  <span className="font-mono font-semibold tabular-nums text-primary">
                    −
                    {selectedMoneda
                      ? fmtMoney(descuentoLineasTotal, selectedMoneda)
                      : descuentoLineasTotal.toFixed(2)}
                  </span>
                </div>
              )}

              {descuentoGeneralMonto > 0 && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Dcto. general {descuentoGeneral}%
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-primary">
                    −
                    {selectedMoneda
                      ? fmtMoney(descuentoGeneralMonto, selectedMoneda)
                      : descuentoGeneralMonto.toFixed(2)}
                  </span>
                </div>
              )}

              {saldoPendienteBase > 0 && monedaBase && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Deuda</span>
                  <span className="font-mono font-semibold tabular-nums text-warning-strong">
                    {fmtMoney(saldoPendienteBase, monedaBase)}
                  </span>
                </div>
              )}

              {items.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Agrega productos para calcular el total
                </span>
              )}
            </div>

            {/* Total + acción */}
            <div className="flex items-end gap-5">
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
                  Total
                </div>
                <div className="text-4xl font-extrabold leading-none tabular-nums text-primary">
                  {selectedMoneda ? fmtMoney(total, selectedMoneda) : `$${total.toFixed(2)}`}
                </div>
              </div>

              <Button
                className="h-11 shrink-0 px-6 text-sm font-semibold"
                onClick={abrirConfirmacion}
                disabled={items.length === 0 || !proveedorId || !metodoPagoId}
                title={!proveedorId || !metodoPagoId ? "Completa proveedor y método de pago" : undefined}
              >
                <Check size={16} /> Finalizar Compra
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* ═══════════ MODAL DE CONFIRMACIÓN ═══════════ */}
      <Modal
        open={showConfirm}
        onClose={() => !submitting && setShowConfirm(false)}
        title="Confirmar Orden de Compra"
        className="max-w-4xl"
      >
        {/* ── Contexto: una sola línea, discreto ── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border/60 pb-3 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Truck size={14} className="text-muted-foreground" />
            {selectedProveedor?.nombre ?? "—"}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar size={13} />
            {fecha}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CreditCard size={13} />
            {selectedMetodo?.nombre ?? "—"}
          </span>
          {referencia.trim() && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Hash size={13} />
              <span className="font-mono">{referencia.trim()}</span>
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length} {items.length === 1 ? "producto" : "productos"} ·{" "}
            {items.reduce((s, i) => s + i.cantidad, 0)} unidades
          </span>
        </div>

        {/* ── Detalle de items (escaneable) ── */}
        <div className="-mx-1 overflow-hidden rounded-xl border border-border/60">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Producto</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Cant.</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                    Costo unit.
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {resumenItems.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{r.nombre}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.codigo}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {r.cantidadMostrada}
                      {r.presentacionNombre && (
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          {r.presentacionNombre}
                        </span>
                      )}
                      <div className="text-[11px] text-muted-foreground">{r.cantidad} u.</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                      {selectedMoneda ? fmtMoney(r.costoUnit, selectedMoneda) : r.costoUnit.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-foreground">
                      {selectedMoneda ? fmtMoney(r.subtotal, selectedMoneda) : r.subtotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Aviso CPP ── */}
        {!aplicarCppEnCompra && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning-strong">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              El método de costeo no es <strong>Promedio</strong>: la compra no recalculará el CPP ni el
              precio de venta de los productos.
            </span>
          </div>
        )}

        {/* ── Desglose (secundario) + Forma de pago (primario) ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Desglose */}
          <div className="rounded-xl border border-border/60 p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Desglose
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal (lista)</span>
                <span className="font-mono tabular-nums text-foreground">
                  {selectedMoneda ? fmtMoney(brutoTotal, selectedMoneda) : brutoTotal.toFixed(2)}
                </span>
              </div>
              {descuentoLineasTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dctos. por línea</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    −{" "}
                    {selectedMoneda
                      ? fmtMoney(descuentoLineasTotal, selectedMoneda)
                      : descuentoLineasTotal.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Neto de líneas</span>
                <span className="font-mono tabular-nums text-foreground">
                  {selectedMoneda ? fmtMoney(subtotal, selectedMoneda) : subtotal.toFixed(2)}
                </span>
              </div>
              {descuentoGeneralMonto > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Dcto. general {descuentoGeneral}%
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    −{" "}
                    {selectedMoneda
                      ? fmtMoney(descuentoGeneralMonto, selectedMoneda)
                      : descuentoGeneralMonto.toFixed(2)}
                  </span>
                </div>
              )}
              {selectedMoneda && !selectedMoneda.es_base && monedaBase && (
                <div className="flex justify-between border-t border-border/60 pt-1.5 text-xs">
                  <span className="text-muted-foreground">En {monedaBase.codigo} (base)</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtMoney(totalBase, monedaBase)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Forma de pago — contiene el resultado y la acción */}
          <div className="flex flex-col rounded-xl border-2 border-primary/25 bg-primary/5 p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Forma de pago
            </div>

            {/* Selector de tipo de pago */}
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: "contado", label: "Contado" },
                { value: "parcial", label: "Parcial" },
                { value: "credito", label: "Crédito" },
              ] as const).map((opt) => {
                const activo = tipoPago === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setTipoPago(opt.value);
                      if (opt.value !== "parcial") {
                        setAbonoInicial("");
                        setAbonoMonedaId(null);
                      }
                    }}
                    className={cn(
                      "h-10 rounded-lg border-2 text-sm font-medium transition-all disabled:opacity-50",
                      activo
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Abono inicial (solo Parcial) */}
            {tipoPago === "parcial" && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-medium text-foreground">
                  Abono inicial <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    value={abonoInicial}
                    onChange={(e) => setAbonoInicial(e.target.value)}
                    placeholder="0.00"
                    disabled={submitting}
                    className={cn(
                      "h-10 min-w-0 flex-1 rounded-lg border bg-card px-3 font-mono text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring",
                      abonoNum > 0 && abonoNum > total
                        ? "border-destructive focus:ring-destructive"
                        : "border-border focus:border-primary"
                    )}
                  />
                  <select
                    value={abonoMonedaId || selectedMoneda?.id || ""}
                    onChange={(e) => setAbonoMonedaId(e.target.value)}
                    disabled={submitting}
                    className="h-10 shrink-0 rounded-lg border border-border bg-card px-2 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {monedas
                      .filter((m) => m.activo !== false)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.simbolo} {m.codigo}
                        </option>
                      ))}
                  </select>
                </div>

                {abonoNum > 0 && abonoMoneda && (
                  <div className="space-y-1 rounded-lg bg-card/70 p-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Abono ahora</span>
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        {fmtMoney(abonoNum, abonoMoneda)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Queda debiendo</span>
                      <span
                        className={cn(
                          "font-mono font-semibold tabular-nums",
                          saldoPendienteBase > 0 ? "text-warning-strong" : "text-foreground"
                        )}
                      >
                        {monedaBase ? fmtMoney(saldoPendienteBase, monedaBase) : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {abonoNum > 0 && abonoNum > total && (
                  <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <AlertTriangle size={12} /> El abono no puede superar el total
                  </p>
                )}
              </div>
            )}

            {/* Nota mínima solo cuando aporta */}
            {tipoPago === "credito" && (
              <p className="mt-3 text-[11px] leading-tight text-muted-foreground">
                Podrás registrar abonos desde el detalle de la compra.
              </p>
            )}

            {/* ── El resultado: aquí vive el color primario ── */}
            <div className="mt-auto border-t border-primary/20 pt-4">
              {saldoPendienteBase > 0 && monedaBase && (
                <div className="mb-2 flex items-baseline justify-between rounded-lg bg-warning-soft px-3 py-2">
                  <span className="text-xs font-medium text-warning-strong">Saldo pendiente</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-warning-strong">
                    {fmtMoney(saldoPendienteBase, monedaBase)}
                  </span>
                </div>
              )}

              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total a pagar
                </div>
                <div className="text-4xl font-extrabold leading-none tabular-nums text-primary">
                  {selectedMoneda ? fmtMoney(total, selectedMoneda) : `$${total.toFixed(2)}`}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Acciones ── */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
          <Button variant="ghost" size="lg" onClick={() => setShowConfirm(false)} disabled={submitting}>
            Volver a editar
          </Button>

          <Button
            size="lg"
            className="h-12 px-8 text-base"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Registrando...
              </>
            ) : (
              <>
                <Check size={18} /> Registrar compra
              </>
            )}
          </Button>
        </div>
      </Modal>

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
