"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Minus, Package, Plus, ShoppingCart, X, Check, Pause, Printer, FolderOpen, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBar } from "@/components/ui/search-bar";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { fmt, fmtDateTime } from "@/lib/format";
import { redondear, tasaUsd, tasaUsdDocumento } from "@/lib/money";
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
  moneda_base_id?: number | null;
  categoria_nombre: string;
  marca_nombre: string;
  precios: Array<{
    moneda_id: number;
    moneda_codigo: string;
    moneda_simbolo: string;
    precio: number;
    costo: number;
    es_base: boolean;
  }>;
}

interface Moneda {
  id: number;
  codigo: string;
  simbolo: string;
  tasa: number | string;
  tasa_ref_moneda_id?: number | null;
  decimales: number;
  es_base: boolean;
}

interface MetodoPago {
  id: number;
  nombre: string;
  tipo: string;
  caja_id: number;
  moneda_codigo: string;
  activo?: boolean;
}

interface Caja {
  id: number;
  nombre: string;
  moneda_id: number;
  moneda_codigo: string;
  saldo_actual: number;
}

interface CartItem {
  product: Producto;
  qty: number;
}

interface PorCobrarItem {
  codigo: string;
  simbolo: string;
  monto: number;
}

interface LimiteCredito {
  moneda_id: number;
  codigo: string;
  simbolo?: string;
  es_base?: boolean;
  limite: number | string;
}

interface Cliente {
  id: number;
  nombre: string;
  documento: string | null;
  recibe_credito: boolean;
  limite_credito: number | string;
  deuda_total?: PorCobrarItem[];
  limites_credito?: LimiteCredito[];
}

interface HeldCart {
  id: string;
  name: string;
  cart: CartItem[];
  timestamp: string;
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

  // Selection state
  const [monedaSeleccionada, setMonedaSeleccionada] = useState<string>("");
  const [metodoPagoSeleccionado, setMetodoPagoSeleccionado] = useState<number | null>(null);
  const [cajaSeleccionada, setCajaSeleccionada] = useState<number | null>(null);

  // Pago: monto aplicado a la venta y efectivo entregado por el cliente.
  // montoPagadoStr vacío = paga el total completo. Menos que el total = el resto queda como deuda.
  const [montoPagadoStr, setMontoPagadoStr] = useState<string>("");
  const [recibidoStr, setRecibidoStr] = useState<string>("");
  const [clienteId, setClienteId] = useState("");
  const [ajusteLimite, setAjusteLimite] = useState("");
  const [ajustandoLimite, setAjustandoLimite] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Descuentos
  const [descuento, setDescuento] = useState<number>(0);
  const [descuentoStr, setDescuentoStr] = useState<string>("");

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [prodRes, metodosRes, cajasRes] = await Promise.all([
          fetch("/api/productos"),
          fetch("/api/metodos-pago"),
          fetch("/api/cajas"),
        ]);
        
        await fetchClientes();

        const prodData = await prodRes.json();
        setProductos(prodData.productos || []);
        setMonedas(prodData.monedas || []);

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
          const monedaBase = prodData.monedas?.find((m: Moneda) => m.es_base);
          if (monedaBase) setMonedaSeleccionada(monedaBase.codigo);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
        const code = barcodeBuffer.current;
        if (code) {
          const product = productos.find((p) => p.codigo === code);
          if (product && product.stock > 0) {
            addToCart(product);
            toast(`Producto agregado: ${product.nombre}`, "success");
          } else if (product && product.stock <= 0) {
            toast(`Sin existencias: ${product.nombre}`, "warning");
          } else {
            toast(`Producto no encontrado: ${code}`, "error");
          }
        }
        barcodeBuffer.current = "";
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [productos]);

  const handleSelectMetodo = (metodoId: number) => {
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

  const filtered = useMemo(() => {
    return productos.filter(
      (p) =>
        (p.nombre.toLowerCase().includes(search.toLowerCase()) ||
          p.codigo.toLowerCase().includes(search.toLowerCase())) &&
        p.stock > 0
    );
  }, [productos, search]);

  const getPrecio = (producto: Producto): number => {
    if (!monedaSeleccionada) return parseFloat(String(producto.precio_base)) || 0;

    const tasaCustomNum = parseFloat(tasaCustomStr);
    const conTasaCustom = Number.isFinite(tasaCustomNum) && tasaCustomNum > 0;

    // Con tasa personalizada SIEMPRE se recalcula desde el precio base del
    // producto (los precios guardados usan la tasa por defecto de la moneda)
    if (!conTasaCustom && producto.precios && producto.precios.length > 0) {
      const exact = producto.precios.find((p) => p.moneda_codigo === monedaSeleccionada);
      if (exact && parseFloat(String(exact.precio)) > 0) return parseFloat(String(exact.precio));
    }

    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    if (!targetMoneda) return parseFloat(String(producto.precio_base)) || 0;
    // Moneda propia del producto (sin moneda propia = moneda base del sistema)
    const prodMoneda =
      monedas.find((m) => m.id === producto.moneda_base_id) || monedas.find((m) => m.es_base) || targetMoneda;

    const precioBaseNum = parseFloat(String(producto.precio_base)) || 0;
    const tasaProdUsd = tasaUsd(prodMoneda, monedas);
    const tasaDocUsd = tasaUsdDocumento(targetMoneda, conTasaCustom ? tasaCustomNum : null, monedas);
    const dec = Number(targetMoneda.decimales ?? 2);
    if (tasaProdUsd <= 0) return precioBaseNum;
    return redondear((precioBaseNum / tasaProdUsd) * tasaDocUsd, dec);
  };

  // Tasa efectiva de la venta en "unidades de la moneda por su referencia"
  const tasaEfectiva = useMemo(() => {
    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    if (!targetMoneda) return 0;
    const tasaCustomNum = parseFloat(tasaCustomStr);
    return Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : Number(targetMoneda.tasa);
  }, [monedas, monedaSeleccionada, tasaCustomStr]);

  // Tasa por defecto de la moneda seleccionada (placeholder del campo)
  const tasaPorDefecto = useMemo(() => {
    const targetMoneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    return targetMoneda ? String(targetMoneda.tasa) : "";
  }, [monedas, monedaSeleccionada]);

  const addToCart = (p: Producto) => {
    const item = cart.find((c) => c.product.id === p.id);
    if (item) {
      if (item.qty + 1 > p.stock) {
        toast(`Las existencias máximas para ${p.nombre} son ${p.stock}`, "warning");
        return;
      }
      setCart((prev) =>
        prev.map((c) => (c.product.id === p.id ? { ...c, qty: c.qty + 1 } : c))
      );
    } else {
      setCart((prev) => [...prev, { product: p, qty: 1 }]);
    }
  };

  const removeFromCart = (id: number) => setCart((prev) => prev.filter((c) => c.product.id !== id));

  const updateQty = (id: number, delta: number) => {
    const item = cart.find((c) => c.product.id === id);
    if (!item) return;

    const nextQty = Math.max(1, item.qty + delta);
    if (nextQty > item.product.stock) {
      toast(`Las existencias máximas para ${item.product.nombre} son ${item.product.stock}`, "warning");
      setCart((prev) =>
        prev.map((c) => (c.product.id === id ? { ...c, qty: item.product.stock } : c))
      );
      return;
    }

    setCart((prev) =>
      prev.map((c) => (c.product.id === id ? { ...c, qty: nextQty } : c))
    );
  };

  const setDirectQty = (id: number, val: number) => {
    const item = cart.find((c) => c.product.id === id);
    if (!item) return;

    const parsed = isNaN(val) ? 1 : val;
    let targetQty = Math.max(1, parsed);

    if (targetQty > item.product.stock) {
      toast(`Las existencias máximas para ${item.product.nombre} son ${item.product.stock}`, "warning");
      targetQty = item.product.stock;
    }

    setCart((prev) =>
      prev.map((c) => (c.product.id === id ? { ...c, qty: targetQty } : c))
    );
  };

  const subtotal = useMemo(() => cart.reduce((s, c) => s + getPrecio(c.product) * c.qty, 0), [cart, monedaSeleccionada, monedas, tasaCustomStr]);
  const tax = useMemo(() => {
    return cart.reduce((s, c) => {
      if (c.product.iva_incluido) return s;
      return s + Math.round(getPrecio(c.product) * 0.16 * c.qty * 100) / 100;
    }, 0);
  }, [cart, monedaSeleccionada, monedas, tasaCustomStr]);
  
  const total = Math.max(0, subtotal - descuento + tax);

  // ═══════════ Pago: monto pagado, deuda pendiente y vuelto ═══════════
  // Vacío = se considera el total completo. Menos que el total = el resto queda como deuda.
  const montoPagado = useMemo(() => {
    const s = montoPagadoStr.trim();
    if (s === "") return total; // por defecto se paga todo
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, total); // el exceso no se aplica a la venta (eso es vuelto)
  }, [montoPagadoStr, total]);

  const montoPagadoExcede = useMemo(() => {
    const n = parseFloat(montoPagadoStr);
    return montoPagadoStr.trim() !== "" && Number.isFinite(n) && n > total + 0.009;
  }, [montoPagadoStr, total]);

  // Lo que no se paga ahora queda como deuda del cliente (crédito parcial o total)
  const deudaVenta = useMemo(() => Math.max(0, Math.round((total - montoPagado) * 100) / 100), [total, montoPagado]);
  const esCredito = deudaVenta > 0.009;

  const efectivoRecibido = useMemo(() => {
    const n = parseFloat(recibidoStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [recibidoStr]);

  // Vuelto a entregar al cliente (todo en la moneda de la venta)
  const vuelto = useMemo(
    () => Math.max(0, Math.round((efectivoRecibido - montoPagado) * 100) / 100),
    [efectivoRecibido, montoPagado]
  );
  // El efectivo entregado no alcanza a cubrir lo que dice haber pagado
  const efectivoFaltante = useMemo(
    () => (efectivoRecibido > 0 && efectivoRecibido < montoPagado - 0.009 ? Math.round((montoPagado - efectivoRecibido) * 100) / 100 : 0),
    [efectivoRecibido, montoPagado]
  );

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
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!metodoPagoSeleccionado) return;
    if (efectivoFaltante > 0) {
      toast(`El efectivo recibido no alcanza: faltan ${fmt(efectivoFaltante, monedaSeleccionada)}`, "error");
      return;
    }
    // Si se registra dinero entrante (contado o abono inicial) tiene que haber caja
    if (montoPagado > 0 && !cajaSeleccionada) return;
    if (esCredito && !clienteId) return;

    const metodoActual = metodosPago.find((m) => m.id === metodoPagoSeleccionado);
    if (
      metodoActual?.moneda_codigo &&
      monedaSeleccionada &&
      metodoActual.moneda_codigo !== monedaSeleccionada
    ) {
      toast("El método de pago debe tener la misma moneda que la venta", "error");
      return;
    }

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

      const res = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: esCredito ? parseInt(clienteId, 10) : null,
          tipo_pago: esCredito ? "Credito" : "Contado",
          moneda_id: moneda?.id,
          metodo_pago_id: metodoPagoSeleccionado,
          // Dinero que entra a la caja: el total (contado) o el pago parcial
          caja_id: montoPagado > 0 ? cajaSeleccionada : null,
          descuento,
          // Pago parcial: lo no pagado se registra como deuda del cliente
          monto_pagado: montoPagado,
          // Tasa personalizada (opcional); vacío = tasa por defecto de la moneda
          tasa: Number.isFinite(tasaCustomNum) && tasaCustomNum > 0 ? tasaCustomNum : null,
          items,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Prepare data for receipt printing
        const clienteObj = clientes.find((c) => c.id === parseInt(clienteId, 10));
        setLastSaleData({
          ventaNumero: data.venta?.numero || data.numero || "N/A",
          fecha: data.venta?.fecha || new Date().toISOString(),
          clienteNombre: clienteObj?.nombre || "Consumidor Final",
          tipoPago: esCredito ? "Crédito" : "Contado",
          monedaCodigo: monedaSeleccionada,
          monedaSimbolo: moneda?.simbolo || "$",
          tasaAplicada: tasaEfectiva,
          items: items,
          subtotal,
          impuesto: tax,
          descuento,
          total,
          montoPagado,
          deuda: deudaVenta,
          vuelto,
        });

        setCart([]);
        setClienteId("");
        setMontoPagadoStr("");
        setRecibidoStr("");
        setDescuento(0);
        setDescuentoStr("");
        setTasaCustomStr("");
        setShowCheckout(false);
        setShowClienteModal(false);
        setShowReceiptModal(true); // Open the receipt modal instead of just toast
        
        // Refresh products stock
        const prodRes = await fetch("/api/productos");
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProductos(prodData.productos || []);
        }

        // Refrescar deudas y límites de crédito de los clientes
        const cliRes = await fetch("/api/clientes?limit=500&activos=true");
        if (cliRes.ok) {
          const cliData = await cliRes.json();
          setClientes(cliData.data || []);
        }
      } else {
        const error = await res.json();
        toast(error.error || "Error al registrar la venta", "error");
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
      <div className="print:hidden">
        <PageHeader title="Punto de Venta" subtitle="Registra una venta directamente desde aquí" />
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Cargando productos...</p>
        </div>
      </div>
    );
  }

  const selectedMetodoObj = metodosPago.find((m) => m.id === metodoPagoSeleccionado);
  const clienteObj = clientes.find((c) => c.id === parseInt(clienteId, 10));
  const metodoMonedaOK =
    !selectedMetodoObj?.moneda_codigo ||
    !monedaSeleccionada ||
    selectedMetodoObj.moneda_codigo === monedaSeleccionada;

  // Límite de crédito y deuda del cliente en la moneda de esta venta
  const deudaMoneda =
    parseFloat(String(clienteObj?.deuda_total?.find((d) => d.codigo === monedaSeleccionada)?.monto ?? 0)) || 0;
  const limiteMoneda =
    parseFloat(String(clienteObj?.limites_credito?.find((l) => l.codigo === monedaSeleccionada)?.limite ?? 0)) || 0;
  const disponibleCredito = Math.max(0, limiteMoneda - deudaMoneda);

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

  const ajustarLimite = async (signo: 1 | -1) => {
    if (!clienteObj || !monedaSeleccionada) return;
    const moneda = monedas.find((m) => m.codigo === monedaSeleccionada);
    if (!moneda) return;

    const paso = parseFloat(ajusteLimite);
    if (isNaN(paso) || paso <= 0) {
      toast("Indica un monto para subir o bajar el límite", "error");
      return;
    }

    const nuevo = Math.max(0, Math.round((limiteMoneda + signo * paso) * 100) / 100);
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

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Punto de Venta"
          subtitle="Registra una venta directamente desde aquí"
          action={
            <Button variant="outline" onClick={() => setShowHoldListModal(true)}>
              <FolderOpen size={14} className="mr-1.5" />
              Recuperar Venta {heldCarts.length > 0 && `(${heldCarts.length})`}
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-5 lg:h-[calc(100vh-190px)] lg:grid-cols-12">
          {/* ═══════════ PRODUCT CATALOG (8 COLS) ═══════════ */}
          <div className="flex flex-col gap-3.5 min-w-0 lg:col-span-8">
            <div className="flex gap-3">
              <SearchBar
                placeholder="Buscar: harina, arroz, código (Lector de Barras listo)..."
                className="w-full bg-card py-2.5"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                <Select
                  value={metodoPagoSeleccionado?.toString() || ""}
                  onChange={(e) => handleSelectMetodo(parseInt(e.target.value))}
                  className="w-auto bg-card font-medium text-sm"
                  aria-label="Método de pago"
                >
                  {metodosPago.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.moneda_codigo})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid flex-1 content-start grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5 overflow-y-auto pr-1">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group flex flex-col justify-between rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-md"
                >
                  <div>
                    <div className="mb-2.5 flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40 group-hover:bg-primary/5 relative">
                      {p.imagen ? (
                        <img
                          src={p.imagen}
                          alt={p.nombre}
                          className="h-28 w-full object-contain p-1 transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <Package size={32} className="text-muted-foreground/40" />
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
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {p.codigo}
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2">
                    <span className="font-mono text-base font-bold text-primary">
                      {fmt(getPrecio(p), monedaSeleccionada)}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                      Existencias: {p.stock}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ═══════════ CART PANEL (4 COLS) ═══════════ */}
          <Card className="flex flex-col lg:col-span-4 min-w-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Carrito de Venta</h3>
                {monedaSeleccionada && (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {monedaSeleccionada}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
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

            <div className="flex-1 divide-y divide-border overflow-y-auto">
              {cart.length === 0 ? (
                <EmptyState icon={ShoppingCart} message="Sin productos en el carrito" />
              ) : (
                cart.map(({ product: p, qty }) => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
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
            <div className="space-y-3 border-t border-border px-5 py-4">
              <div className="space-y-1.5 text-sm">
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
                <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
                  <span>Total ({monedaSeleccionada || "—"})</span>
                  <span className="font-mono text-primary text-lg">{fmt(total, monedaSeleccionada)}</span>
                </div>
              </div>
              <Button
                className="w-full py-3 font-semibold text-sm"
                disabled={cart.length === 0}
                onClick={() => setShowCheckout(true)}
              >
                <Check size={16} className="mr-1.5" />
                Finalizar
              </Button>
            </div>
          </Card>
        </div>

        {/* Checkout Modal */}
        <Modal
          open={showCheckout}
          onClose={cerrarCheckout}
          title="Finalizar Venta"
          className="max-w-2xl w-[95vw]"
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={cerrarCheckout}>Cancelar</Button>
              <Button
                className="flex-1"
                onClick={handleCheckout}
                disabled={
                  submitting ||
                  cart.length === 0 ||
                  !metodoPagoSeleccionado ||
                  !metodoMonedaOK ||
                  (esCredito && !clienteObj) ||
                  efectivoFaltante > 0 ||
                  (montoPagado > 0 && !cajaSeleccionada)
                }
              >
                {submitting ? "Registrando..." : esCredito ? "Vender a Crédito" : "Registrar Venta"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Total a pagar */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total a pagar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {cart.reduce((s, c) => s + c.qty, 0)} producto(s) en el carrito
                </p>
              </div>
              <p className="font-mono text-2xl font-bold text-primary">{fmt(total, monedaSeleccionada)}</p>
            </div>

            {/* Forma de pago: preset rápido del monto pagado */}
            <div>
              <Label>Forma de pago</Label>
              <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <button
                  onClick={() => {
                    setMontoPagadoStr("");
                    setRecibidoStr("");
                  }}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    !esCredito ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Contado
                </button>
                <button
                  onClick={() => {
                    setMontoPagadoStr("0");
                    setRecibidoStr("");
                  }}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    esCredito ? "bg-card text-warning-strong shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Crédito
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                «Contado» paga el total y «Crédito» deja todo como deuda. Escribe un monto menor al total para un pago parcial.
              </p>
            </div>
            <Field label={esCredito ? "Cliente (obligatorio)" : "Cliente (opcional)"}>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Combobox
                    value={String(clienteId)}
                    onChange={setClienteId}
                    placeholder="Buscar cliente..."
                    options={[
                      { value: "", label: "Consumidor Final" },
                      ...clientes.map((c) => ({
                        value: String(c.id),
                        label: `${c.nombre} ${c.documento ? `— ${c.documento}` : ""}`,
                      })),
                    ]}
                  />
                </div>
                <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setShowClienteModal(true)} title="Nuevo Cliente">
                  <UserPlus size={16} />
                </Button>
              </div>
            </Field>

            {esCredito && clienteObj && (
              <div className={`rounded-lg border px-3 py-2.5 text-xs ${!clienteObj.recibe_credito ? "border-danger/20 bg-danger-soft text-danger" : "border-warning/20 bg-warning-soft text-warning-strong"}`}>
                {!clienteObj.recibe_credito ? (
                  <div className="flex items-start gap-2">
                    <X size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Este cliente no tiene crédito habilitado</p>
                      <p className="mt-0.5 text-[11px] opacity-80">
                        Actívalo en Clientes → Editar para poder venderle a crédito.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {/* 1) Deuda del cliente: una línea por moneda */}
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                          Deuda del cliente
                        </span>
                        {monedaSeleccionada && (
                          <span className="text-[10px] opacity-60">esta venta en {monedaSeleccionada}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {lineasDeuda.length > 0 ? (
                          lineasDeuda.map((d) => (
                            <span
                              key={d.codigo}
                              className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                                d.codigo === monedaSeleccionada
                                  ? "border-warning-strong/50 bg-card/80"
                                  : "border-border/50 bg-card/50"
                              }`}
                            >
                              {fmt(d.monto, d.codigo)}
                            </span>
                          ))
                        ) : (
                          <span className="font-semibold">Sin deuda</span>
                        )}
                      </div>
                    </div>

                    {/* 2) Límite y disponible en la moneda de esta venta */}
                    <div className="divide-y divide-warning-border/50 overflow-hidden rounded-md border border-warning-border/70 bg-card/70">
                      <div className="flex items-center justify-between px-2.5 py-1.5">
                        <span className="text-muted-foreground">Límite en {monedaSeleccionada}</span>
                        <span className="font-mono font-semibold">{fmt(limiteMoneda, monedaSeleccionada)}</span>
                      </div>
                      <div className="flex items-center justify-between px-2.5 py-1.5">
                        <span className="font-semibold">Disponible</span>
                        <span
                          className={`font-mono text-sm font-bold ${
                            disponibleCredito > 0 ? "text-success-strong" : "text-danger-strong"
                          }`}
                        >
                          {fmt(disponibleCredito, monedaSeleccionada)}
                        </span>
                      </div>
                    </div>

                    {/* 3) Avisos de crédito */}
                    {limiteMoneda <= 0 && (
                      <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11px] font-semibold text-danger-strong">
                        <X size={13} className="shrink-0" />
                        Sin crédito habilitado en {monedaSeleccionada}
                      </div>
                    )}
                    {limiteMoneda > 0 && deudaVenta - disponibleCredito > 0.009 && (
                      <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11px] font-semibold text-danger-strong">
                        <X size={13} className="shrink-0" />
                        Supera el disponible en {monedaSeleccionada}: faltan{" "}
                        {fmt(deudaVenta - disponibleCredito, monedaSeleccionada)}
                      </div>
                    )}

                    {/* 4) Ajustar límite */}
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                        Ajustar límite en {monedaSeleccionada}
                      </span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Input
                          className="h-9 w-36 text-right font-mono"
                          type="number"
                          min={0}
                          step="0.01"
                          value={ajusteLimite}
                          onChange={(e) => setAjusteLimite(e.target.value)}
                          placeholder="0.00"
                          disabled={ajustandoLimite}
                          aria-label={`Monto para subir o bajar el límite en ${monedaSeleccionada}`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 p-0 text-base font-bold"
                          disabled={ajustandoLimite}
                          onClick={() => ajustarLimite(-1)}
                          title="Bajar el límite de crédito"
                        >
                          −
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 p-0 text-base font-bold"
                          disabled={ajustandoLimite}
                          onClick={() => ajustarLimite(1)}
                          title="Subir el límite de crédito"
                        >
                          +
                        </Button>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight opacity-70">
                        Escribe un monto y usa − o + para bajar o subir el límite de este cliente.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-muted-foreground mt-2">
              <span>Descuento ({monedaSeleccionada})</span>
              <Input
                className="w-24 h-7 text-right font-mono"
                value={descuentoStr}
                placeholder="0.00"
                onChange={(e) => {
                  setDescuentoStr(e.target.value);
                  const val = parseFloat(e.target.value);
                  setDescuento(isNaN(val) ? 0 : val);
                }}
              />
            </div>

            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono">{fmt(subtotal, monedaSeleccionada)}</span>
            </div>
            
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>IVA (16%)</span>
              <span className="font-mono">{fmt(tax, monedaSeleccionada)}</span>
            </div>
            
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Total ({monedaSeleccionada})</span>
              <span className="font-mono text-primary text-lg">{fmt(total, monedaSeleccionada)}</span>
            </div>

            {/* ── Pago parcial: cuánto aplica a esta venta ── */}
            <Field label={`Monto pagado ahora (${monedaSeleccionada || "—"})`}>
              <Input
                className="text-right font-mono"
                type="number"
                step="any"
                min="0"
                value={montoPagadoStr}
                placeholder={fmt(total, monedaSeleccionada)}
                onChange={(e) => setMontoPagadoStr(e.target.value)}
              />
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                {deudaVenta > 0.009 ? (
                  <span className="rounded-md border border-warning-border bg-warning-soft px-2 py-0.5 font-semibold text-warning-strong">
                    Deuda restante: {fmt(deudaVenta, monedaSeleccionada)}
                  </span>
                ) : (
                  <span className="rounded-md border border-success-border bg-success-soft px-2 py-0.5 font-semibold text-success-strong">
                    Pago completo
                  </span>
                )}
                {montoPagadoExcede && (
                  <span className="rounded-md border border-info-border bg-info-soft px-2 py-0.5 font-semibold text-info-strong">
                    Se aplica el total; usa «Efectivo recibido» para el vuelto
                  </span>
                )}
                <span className="text-muted-foreground">Vacío = paga el total completo.</span>
              </div>
            </Field>

            {/* ── Vuelto: lo que el cliente entrega de más ── */}
            {montoPagado > 0 && (
              <Field label={`Efectivo recibido del cliente (${monedaSeleccionada || "—"})`}>
                <Input
                  className="text-right font-mono"
                  type="number"
                  step="any"
                  min="0"
                  value={recibidoStr}
                  placeholder="0.00"
                  onChange={(e) => setRecibidoStr(e.target.value)}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {vuelto > 0.009 && (
                    <span className="rounded-md border border-success-border bg-success-soft px-2 py-0.5 font-semibold text-success-strong">
                      Vuelto a entregar: {fmt(vuelto, monedaSeleccionada)}
                    </span>
                  )}
                  {efectivoFaltante > 0 && (
                    <span className="rounded-md border border-danger/30 bg-danger-soft px-2 py-0.5 font-semibold text-danger-strong">
                      Faltan {fmt(efectivoFaltante, monedaSeleccionada)} de efectivo
                    </span>
                  )}
                  {vuelto <= 0.009 && efectivoFaltante <= 0 && (
                    <span className="text-muted-foreground">
                      Sin vuelto. Déjalo vacío si el pago no es en efectivo.
                    </span>
                  )}
                </div>
              </Field>
            )}

            <div className="space-y-2 pt-2">
              <Field
                label={
                  esCredito
                    ? `Método de pago (crédito en ${monedaSeleccionada || "—"})`
                    : "Método de pago"
                }
              >
                <Select value={metodoPagoSeleccionado?.toString() || ""} onChange={(e) => handleSelectMetodo(parseInt(e.target.value))}>
                  {metodosPago.map((m) => (
                    <option key={m.id} value={m.id}>{m.nombre} ({m.moneda_codigo})</option>
                  ))}
                </Select>
              </Field>

              {!metodoMonedaOK && (
                <p className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger">
                  El método de pago debe tener la misma moneda que el crédito ({monedaSeleccionada}).
                </p>
              )}

              {esCredito && (
                <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  La parte no pagada se registra como deuda del cliente en {monedaSeleccionada}. Podrás cobrarla desde el módulo de Créditos.
                </p>
              )}

              {monedaSeleccionada && (
                <div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Tasa {monedaSeleccionada} (opcional)</span>
                    <Input
                      className="w-28 h-7 text-right font-mono"
                      type="number"
                      step="any"
                      min="0"
                      value={tasaCustomStr}
                      placeholder={tasaPorDefecto}
                      onChange={(e) => setTasaCustomStr(e.target.value)}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                    Vacío = tasa por defecto ({tasaPorDefecto}). Al cambiarla se recalculan los precios en pantalla.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Modal anidado: creación de cliente sobre el checkout */}
          <ClienteModal
            open={showClienteModal}
            mode="create"
            cliente={null}
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
        </Modal>

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
              {(lastSaleData?.vuelto ?? 0) > 0.009 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vuelto a entregar:</span>
                  <span className="font-mono font-semibold text-success-strong">{fmt(lastSaleData?.vuelto ?? 0, lastSaleData?.monedaCodigo)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span>{lastSaleData?.clienteNombre}</span>
              </div>
            </div>
          </div>
        </Modal>
      </div>

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
        />
      )}
    </>
  );
}
